"""DataUpdateCoordinator for PIK BLE 6-Switch Outlet.

Wraps ``PikBLEClient`` and bridges BLE notification-driven updates into the
Home Assistant ``DataUpdateCoordinator`` pattern.

Update sources
--------------
* **Notifications (push)**  – the BLE client parses incoming PIK-NOTIF lines
  and calls ``_handle_state_update`` which pushes data to all entities via
  ``async_set_updated_data``.
* **Polling (heartbeat)**   – every ``POLL_INTERVAL_SECONDS`` the coordinator
  verifies the BLE link is alive.  If disconnected it attempts reconnection
  and re-requests full status.  When already connected it actively queries
  STATUS + STATUS:0 + ENERGY to catch physical button presses and timer
  changes that may have been missed.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Callable

from bleak.exc import BleakError

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers.update_coordinator import (
    DataUpdateCoordinator,
    UpdateFailed,
)

from homeassistant.const import CONF_ADDRESS

from .const import (
    DOMAIN,
    POLL_INTERVAL_SECONDS,
    RECONNECT_RETRY_SECONDS,
)
from .pik_ble import DeviceState, PikBLEClient

_LOGGER = logging.getLogger(__name__)


class PikOutletCoordinator(DataUpdateCoordinator[DeviceState]):
    """Coordinator that owns the BLE client and distributes state to entities."""

    config_entry: ConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
        client: PikBLEClient,
        entry: ConfigEntry,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"PIK Outlet {entry.title}",
            update_interval=timedelta(seconds=POLL_INTERVAL_SECONDS),
            config_entry=entry,
        )
        self.client = client
        self.address: str = entry.data[CONF_ADDRESS]

        # BLE advertisement watcher — cancelled on unload
        self._ble_watch_cancel: Callable[[], None] | None = None

        # Wire push-path: BLE notifications → coordinator → entities
        self.client.set_state_callback(self._handle_state_update)

    # ── BLE advertisement watcher (fast reconnect on power-on) ────────────────

    def start_ble_watch(self) -> None:
        """Register BLE advertisement callback for near-instant reconnect.

        When the device powers back on it starts advertising immediately.
        HA's bluetooth stack fires this callback within seconds, letting us
        trigger a reconnect without waiting for the next poll interval.
        """
        from homeassistant.components.bluetooth import (
            async_register_callback,
            BluetoothCallbackMatcher,
            BluetoothScanningMode,
        )

        self._ble_watch_cancel = async_register_callback(
            self.hass,
            self._handle_ble_advertisement,
            BluetoothCallbackMatcher(address=self.address.upper()),
            BluetoothScanningMode.ACTIVE,
        )
        _LOGGER.debug("PIK Outlet %s: BLE advertisement watcher started", self.address)

    def stop_ble_watch(self) -> None:
        """Cancel the BLE advertisement watcher."""
        if self._ble_watch_cancel is not None:
            self._ble_watch_cancel()
            self._ble_watch_cancel = None
            _LOGGER.debug("PIK Outlet %s: BLE advertisement watcher stopped", self.address)

    @callback
    def _handle_ble_advertisement(self, service_info, change) -> None:  # noqa: ANN001
        """BLE advertisement seen — reconnect immediately if we are disconnected.

        This fires when the device powers on and begins advertising, allowing
        reconnection in seconds instead of waiting for the next poll interval.
        """
        if not self.client.is_connected:
            _LOGGER.debug(
                "PIK Outlet %s advertising — triggering immediate reconnect",
                self.address,
            )
            self.hass.async_create_task(self.async_request_refresh())

    # ── Push path (notification-driven) ──────────────────────────────────────

    @callback
    def _handle_state_update(self) -> None:
        """Called by ``PikBLEClient`` when parsed state changes."""
        self.async_set_updated_data(self.client.state)

    # ── Poll path (heartbeat / reconnect) ────────────────────────────────────

    async def _async_update_data(self) -> DeviceState:
        """Called every ``update_interval`` and on first refresh.

        If the BLE link is down, attempt reconnection.
        When already connected, actively poll STATUS + STATUS:0 + ENERGY to
        catch state changes caused by physical button presses or timers that
        might have been missed due to BLE notification gaps.
        """
        try:
            if not self.client.is_connected:
                await self._reconnect()
            else:
                # Active poll – ensures HA state matches the physical device.
                await self.client.request_full_status()
                _LOGGER.debug(
                    "PIK Outlet %s status polled successfully", self.address
                )
            # Reconnect succeeded — restore normal heartbeat interval
            self.update_interval = timedelta(seconds=POLL_INTERVAL_SECONDS)
            return self.client.state
        except BleakError as exc:
            # Device still offline — switch to faster retry interval so we
            # recover promptly if the advertisement callback was missed.
            self.update_interval = timedelta(seconds=RECONNECT_RETRY_SECONDS)
            raise UpdateFailed(f"BLE communication error: {exc}") from exc
        except Exception as exc:  # noqa: BLE001
            self.update_interval = timedelta(seconds=RECONNECT_RETRY_SECONDS)
            raise UpdateFailed(f"Unexpected error: {exc}") from exc

    async def _reconnect(self) -> None:
        """Re-acquire BLEDevice reference, connect, and request full status."""
        from homeassistant.components.bluetooth import (
            async_ble_device_from_address,
        )

        ble_device = async_ble_device_from_address(
            self.hass, self.address.upper(), connectable=True
        )
        if ble_device is None:
            raise BleakError(
                f"PIK Outlet {self.address} not found by bluetooth stack"
            )

        self.client.set_ble_device(ble_device)
        await self.client.connect()
        await self.client.request_full_status()
        _LOGGER.info("PIK Outlet %s reconnected and status refreshed", self.address)
