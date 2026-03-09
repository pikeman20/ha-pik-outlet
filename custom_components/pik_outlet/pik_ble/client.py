"""PIK BLE GATT client — handles connection, protocol framing, and state parsing.

This module is the low-level BLE transport for the PIK 6-Switch Outlet.
It manages:
  - BLE GATT connection (connect / disconnect / auto-reconnect awareness)
  - BLE notification subscription and ASCII line buffering
  - PIK protocol command serialisation (PIK-CMD:… → write to FFF2)
  - PIK notification parsing (PIK-NOTIF:… from FFF1) into typed state objects
  - Command queue (one command at a time, wait for OK/ERROR terminator)
  - Callback dispatch to coordinator on state changes

Thread safety:
  - BLE notification callbacks run on the HA event loop (habluetooth backend).
  - Disconnect callbacks may arrive from a different thread → fire via
    ``call_soon_threadsafe``.
  - ``send_command`` uses an asyncio.Lock so only one command is in-flight.
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Callable

from bleak import BleakClient, BleakGATTCharacteristic
from bleak.exc import BleakError

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

# ── BLE GATT UUIDs ───────────────────────────────────────────────────────────
SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb"
WRITE_CHAR_UUID = "0000fff2-0000-1000-8000-00805f9b34fb"
NOTIFY_CHAR_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"

# ── Protocol regex patterns ──────────────────────────────────────────────────
RE_OK = re.compile(r"^PIK-NOTIF:OK$")
RE_ERR = re.compile(r"^PIK-NOTIF:ERROR$")
RE_SK = re.compile(r"^PIK-NOTIF:SK:([1-6]):M=(OFF|MAN|CLD):R=([01])(?::L=([01]))?$")
RE_MST = re.compile(r"^PIK-NOTIF:MST:M=(OFF|MAN|CLD):LOCK=([01])$")
RE_ENERGY = re.compile(r"^PIK-NOTIF:ENERGY:V=(\d+):I=(\d+):P=(\d+):F=(\d+)$")
RE_RTC = re.compile(r"^PIK-NOTIF:RTC:(.+)$")
RE_TIMER_EN = re.compile(r"^PIK-NOTIF:TIMER:EN=([01]{6})$")
RE_CUSTOM = re.compile(r"^PIK-NOTIF:CUSTOM:(.*)$")

# Guard against garbage / stuck BLE modules filling the buffer
_RX_BUFFER_MAX = 2048

# ── Socket count ─────────────────────────────────────────────────────────────
SOCKET_COUNT = 6

# ── Default timeouts ─────────────────────────────────────────────────────────
CONNECT_TIMEOUT = 30.0
CMD_TIMEOUT = 5.0
AT_CMD_TIMEOUT = 8.0


# ══════════════════════════════════════════════════════════════════════════════
# State dataclasses
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class SocketState:
    """Runtime state of one socket."""
    mode: str = "OFF"   # "OFF" | "MAN" | "CLD"
    relay: bool = False
    lock: bool = False  # per-socket child lock


@dataclass
class EnergyState:
    """Parsed energy measurements."""
    voltage: int = 0        # volts
    current_ma: int = 0     # milliamps
    power: int = 0          # watts
    frequency: int = 0      # hertz
    valid: bool = False


@dataclass
class MasterState:
    """Master / total button state."""
    mode: str = "OFF"
    lock: bool = False


@dataclass
class TimerProfile:
    """Cached timer profile (write-only — device has no read-back command)."""
    days: int = 0           # weekday bitmask 0-127
    hour_on: int = 0
    minute_on: int = 0
    hour_off: int = 0
    minute_off: int = 0
    enabled: bool = False


@dataclass
class DeviceState:
    """Aggregate device state — updated in-place by the BLE client."""
    sockets: list[SocketState] = field(
        default_factory=lambda: [SocketState() for _ in range(SOCKET_COUNT)]
    )
    master: MasterState = field(default_factory=MasterState)
    energy: EnergyState = field(default_factory=EnergyState)
    rtc_text: str = ""          # e.g. "2026-3-8:10:30:0:DOW=1" or "HALTED"
    timer_enable: str = "000000"  # 6 chars, one per socket
    timer_profiles: list[list[TimerProfile]] = field(
        default_factory=lambda: [
            [TimerProfile() for _ in range(6)] for _ in range(SOCKET_COUNT)
        ]
    )
    connected: bool = False


# ══════════════════════════════════════════════════════════════════════════════
# BLE Client
# ══════════════════════════════════════════════════════════════════════════════

class PikBLEClient:
    """BLE GATT client for the PIK 6-Switch Outlet.

    Lifecycle:
      1. Instantiate with BLE address and HA reference.
      2. ``set_ble_device()`` with a fresh BLEDevice from HA bluetooth stack.
      3. ``connect()`` to establish GATT link and subscribe to FFF1 notifs.
      4. ``request_full_status()`` to populate initial state.
      5. State changes from notifications fire the registered callback.
      6. ``send_command()`` for interactive commands (mode set, timer, etc.).
      7. ``disconnect()`` on unload.
    """

    # ── Construction ─────────────────────────────────────────────────────────

    def __init__(self, hass: HomeAssistant, address: str) -> None:
        self._hass = hass
        self._address = address
        self._ble_device = None  # Set externally before connect
        self._client: BleakClient | None = None
        self._connected = False

        # RX line buffering
        self._rx_buffer = ""

        # Command serialisation
        self._cmd_lock = asyncio.Lock()
        self._cmd_pending = False
        self._cmd_event = asyncio.Event()
        self._cmd_response_lines: list[str] = []

        # Parsed state
        self._state = DeviceState()

        # Coordinator callback
        self._on_state_change: Callable[[], None] | None = None

    # ── Properties ───────────────────────────────────────────────────────────

    @property
    def address(self) -> str:
        """Return the BLE MAC address."""
        return self._address

    @property
    def is_connected(self) -> bool:
        """Return ``True`` when GATT link is live."""
        return (
            self._connected
            and self._client is not None
            and self._client.is_connected
        )

    @property
    def state(self) -> DeviceState:
        """Return current parsed device state (mutable reference)."""
        self._state.connected = self.is_connected
        return self._state

    # ── Configuration ────────────────────────────────────────────────────────

    def set_ble_device(self, ble_device) -> None:
        """Update the underlying BLEDevice (e.g. after adapter change)."""
        self._ble_device = ble_device

    def set_state_callback(self, callback: Callable[[], None]) -> None:
        """Register a callback invoked on any state change."""
        self._on_state_change = callback

    # ── Connection lifecycle ─────────────────────────────────────────────────

    async def connect(self) -> None:
        """Establish BLE GATT connection and subscribe to notifications."""
        if self.is_connected:
            return

        if self._ble_device is None:
            raise BleakError(f"No BLEDevice set for {self._address}")

        # Tear down stale client
        if self._client is not None:
            try:
                await self._client.disconnect()
            except Exception:  # noqa: BLE001
                pass
            self._client = None

        self._rx_buffer = ""

        self._client = BleakClient(
            self._ble_device,
            disconnected_callback=self._handle_disconnect,
            timeout=CONNECT_TIMEOUT,
        )
        await self._client.connect()
        await self._client.start_notify(NOTIFY_CHAR_UUID, self._handle_notification)
        self._connected = True
        self._state.connected = True
        _LOGGER.info("Connected to PIK Outlet %s", self._address)

    async def disconnect(self) -> None:
        """Gracefully disconnect BLE."""
        if self._client is not None:
            try:
                await self._client.disconnect()
            except Exception:  # noqa: BLE001
                pass
        self._connected = False
        self._state.connected = False
        self._client = None
        _LOGGER.info("Disconnected from PIK Outlet %s", self._address)

    # ── BLE callbacks ────────────────────────────────────────────────────────

    def _handle_disconnect(self, _client: BleakClient) -> None:
        """BLE disconnect callback — may fire from a non-event-loop thread."""
        _LOGGER.warning("PIK Outlet %s disconnected", self._address)
        self._connected = False
        self._state.connected = False
        self._rx_buffer = ""

        # Unblock any pending command
        if self._cmd_pending:
            self._cmd_event.set()

        # Notify coordinator (thread-safe)
        if self._on_state_change is not None:
            self._hass.loop.call_soon_threadsafe(self._on_state_change)

    def _handle_notification(
        self, _sender: BleakGATTCharacteristic, data: bytearray
    ) -> None:
        """BLE notification callback — runs on HA event loop."""
        try:
            text = data.decode("ascii", errors="replace")
        except Exception:  # noqa: BLE001
            return

        self._rx_buffer += text

        # Overflow guard
        if len(self._rx_buffer) > _RX_BUFFER_MAX:
            _LOGGER.warning("PIK RX buffer overflow — clearing")
            self._rx_buffer = ""
            return

        while "\n" in self._rx_buffer:
            line, self._rx_buffer = self._rx_buffer.split("\n", 1)
            line = line.rstrip("\r")
            if not line:
                continue

            _LOGGER.debug("PIK RX: %s", line)

            # Parse notification and update state
            state_changed = self._parse_line(line)

            # Command response collection
            if self._cmd_pending:
                self._cmd_response_lines.append(line)
                if RE_OK.match(line) or RE_ERR.match(line):
                    self._cmd_event.set()

            # Push state to coordinator immediately on ANY state change,
            # regardless of whether a command is pending.  This ensures
            # that unsolicited button-press notifications and command
            # response data both reach the HA UI without delay.
            if state_changed and self._on_state_change is not None:
                self._on_state_change()

    # ── Protocol parser ──────────────────────────────────────────────────────

    def _parse_line(self, line: str) -> bool:
        """Parse a single PIK-NOTIF line and update internal state.

        Returns ``True`` if state was modified.
        """
        m = RE_SK.match(line)
        if m:
            idx = int(m.group(1)) - 1
            self._state.sockets[idx].mode = m.group(2)
            self._state.sockets[idx].relay = m.group(3) == "1"
            lock_group = m.group(4)
            if lock_group is not None:
                self._state.sockets[idx].lock = lock_group == "1"
            return True

        m = RE_MST.match(line)
        if m:
            self._state.master.mode = m.group(1)
            self._state.master.lock = m.group(2) == "1"
            return True

        m = RE_ENERGY.match(line)
        if m:
            self._state.energy.voltage = int(m.group(1))
            self._state.energy.current_ma = int(m.group(2))
            self._state.energy.power = int(m.group(3))
            self._state.energy.frequency = int(m.group(4))
            self._state.energy.valid = True
            return True

        m = RE_RTC.match(line)
        if m:
            self._state.rtc_text = m.group(1)
            return True

        m = RE_TIMER_EN.match(line)
        if m:
            self._state.timer_enable = m.group(1)
            return True

        # OK / ERROR / CUSTOM lines don't change persistent state
        return False

    # ── Command transport ────────────────────────────────────────────────────

    async def send_command(
        self, cmd: str, timeout: float = CMD_TIMEOUT
    ) -> tuple[bool, list[str]]:
        """Send a PIK-CMD and wait for the OK/ERROR terminator.

        Returns ``(success, response_lines)`` where *success* is True when
        ``PIK-NOTIF:OK`` was received.

        Raises ``BleakError`` on connection or write failure.
        """
        if not self.is_connected:
            raise BleakError("Not connected to PIK Outlet")

        async with self._cmd_lock:
            self._cmd_response_lines = []
            self._cmd_event.clear()
            self._cmd_pending = True

            full_cmd = f"PIK-CMD:{cmd}\r\n"
            _LOGGER.debug("PIK TX: %s", full_cmd.rstrip())

            try:
                await self._client.write_gatt_char(  # type: ignore[union-attr]
                    WRITE_CHAR_UUID,
                    full_cmd.encode("ascii"),
                    response=False,
                )
            except Exception as exc:
                self._cmd_pending = False
                raise BleakError(f"BLE write failed: {exc}") from exc

            try:
                await asyncio.wait_for(self._cmd_event.wait(), timeout)
            except asyncio.TimeoutError:
                _LOGGER.warning("PIK command timeout: %s", cmd)
                self._cmd_pending = False
                return False, []

            self._cmd_pending = False
            lines = list(self._cmd_response_lines)
            success = any(RE_OK.match(l) for l in lines)

            return success, lines

    # ── High-level device commands ───────────────────────────────────────────

    async def request_full_status(self) -> None:
        """Query full device state (master + sockets + energy).

        STATUS now returns MST + SK:1-6 in a single response, so STATUS:0 is
        no longer needed as a separate call.
        Errors are logged but not raised so partial state is still usable.
        """
        for cmd in ("STATUS", "ENERGY"):
            try:
                await self.send_command(cmd)
            except BleakError:
                _LOGGER.warning("Failed to query %s", cmd)

    async def set_socket_mode(self, socket_id: int, mode: str) -> bool:
        """Set socket mode.  *socket_id*: 0-based (0-5), *mode*: OFF/MAN/CLD."""
        ok, _ = await self.send_command(f"MODE:{socket_id + 1}:{mode}")
        return ok

    async def set_all_modes(self, mode: str) -> bool:
        """Set all sockets to the same mode."""
        cmd_map = {"OFF": "ALL_OFF", "MAN": "ALL_MAN", "CLD": "ALL_CLD"}
        cmd = cmd_map.get(mode)
        if cmd is None:
            return False
        ok, _ = await self.send_command(cmd)
        return ok

    async def sync_rtc(
        self,
        year: int,
        month: int,
        day: int,
        dow: int,
        hour: int,
        minute: int,
        second: int = 0,
    ) -> bool:
        """Set the device RTC.  *year* is 2-digit (0-99)."""
        cmd = f"SET_TIME:{year}:{month}:{day}:{dow}:{hour}:{minute}:{second}"
        ok, _ = await self.send_command(cmd)
        return ok

    async def set_timer_enable(self, flags: str) -> bool:
        """Set timer enable flags — 6 chars of '0'/'1' for sockets 1-6."""
        if len(flags) != SOCKET_COUNT or not all(c in "01" for c in flags):
            return False
        ok, _ = await self.send_command(f"TIMER_EN:{flags}")
        return ok

    async def set_timer_profile(
        self,
        socket: int,
        profile: int,
        days: int,
        hour_on: int,
        minute_on: int,
        hour_off: int,
        minute_off: int,
        enabled: bool,
    ) -> bool:
        """Set a timer profile.  *socket* and *profile* are 1-based.

        Also caches the profile locally since the device has no read-back cmd.
        """
        en = 1 if enabled else 0
        cmd = (
            f"TIMER_SET:{socket}:{profile}:{days}"
            f":{hour_on}:{minute_on}:{hour_off}:{minute_off}:{en}"
        )
        ok, _ = await self.send_command(cmd)
        if ok:
            # Cache locally (0-based indices)
            si = socket - 1
            pi = profile - 1
            if 0 <= si < SOCKET_COUNT and 0 <= pi < 6:
                p = self._state.timer_profiles[si][pi]
                p.days = days
                p.hour_on = hour_on
                p.minute_on = minute_on
                p.hour_off = hour_off
                p.minute_off = minute_off
                p.enabled = enabled
        return ok

    async def send_at_command(self, at_cmd: str) -> tuple[bool, list[str]]:
        """Send an AT command through the CUSTOM proxy.

        Returns ``(success, [response_lines])`` where response_lines are
        the raw AT module output lines (without PIK-NOTIF:CUSTOM: wrapper).
        """
        ok, lines = await self.send_command(
            f"CUSTOM:{at_cmd}", timeout=AT_CMD_TIMEOUT
        )
        result: list[str] = []
        for line in lines:
            m = RE_CUSTOM.match(line)
            if m:
                result.append(m.group(1))
        return ok, result
