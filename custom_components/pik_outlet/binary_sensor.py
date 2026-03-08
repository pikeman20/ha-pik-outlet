"""Binary sensor platform for PIK BLE 6-Switch Outlet.

Exposes child-lock status:
* **Global Child Lock** — master lock reported via ``PIK-NOTIF:MST:M=XXX:LOCK=X``
* **Socket 1–6 Child Lock** — per-socket lock from ``PIK-NOTIF:SK:N:M=XXX:R=X:L=X``
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
    BinarySensorEntityDescription,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SOCKET_COUNT
from .coordinator import PikOutletCoordinator
from .entity import PikOutletEntity

_LOGGER = logging.getLogger(__name__)


# ── Descriptions ─────────────────────────────────────────────────────────────

@dataclass(frozen=True, kw_only=True)
class PikLockBinarySensorDescription(BinarySensorEntityDescription):
    """Binary sensor description with socket index (-1 means global)."""
    socket_id: int = -1  # -1 = global lock


GLOBAL_LOCK_DESCRIPTION = PikLockBinarySensorDescription(
    key="child_lock",
    translation_key="child_lock",
    name="Child Lock",
    icon="mdi:lock",
    device_class=BinarySensorDeviceClass.LOCK,
    entity_category=EntityCategory.DIAGNOSTIC,
    socket_id=-1,
)

SOCKET_LOCK_DESCRIPTIONS: tuple[PikLockBinarySensorDescription, ...] = tuple(
    PikLockBinarySensorDescription(
        key=f"socket_{i + 1}_child_lock",
        translation_key=f"socket_{i + 1}_child_lock",
        name=f"Socket {i + 1} Child Lock",
        icon="mdi:lock-outline",
        device_class=BinarySensorDeviceClass.LOCK,
        entity_category=EntityCategory.DIAGNOSTIC,
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
    """Set up PIK Outlet binary sensor entities."""
    coordinator: PikOutletCoordinator = hass.data[DOMAIN][entry.entry_id]

    entities: list[BinarySensorEntity] = [
        PikLockBinarySensor(coordinator, GLOBAL_LOCK_DESCRIPTION),
    ]
    entities.extend(
        PikLockBinarySensor(coordinator, desc) for desc in SOCKET_LOCK_DESCRIPTIONS
    )
    async_add_entities(entities)


# ── Entity implementation ────────────────────────────────────────────────────

class PikLockBinarySensor(PikOutletEntity, BinarySensorEntity):
    """Binary sensor for child-lock state (global or per-socket).

    NOTE: ``BinarySensorDeviceClass.LOCK`` semantics: ``is_on = True`` means
    **unlocked** in HA convention.  We invert: lock active → is_on = False
    (locked icon).
    """

    entity_description: PikLockBinarySensorDescription

    def __init__(
        self,
        coordinator: PikOutletCoordinator,
        description: PikLockBinarySensorDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._socket_id = description.socket_id
        if self._socket_id < 0:
            self._attr_unique_id = f"{self._mac_id}_child_lock"
        else:
            self._attr_unique_id = (
                f"{self._mac_id}_socket_{self._socket_id + 1}_child_lock"
            )

    @property
    def is_on(self) -> bool | None:
        """Return True when *un*locked, False when locked (HA LOCK convention)."""
        state = self.coordinator.data
        if state is None:
            return None
        if self._socket_id < 0:
            # Global lock from master status
            return not state.master.lock
        # Per-socket lock
        return not state.sockets[self._socket_id].lock

    @callback
    def _handle_coordinator_update(self) -> None:
        self.async_write_ha_state()
