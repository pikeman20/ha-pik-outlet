"""Select platform for PIK BLE 6-Switch Outlet.

Exposes mode-selection entities:
* **Socket 1 Mode** … **Socket 6 Mode** — per-socket mode selector
* **Master Mode** — sets all sockets to the chosen mode simultaneously

Options: Off / Manual / Cloud
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from homeassistant.components.select import SelectEntity, SelectEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    DOMAIN,
    MODE_CLOUD,
    MODE_FROM_LABEL,
    MODE_LABELS,
    MODE_MANUAL,
    MODE_OFF,
    SOCKET_COUNT,
)
from .coordinator import PikOutletCoordinator
from .entity import PikOutletEntity

_LOGGER = logging.getLogger(__name__)

# Human-readable option list (must match MODE_LABELS values)
MODE_OPTIONS = list(MODE_LABELS.values())  # ["Off", "Manual", "Cloud"]


# ── Entity descriptions ──────────────────────────────────────────────────────

@dataclass(frozen=True, kw_only=True)
class PikSocketModeDescription(SelectEntityDescription):
    """Describes a socket mode select entity."""
    socket_id: int = 0  # 0-based, -1 for master


SOCKET_MODE_DESCRIPTIONS: tuple[PikSocketModeDescription, ...] = tuple(
    PikSocketModeDescription(
        key=f"socket_{i + 1}_mode",
        translation_key=f"socket_{i + 1}_mode",
        name=f"Socket {i + 1} Mode",
        icon="mdi:toggle-switch-variant-off",
        socket_id=i,
    )
    for i in range(SOCKET_COUNT)
)

MASTER_MODE_DESCRIPTION = PikSocketModeDescription(
    key="master_mode",
    translation_key="master_mode",
    name="Master Mode",
    icon="mdi:home-switch",
    socket_id=-1,
)


# ── Platform setup ───────────────────────────────────────────────────────────

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up PIK Outlet select entities."""
    coordinator: PikOutletCoordinator = hass.data[DOMAIN][entry.entry_id]

    entities: list[PikModeSelect] = [
        PikModeSelect(coordinator, desc) for desc in SOCKET_MODE_DESCRIPTIONS
    ]
    entities.append(PikModeSelect(coordinator, MASTER_MODE_DESCRIPTION))

    async_add_entities(entities)


# ── Entity implementation ────────────────────────────────────────────────────

class PikModeSelect(PikOutletEntity, SelectEntity):
    """Select entity for socket / master mode (Off / Manual / Cloud)."""

    entity_description: PikSocketModeDescription

    def __init__(
        self,
        coordinator: PikOutletCoordinator,
        description: PikSocketModeDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._socket_id = description.socket_id
        self._attr_options = MODE_OPTIONS

        if self._socket_id >= 0:
            self._attr_unique_id = (
                f"{self._mac_id}_socket_{self._socket_id + 1}_mode"
            )
        else:
            self._attr_unique_id = f"{self._mac_id}_master_mode"

    # ── State ────────────────────────────────────────────────────────────────

    @property
    def current_option(self) -> str | None:
        """Return the current mode as a human-readable label."""
        state = self.coordinator.data
        if state is None:
            return None

        if self._socket_id >= 0:
            raw_mode = state.sockets[self._socket_id].mode
        else:
            raw_mode = state.master.mode

        return MODE_LABELS.get(raw_mode, "Off")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose additional context for the socket."""
        state = self.coordinator.data
        if state is None:
            return {}

        if self._socket_id >= 0:
            return {
                "relay": state.sockets[self._socket_id].relay,
            }
        return {
            "lock": state.master.lock,
        }

    # ── Commands ─────────────────────────────────────────────────────────────

    async def async_select_option(self, option: str) -> None:
        """Set the selected mode on the device."""
        raw_mode = MODE_FROM_LABEL.get(option)
        if raw_mode is None:
            _LOGGER.error("Unknown mode option: %s", option)
            return

        if self._socket_id >= 0:
            await self.coordinator.client.set_socket_mode(
                self._socket_id, raw_mode
            )
        else:
            await self.coordinator.client.set_all_modes(raw_mode)

        await self.coordinator.async_request_refresh()

    # ── Coordinator update ───────────────────────────────────────────────────

    @callback
    def _handle_coordinator_update(self) -> None:
        self.async_write_ha_state()
