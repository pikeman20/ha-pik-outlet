"""PIK BLE 6-Switch Outlet — Home Assistant integration.

Provides control and monitoring of PIK's 6-channel BLE smart outlet:
* 6 × Switch entities (on/off per socket)
* 6 × Switch entities (timer enable per socket)
* 6 × Select entities (mode: Off / Manual / Cloud per socket)
* 1 × Select entity (master mode for all sockets)
* 6 × Select entities (schedule day pattern per socket)
* 12 × Time entities (schedule ON/OFF time per socket)
* 1 × Binary sensor (global child lock)
* 6 × Binary sensor (per-socket child lock)
* 4 × Sensor entities (voltage, current, power, frequency)
* 2 × Diagnostic sensor entities (device clock, timer flags)
* 2 × Button entities (sync time, refresh status)
* 4 × Services (timer management, raw command, time sync)
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_ADDRESS, Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ConfigEntryNotReady, HomeAssistantError
from homeassistant.helpers import device_registry as dr
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    SERVICE_SEND_RAW_COMMAND,
    SERVICE_SET_TIMER_ENABLE,
    SERVICE_SET_TIMER_PROFILE,
    SERVICE_SYNC_TIME,
)
from .coordinator import PikOutletCoordinator
from .pik_ble import PikBLEClient

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.SELECT,
    Platform.SENSOR,
    Platform.SWITCH,
    Platform.TIME,
]


# ══════════════════════════════════════════════════════════════════════════════
# Domain-level setup (once per HA session — registers the custom Lovelace card)
# ══════════════════════════════════════════════════════════════════════════════

async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Register the PIK Schedule Card as a Lovelace frontend resource."""
    from homeassistant.components.frontend import add_extra_js_url

    www_dir = os.path.join(os.path.dirname(__file__), "www")
    card_path = os.path.join(www_dir, "pik-schedule-card.js")

    hass.http.register_static_path(
        f"/{DOMAIN}/pik-schedule-card.js", card_path, cache_headers=False
    )
    add_extra_js_url(hass, f"/{DOMAIN}/pik-schedule-card.js")

    return True


# ══════════════════════════════════════════════════════════════════════════════
# Setup / Unload
# ══════════════════════════════════════════════════════════════════════════════

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up PIK Outlet from a config entry."""
    from homeassistant.components.bluetooth import async_ble_device_from_address

    address: str = entry.data[CONF_ADDRESS]

    # Resolve BLEDevice from the HA bluetooth stack
    ble_device = async_ble_device_from_address(hass, address.upper(), connectable=True)
    if ble_device is None:
        raise ConfigEntryNotReady(
            f"PIK Outlet {address} not found. "
            "Make sure the device is powered on and within BLE range."
        )

    # Create BLE client and coordinator
    client = PikBLEClient(hass, address)
    client.set_ble_device(ble_device)

    coordinator = PikOutletCoordinator(hass, client, entry)

    # First connection + status query
    await coordinator.async_config_entry_first_refresh()

    # Store coordinator for platforms and services
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    # Forward to entity platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register integration-level services (idempotent)
    await _async_setup_services(hass)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a PIK Outlet config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        coordinator: PikOutletCoordinator = hass.data[DOMAIN].pop(entry.entry_id)
        await coordinator.client.disconnect()

    # Remove services when no entries remain
    if not hass.data.get(DOMAIN):
        hass.data.pop(DOMAIN, None)
        for svc in (
            SERVICE_SET_TIMER_ENABLE,
            SERVICE_SET_TIMER_PROFILE,
            SERVICE_SEND_RAW_COMMAND,
            SERVICE_SYNC_TIME,
        ):
            hass.services.async_remove(DOMAIN, svc)

    return unload_ok


# ══════════════════════════════════════════════════════════════════════════════
# Services
# ══════════════════════════════════════════════════════════════════════════════

def _get_coordinator(hass: HomeAssistant, device_id: str) -> PikOutletCoordinator:
    """Resolve a coordinator from an HA device_id."""
    dev_reg = dr.async_get(hass)
    device = dev_reg.async_get(device_id)
    if device is None:
        raise HomeAssistantError(f"Device {device_id} not found")

    for entry_id in device.config_entries:
        coord = hass.data.get(DOMAIN, {}).get(entry_id)
        if coord is not None:
            return coord

    raise HomeAssistantError(f"No PIK Outlet coordinator for device {device_id}")


async def _async_setup_services(hass: HomeAssistant) -> None:
    """Register integration-level services (called once, idempotent)."""

    if hass.services.has_service(DOMAIN, SERVICE_SET_TIMER_ENABLE):
        return  # Already registered

    # ── set_timer_enable ─────────────────────────────────────────────────

    async def handle_set_timer_enable(call: ServiceCall) -> None:
        device_id: str = call.data["device_id"]
        flags: str = call.data["flags"]

        if len(flags) != 6 or not all(c in "01" for c in flags):
            raise HomeAssistantError(
                "flags must be a 6-character string of '0' and '1'"
            )

        coordinator = _get_coordinator(hass, device_id)
        ok = await coordinator.client.set_timer_enable(flags)
        if not ok:
            raise HomeAssistantError("Device rejected set_timer_enable command")

    hass.services.async_register(
        DOMAIN, SERVICE_SET_TIMER_ENABLE, handle_set_timer_enable
    )

    # ── set_timer_profile ────────────────────────────────────────────────

    async def handle_set_timer_profile(call: ServiceCall) -> None:
        device_id: str = call.data["device_id"]
        coordinator = _get_coordinator(hass, device_id)

        ok = await coordinator.client.set_timer_profile(
            socket=int(call.data["socket"]),
            profile=int(call.data["profile"]),
            days=int(call.data["days"]),
            hour_on=int(call.data["hour_on"]),
            minute_on=int(call.data["minute_on"]),
            hour_off=int(call.data["hour_off"]),
            minute_off=int(call.data["minute_off"]),
            enabled=bool(call.data["enabled"]),
        )
        if not ok:
            raise HomeAssistantError("Device rejected set_timer_profile command")

    hass.services.async_register(
        DOMAIN, SERVICE_SET_TIMER_PROFILE, handle_set_timer_profile
    )

    # ── send_raw_command ─────────────────────────────────────────────────

    async def handle_send_raw_command(call: ServiceCall) -> None:
        device_id: str = call.data["device_id"]
        command: str = call.data["command"]

        coordinator = _get_coordinator(hass, device_id)
        ok, lines = await coordinator.client.send_command(command)
        _LOGGER.info(
            "Raw command '%s' → ok=%s, response=%s", command, ok, lines
        )
        if not ok:
            raise HomeAssistantError(
                f"Command failed. Response: {lines}"
            )

    hass.services.async_register(
        DOMAIN, SERVICE_SEND_RAW_COMMAND, handle_send_raw_command
    )

    # ── sync_time ────────────────────────────────────────────────────────

    async def handle_sync_time(call: ServiceCall) -> None:
        device_id: str = call.data["device_id"]
        coordinator = _get_coordinator(hass, device_id)

        now: datetime = dt_util.now()
        py_wd = now.weekday()  # Mon=0 .. Sun=6
        dow = py_wd + 2       # Mon→2, Tue→3, ..., Sat→7, Sun→1+7=8→1
        if dow > 7:
            dow -= 7

        ok = await coordinator.client.sync_rtc(
            year=now.year % 100,
            month=now.month,
            day=now.day,
            dow=dow,
            hour=now.hour,
            minute=now.minute,
            second=now.second,
        )
        if not ok:
            raise HomeAssistantError("Failed to sync device RTC")

    hass.services.async_register(
        DOMAIN, SERVICE_SYNC_TIME, handle_sync_time
    )
