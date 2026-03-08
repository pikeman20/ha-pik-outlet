"""Select platform for PIK BLE 6-Switch Outlet.

Exposes mode-selection entities:
* **Socket 1 Mode** … **Socket 6 Mode** — per-socket mode selector
* **Master Mode** — sets all sockets to the chosen mode simultaneously
* **Socket 1 Schedule Days** … **Socket 6 Schedule Days** — day pattern for
  profile 1 schedule (Every Day, Weekdays, Weekends, Mon–Sat)

Options: Off / Manual / Cloud
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from homeassistant.components.select import SelectEntity, SelectEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
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


# ── Day pattern mapping ──────────────────────────────────────────────────────
# Bitmask: bit0=Sun, bit1=Mon, bit2=Tue, ..., bit6=Sat
DAY_PATTERN_MAP: dict[str, int] = {
    "Every Day": 0b1111111,    # 127
    "Weekdays": 0b0111110,     # 62  Mon-Fri
    "Weekends": 0b1000001,     # 65  Sun+Sat
    "Mon – Sat": 0b1111110,    # 126
    "Mon – Fri": 0b0111110,    # 62  alias for Weekdays (kept for clarity)
    "Sun only": 0b0000001,     # 1
    "Sat only": 0b1000000,     # 64
}
DAY_PATTERN_FROM_BITMASK: dict[int, str] = {v: k for k, v in DAY_PATTERN_MAP.items()}
# Remove duplicate bitmask (62 appears twice)
DAY_PATTERN_FROM_BITMASK[62] = "Weekdays"
DAY_PATTERN_OPTIONS = list(DAY_PATTERN_MAP.keys())

PROFILE_SLOT = 1  # dashboard entities control profile 1


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


# ── Schedule day-pattern descriptions ────────────────────────────────────────

@dataclass(frozen=True, kw_only=True)
class PikScheduleDayDescription(SelectEntityDescription):
    """Describes a schedule day-pattern select entity."""
    socket_id: int = 0  # 0-based


SCHEDULE_DAY_DESCRIPTIONS: tuple[PikScheduleDayDescription, ...] = tuple(
    PikScheduleDayDescription(
        key=f"socket_{i + 1}_schedule_days",
        translation_key=f"socket_{i + 1}_schedule_days",
        name=f"Socket {i + 1} Schedule Days",
        icon="mdi:calendar-week",
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
    """Set up PIK Outlet select entities."""
    coordinator: PikOutletCoordinator = hass.data[DOMAIN][entry.entry_id]

    entities: list[SelectEntity] = [
        PikModeSelect(coordinator, desc) for desc in SOCKET_MODE_DESCRIPTIONS
    ]
    entities.append(PikModeSelect(coordinator, MASTER_MODE_DESCRIPTION))
    entities.extend(
        PikScheduleDaySelect(coordinator, desc)
        for desc in SCHEDULE_DAY_DESCRIPTIONS
    )

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


# ── Schedule Day-Pattern Select ──────────────────────────────────────────────

class PikScheduleDaySelect(PikOutletEntity, SelectEntity):
    """Select entity for choosing which days profile 1 is active.

    Presents common presets (Every Day, Weekdays, Weekends, Mon-Sat).
    Selecting a pattern re-sends the full ``TIMER_SET`` for profile 1 with the
    chosen bitmask, preserving the cached ON/OFF times.
    """

    entity_description: PikScheduleDayDescription

    def __init__(
        self,
        coordinator: PikOutletCoordinator,
        description: PikScheduleDayDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._socket_id = description.socket_id
        self._attr_options = DAY_PATTERN_OPTIONS
        self._attr_unique_id = (
            f"{self._mac_id}_socket_{self._socket_id + 1}_schedule_days"
        )

    @property
    def current_option(self) -> str | None:
        """Return the current day pattern label (or 'Custom' / None)."""
        state = self.coordinator.data
        if state is None:
            return None
        profile = state.timer_profiles[self._socket_id][PROFILE_SLOT - 1]
        bitmask = profile.days
        label = DAY_PATTERN_FROM_BITMASK.get(bitmask)
        if label is not None:
            return label
        # Unknown bitmask — show as "Every Day" (the safest default) in the
        # UI but don't match a real option so HA shows "unknown".
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Show the raw bitmask for debugging."""
        state = self.coordinator.data
        if state is None:
            return {}
        profile = state.timer_profiles[self._socket_id][PROFILE_SLOT - 1]
        return {"days_bitmask": profile.days, "days_binary": f"0b{profile.days:07b}"}

    async def async_select_option(self, option: str) -> None:
        """Apply the chosen day pattern to profile 1 and re-send."""
        bitmask = DAY_PATTERN_MAP.get(option)
        if bitmask is None:
            _LOGGER.error("Unknown day pattern: %s", option)
            return

        state = self.coordinator.data
        if state is None:
            return

        profile = state.timer_profiles[self._socket_id][PROFILE_SLOT - 1]

        await self.coordinator.client.set_timer_profile(
            socket=self._socket_id + 1,
            profile=PROFILE_SLOT,
            days=bitmask,
            hour_on=profile.hour_on,
            minute_on=profile.minute_on,
            hour_off=profile.hour_off,
            minute_off=profile.minute_off,
            enabled=True,  # auto-enable when user picks days
        )
        await self.coordinator.async_request_refresh()

    @callback
    def _handle_coordinator_update(self) -> None:
        self.async_write_ha_state()
