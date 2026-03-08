"""Time platform for PIK BLE 6-Switch Outlet.

Exposes turn-ON / turn-OFF time pickers for **Profile 1** of each socket.
When a user changes any time, the full ``TIMER_SET`` command is re-sent to
the device with all cached profile-1 parameters.

Profile 1 is the "primary schedule" exposed on the dashboard.
Profiles 2-6 are still configurable via the ``set_timer_profile`` service.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import time as dt_time

from homeassistant.components.time import TimeEntity, TimeEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SOCKET_COUNT
from .coordinator import PikOutletCoordinator
from .entity import PikOutletEntity

_LOGGER = logging.getLogger(__name__)

PROFILE_SLOT = 1  # We expose profile 1 via the dashboard entities


# ── Entity descriptions ──────────────────────────────────────────────────────

@dataclass(frozen=True, kw_only=True)
class PikScheduleTimeDescription(TimeEntityDescription):
    """Describes a schedule ON or OFF time entity."""

    socket_id: int = 0        # 0-based
    is_off_time: bool = False  # False → ON time, True → OFF time


SCHEDULE_TIME_DESCRIPTIONS: tuple[PikScheduleTimeDescription, ...] = tuple(
    desc
    for i in range(SOCKET_COUNT)
    for desc in (
        PikScheduleTimeDescription(
            key=f"socket_{i + 1}_schedule_on",
            translation_key=f"socket_{i + 1}_schedule_on",
            name=f"Socket {i + 1} Schedule ON",
            icon="mdi:clock-start",
            entity_category=EntityCategory.CONFIG,
            socket_id=i,
            is_off_time=False,
        ),
        PikScheduleTimeDescription(
            key=f"socket_{i + 1}_schedule_off",
            translation_key=f"socket_{i + 1}_schedule_off",
            name=f"Socket {i + 1} Schedule OFF",
            icon="mdi:clock-end",
            entity_category=EntityCategory.CONFIG,
            socket_id=i,
            is_off_time=True,
        ),
    )
)


# ── Platform setup ───────────────────────────────────────────────────────────

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up PIK Outlet schedule time entities."""
    coordinator: PikOutletCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        PikScheduleTime(coordinator, desc) for desc in SCHEDULE_TIME_DESCRIPTIONS
    )


# ── Entity implementation ────────────────────────────────────────────────────

class PikScheduleTime(PikOutletEntity, TimeEntity):
    """Time entity for a socket schedule ON or OFF time (profile 1)."""

    entity_description: PikScheduleTimeDescription

    def __init__(
        self,
        coordinator: PikOutletCoordinator,
        description: PikScheduleTimeDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._socket_id = description.socket_id
        self._is_off = description.is_off_time
        suffix = "schedule_off" if self._is_off else "schedule_on"
        self._attr_unique_id = (
            f"{self._mac_id}_socket_{self._socket_id + 1}_{suffix}"
        )

    # ── State ────────────────────────────────────────────────────────────────

    @property
    def native_value(self) -> dt_time | None:
        """Return the cached ON or OFF time for profile 1."""
        state = self.coordinator.data
        if state is None:
            return None
        profile = state.timer_profiles[self._socket_id][PROFILE_SLOT - 1]
        if self._is_off:
            return dt_time(profile.hour_off, profile.minute_off)
        return dt_time(profile.hour_on, profile.minute_on)

    # ── Commands ─────────────────────────────────────────────────────────────

    async def async_set_value(self, value: dt_time) -> None:
        """Update the ON or OFF time and re-send the full profile."""
        state = self.coordinator.data
        if state is None:
            return

        profile = state.timer_profiles[self._socket_id][PROFILE_SLOT - 1]

        if self._is_off:
            hour_off, minute_off = value.hour, value.minute
            hour_on, minute_on = profile.hour_on, profile.minute_on
        else:
            hour_on, minute_on = value.hour, value.minute
            hour_off, minute_off = profile.hour_off, profile.minute_off

        await self.coordinator.client.set_timer_profile(
            socket=self._socket_id + 1,
            profile=PROFILE_SLOT,
            days=profile.days if profile.days else 127,  # default every day
            hour_on=hour_on,
            minute_on=minute_on,
            hour_off=hour_off,
            minute_off=minute_off,
            enabled=True,  # auto-enable profile when user sets a time
        )
        await self.coordinator.async_request_refresh()

    # ── Coordinator update ───────────────────────────────────────────────────

    @callback
    def _handle_coordinator_update(self) -> None:
        self.async_write_ha_state()
