"""Config flow for PIK BLE 6-Switch Outlet.

Supports two entry paths:
1. **Auto-discovery** — HA's bluetooth scanner matches the FFF0 service UUID
   and triggers ``async_step_bluetooth``.  The user confirms the device.
2. **Manual setup** — the user types the BLE MAC address in ``async_step_user``.
"""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components.bluetooth import (
    BluetoothServiceInfoBleak,
    async_discovered_service_info,
)
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_ADDRESS

from .const import DOMAIN, SERVICE_UUID

_LOGGER = logging.getLogger(__name__)


class PikOutletConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for PIK Outlet."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialise flow state."""
        self._discovery_info: BluetoothServiceInfoBleak | None = None
        self._discovered_devices: dict[str, str] = {}  # address → name

    # ── Auto-discovery via bluetooth matcher ─────────────────────────────────

    async def async_step_bluetooth(
        self, discovery_info: BluetoothServiceInfoBleak
    ) -> ConfigFlowResult:
        """Handle a device found by the bluetooth scanner."""
        _LOGGER.debug(
            "PIK Outlet discovered: %s (%s)",
            discovery_info.name,
            discovery_info.address,
        )
        await self.async_set_unique_id(discovery_info.address.upper())
        self._abort_if_unique_id_configured()

        self._discovery_info = discovery_info
        self.context["title_placeholders"] = {
            "name": discovery_info.name or discovery_info.address,
        }
        return await self.async_step_bluetooth_confirm()

    async def async_step_bluetooth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Confirm a discovered device before adding it."""
        assert self._discovery_info is not None

        if user_input is not None:
            return self.async_create_entry(
                title=self._discovery_info.name or self._discovery_info.address,
                data={CONF_ADDRESS: self._discovery_info.address.upper()},
            )

        return self.async_show_form(
            step_id="bluetooth_confirm",
            description_placeholders={
                "name": self._discovery_info.name or self._discovery_info.address,
            },
        )

    # ── Manual setup ─────────────────────────────────────────────────────────

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle manual device setup.

        Shows a dropdown of discovered BLE devices advertising the FFF0 service
        UUID.  If none are found the user can still type an address manually.
        """
        errors: dict[str, str] = {}

        if user_input is not None:
            address = user_input[CONF_ADDRESS].upper().strip()
            await self.async_set_unique_id(address, raise_on_progress=False)
            self._abort_if_unique_id_configured()

            # Use the discovered name if available, else a generic title
            name = self._discovered_devices.get(address, f"PIK Outlet {address}")
            return self.async_create_entry(
                title=name,
                data={CONF_ADDRESS: address},
            )

        # Build list of candidate BLE devices
        self._discovered_devices = {}
        for info in async_discovered_service_info(self.hass, connectable=True):
            if SERVICE_UUID.lower() in [
                s.lower() for s in info.service_uuids
            ]:
                self._discovered_devices[info.address.upper()] = (
                    info.name or info.address
                )

        if self._discovered_devices:
            schema = vol.Schema(
                {
                    vol.Required(CONF_ADDRESS): vol.In(
                        {
                            addr: f"{name} ({addr})"
                            for addr, name in self._discovered_devices.items()
                        }
                    ),
                }
            )
        else:
            # No devices found — let the user type an address
            schema = vol.Schema(
                {
                    vol.Required(CONF_ADDRESS): str,
                }
            )

        return self.async_show_form(
            step_id="user",
            data_schema=schema,
            errors=errors,
        )
