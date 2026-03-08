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
from homeassistant.const import EntityCategory
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

TIMER_ENABLE_DESCRIPTIONS: tuple[PikSocketSwitchDescription, ...] = tuple(
    PikSocketSwitchDescription(
        key=f"socket_{i + 1}_timer_enable",
        translation_key=f"socket_{i + 1}_timer_enable",
        name=f"Socket {i + 1} Timer",
        icon="mdi:timer-outline",
        device_class=SwitchDeviceClass.SWITCH,
        entity_category=EntityCategory.CONFIG,
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

    entities: list[SwitchEntity] = [
        PikSocketSwitch(coordinator, desc) for desc in SOCKET_SWITCH_DESCRIPTIONS
    ]
    entities.extend(
        PikTimerEnableSwitch(coordinator, desc)
        for desc in TIMER_ENABLE_DESCRIPTIONS
    )
    async_add_entities(entities)


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
        """Expose the socket mode and lock as extra attributes."""
        state = self.coordinator.data
        if state is None:
            return {}
        sk = state.sockets[self._socket_id]
        return {"mode": sk.mode, "child_lock": sk.lock}

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


# ── Timer Enable Switch ──────────────────────────────────────────────────────

class PikTimerEnableSwitch(PikOutletEntity, SwitchEntity):
    """Per-socket timer enable/disable switch.

    Controls individual bits of the 6-char timer-enable flag string sent via
    ``TIMER_EN:XXXXXX``.  Toggling one socket preserves the other sockets'
    current timer enable state.
    """

    entity_description: PikSocketSwitchDescription

    def __init__(
        self,
        coordinator: PikOutletCoordinator,
        description: PikSocketSwitchDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._socket_id = description.socket_id
        self._attr_unique_id = (
            f"{self._mac_id}_socket_{self._socket_id + 1}_timer_enable"
        )

    # ── State ────────────────────────────────────────────────────────────────

    @property
    def is_on(self) -> bool | None:
        """Return True when the timer for this socket is enabled."""
        state = self.coordinator.data
        if state is None or not state.timer_enable:
            return None
        flags = state.timer_enable  # e.g. "110101"
        if len(flags) != SOCKET_COUNT:
            return None
        return flags[self._socket_id] == "1"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose all 6 timer profiles as structured data.

        The custom Lovelace schedule card reads these attributes to
        populate the circular clock UI for all profile slots.
        """
        state = self.coordinator.data
        if state is None:
            return {}
        profiles = state.timer_profiles[self._socket_id]
        return {
            "profiles": [
                {
                    "days": p.days,
                    "hour_on": p.hour_on,
                    "minute_on": p.minute_on,
                    "hour_off": p.hour_off,
                    "minute_off": p.minute_off,
                    "enabled": p.enabled,
                }
                for p in profiles
            ]
        }

    # ── Commands ─────────────────────────────────────────────────────────────

    async def _send_flags(self, enable: bool) -> None:
        """Build a new 6-char flag string and send it to the device."""
        state = self.coordinator.data
        current = list(state.timer_enable) if state and state.timer_enable else list("000000")
        current[self._socket_id] = "1" if enable else "0"
        await self.coordinator.client.set_timer_enable("".join(current))
        await self.coordinator.async_request_refresh()

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Enable timer for this socket."""
        await self._send_flags(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Disable timer for this socket."""
        await self._send_flags(False)

    # ── Coordinator update ───────────────────────────────────────────────────

    @callback
    def _handle_coordinator_update(self) -> None:
        self.async_write_ha_state()
