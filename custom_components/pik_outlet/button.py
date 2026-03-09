"""Button platform for PIK BLE 6-Switch Outlet.

Exposes:
* **Sync Time** — synchronise the device RTC to Home Assistant's local time.
* **Refresh Status** — force a full status query from the device.
"""
from __future__ import annotations

import logging
from datetime import datetime

from homeassistant.components.button import (
    ButtonDeviceClass,
    ButtonEntity,
    ButtonEntityDescription,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .coordinator import PikOutletCoordinator
from .entity import PikOutletEntity

_LOGGER = logging.getLogger(__name__)


# ── Platform setup ───────────────────────────────────────────────────────────

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up PIK Outlet button entities."""
    coordinator: PikOutletCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            PikSyncTimeButton(coordinator),
            PikRefreshButton(coordinator),
        ]
    )


# ── Sync Time Button ────────────────────────────────────────────────────────

class PikSyncTimeButton(PikOutletEntity, ButtonEntity):
    """Button that syncs the device RTC to HA's local time."""

    _attr_name = "Sync Time"
    _attr_icon = "mdi:clock-check"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coordinator: PikOutletCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{self._mac_id}_sync_time"

    async def async_press(self) -> None:
        """Send current local time to device RTC."""
        now: datetime = dt_util.now()

        # Python weekday: Mon=0..Sun=6 → device DOW: 1=Sun,2=Mon,...,7=Sat
        py_wd = now.weekday()  # Mon=0, Tue=1, ..., Sun=6
        dow = py_wd + 2        # Mon→2, Tue→3, ..., Sat→7, Sun→8
        if dow > 7:
            dow -= 7           # Sun: 8→1

        year_2digit = now.year % 100

        ok = await self.coordinator.client.sync_rtc(
            year=year_2digit,
            month=now.month,
            day=now.day,
            dow=dow,
            hour=now.hour,
            minute=now.minute,
            second=now.second,
        )
        if ok:
            _LOGGER.info("RTC synced to %s", now.isoformat())
        else:
            _LOGGER.warning("Failed to sync RTC")
        # State already updated via send_command push callback — no blocking refresh


# ── Refresh Button ───────────────────────────────────────────────────────────

class PikRefreshButton(PikOutletEntity, ButtonEntity):
    """Button that forces a full device status refresh."""

    _attr_name = "Refresh Status"
    _attr_icon = "mdi:refresh"
    _attr_device_class = ButtonDeviceClass.RESTART
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: PikOutletCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{self._mac_id}_refresh"

    async def async_press(self) -> None:
        """Force full status query."""
        if self.coordinator.client.is_connected:
            await self.coordinator.client.request_full_status()
        # Refresh button: Full status already queried above — callback handles the rest
