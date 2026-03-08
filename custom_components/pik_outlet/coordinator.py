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
  and re-requests full status.  When already connected the poll is a no-op.
"""
from __future__ import annotations

import logging
from datetime import timedelta

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

        # Wire push-path: BLE notifications → coordinator → entities
        self.client.set_state_callback(self._handle_state_update)

    # ── Push path (notification-driven) ──────────────────────────────────────

    @callback
    def _handle_state_update(self) -> None:
        """Called by ``PikBLEClient`` when parsed state changes."""
        self.async_set_updated_data(self.client.state)

    # ── Poll path (heartbeat / reconnect) ────────────────────────────────────

    async def _async_update_data(self) -> DeviceState:
        """Called every ``update_interval`` and on first refresh.

        If the BLE link is down, attempt reconnection.  Otherwise return
        current cached state (real-time data arrives via notifications).
        """
        try:
            if not self.client.is_connected:
                await self._reconnect()
            return self.client.state
        except BleakError as exc:
            raise UpdateFailed(f"BLE communication error: {exc}") from exc
        except Exception as exc:  # noqa: BLE001
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
