"""Switch platform for PIK BLE 6-Switch Outlet.

Exposes 6 switch entities (Socket 1 – Socket 6).

Mapping:
* **Switch ON**  → ``PIK-CMD:MODE:N:MAN``  (relay turns on)
* **Switch OFF** → ``PIK-CMD:MODE:N:OFF``  (relay turns off)
* ``is_on``      → relay state as reported by the device (R=0/1)

If the socket is in *Cloud* mode and a timer turns the relay on, the switch
shows ON.  Toggling the switch explicitly overrides to Manual or Off.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from homeassistant.components.switch import (
    SwitchDeviceClass,
    SwitchEntity,
    SwitchEntityDescription,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, MODE_MANUAL, MODE_OFF, SOCKET_COUNT
from .coordinator import PikOutletCoordinator
from .entity import PikOutletEntity

_LOGGER = logging.getLogger(__name__)


# ── Entity descriptions ──────────────────────────────────────────────────────

@dataclass(frozen=True, kw_only=True)
class PikSocketSwitchDescription(SwitchEntityDescription):
    """Describes a socket switch entity."""
    socket_id: int = 0  # 0-based index


SOCKET_SWITCH_DESCRIPTIONS: tuple[PikSocketSwitchDescription, ...] = tuple(
    PikSocketSwitchDescription(
        key=f"socket_{i + 1}",
        translation_key=f"socket_{i + 1}",
        name=f"Socket {i + 1}",
        icon="mdi:power-socket-eu",
        device_class=SwitchDeviceClass.OUTLET,
        socket_id=i,
    )
    for i in range(SOCKET_COUNT)
)


# ── Platform setup ───────────────────────────────────────────────────────────

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up PIK Outlet switch entities."""
    coordinator: PikOutletCoordinator = hass.data[DOMAIN][entry.entry_id]

    async_add_entities(
        PikSocketSwitch(coordinator, desc) for desc in SOCKET_SWITCH_DESCRIPTIONS
    )


# ── Entity implementation ────────────────────────────────────────────────────

class PikSocketSwitch(PikOutletEntity, SwitchEntity):
    """Represents one of the 6 outlet sockets as an on/off switch."""

    entity_description: PikSocketSwitchDescription

    def __init__(
        self,
        coordinator: PikOutletCoordinator,
        description: PikSocketSwitchDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._socket_id = description.socket_id
        self._attr_unique_id = f"{self._mac_id}_socket_{self._socket_id + 1}_switch"

    # ── State ────────────────────────────────────────────────────────────────

    @property
    def is_on(self) -> bool | None:
        """Return True when the relay is ON."""
        state = self.coordinator.data
        if state is None:
            return None
        return state.sockets[self._socket_id].relay

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose the socket mode as an extra attribute."""
        state = self.coordinator.data
        if state is None:
            return {}
        return {"mode": state.sockets[self._socket_id].mode}

    # ── Commands ─────────────────────────────────────────────────────────────

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Turn relay ON by setting mode to MANUAL."""
        await self.coordinator.client.set_socket_mode(
            self._socket_id, MODE_MANUAL
        )
        await self.coordinator.async_request_refresh()

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Turn relay OFF by setting mode to OFF."""
        await self.coordinator.client.set_socket_mode(
            self._socket_id, MODE_OFF
        )
        await self.coordinator.async_request_refresh()

    # ── Coordinator update ───────────────────────────────────────────────────

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from coordinator."""
        self.async_write_ha_state()
