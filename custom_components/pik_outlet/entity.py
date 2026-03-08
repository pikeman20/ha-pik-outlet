"""Base entity for PIK BLE 6-Switch Outlet."""
from __future__ import annotations

from homeassistant.helpers.device_registry import CONNECTION_BLUETOOTH, DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, MANUFACTURER, MODEL
from .coordinator import PikOutletCoordinator


class PikOutletEntity(CoordinatorEntity[PikOutletCoordinator]):
    """Base class for all PIK Outlet entities.

    Provides:
    * Shared ``DeviceInfo`` so all entities group under a single HA device.
    * ``available`` override tied to BLE connection state.
    * ``_attr_has_entity_name = True`` so entity names are relative to device.
    """

    _attr_has_entity_name = True

    def __init__(self, coordinator: PikOutletCoordinator) -> None:
        super().__init__(coordinator)
        self._address = coordinator.address
        self._mac_id = coordinator.address.replace(":", "").lower()

    @property
    def device_info(self) -> DeviceInfo:
        """Return shared device info for the outlet."""
        return DeviceInfo(
            identifiers={(DOMAIN, self._address)},
            connections={(CONNECTION_BLUETOOTH, self._address)},
            name=self.coordinator.config_entry.title,
            manufacturer=MANUFACTURER,
            model=MODEL,
        )

    @property
    def available(self) -> bool:
        """Entity is available only when BLE link is up."""
        return self.coordinator.client.is_connected and super().available
