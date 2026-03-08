"""Sensor platform for PIK BLE 6-Switch Outlet.

Exposes energy monitoring sensors:
* **Voltage** — RMS mains voltage (V)
* **Current** — RMS load current (A, converted from mA)
* **Power** — Active power (W)
* **Frequency** — Mains frequency (Hz)
* **RTC Clock** — Device RTC time (diagnostic text sensor)
* **Timer Enable** — Timer enable flags for all sockets (diagnostic)
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    EntityCategory,
    UnitOfElectricCurrent,
    UnitOfElectricPotential,
    UnitOfFrequency,
    UnitOfPower,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import PikOutletCoordinator
from .entity import PikOutletEntity
from .pik_ble import DeviceState

_LOGGER = logging.getLogger(__name__)


# ── Sensor value extractors ──────────────────────────────────────────────────
# Each description carries a ``value_fn`` that pulls the right field from state.

@dataclass(frozen=True, kw_only=True)
class PikSensorDescription(SensorEntityDescription):
    """Extended description with a value extractor."""
    value_fn: Any = None  # Callable[[DeviceState], float | str | None]


def _voltage(state: DeviceState) -> float | None:
    return state.energy.voltage if state.energy.valid else None


def _current(state: DeviceState) -> float | None:
    if not state.energy.valid:
        return None
    return round(state.energy.current_ma / 1000.0, 3)


def _power(state: DeviceState) -> float | None:
    return state.energy.power if state.energy.valid else None


def _frequency(state: DeviceState) -> float | None:
    return state.energy.frequency if state.energy.valid else None


def _rtc(state: DeviceState) -> str | None:
    return state.rtc_text or None


def _timer_flags(state: DeviceState) -> str | None:
    return state.timer_enable or None


SENSOR_DESCRIPTIONS: tuple[PikSensorDescription, ...] = (
    PikSensorDescription(
        key="voltage",
        name="Voltage",
        icon="mdi:flash",
        device_class=SensorDeviceClass.VOLTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfElectricPotential.VOLT,
        suggested_display_precision=0,
        value_fn=_voltage,
    ),
    PikSensorDescription(
        key="current",
        name="Current",
        icon="mdi:current-ac",
        device_class=SensorDeviceClass.CURRENT,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfElectricCurrent.AMPERE,
        suggested_display_precision=3,
        value_fn=_current,
    ),
    PikSensorDescription(
        key="power",
        name="Power",
        icon="mdi:flash-outline",
        device_class=SensorDeviceClass.POWER,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfPower.WATT,
        suggested_display_precision=0,
        value_fn=_power,
    ),
    PikSensorDescription(
        key="frequency",
        name="Frequency",
        icon="mdi:sine-wave",
        device_class=SensorDeviceClass.FREQUENCY,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfFrequency.HERTZ,
        suggested_display_precision=0,
        value_fn=_frequency,
    ),
    PikSensorDescription(
        key="rtc_clock",
        name="Device Clock",
        icon="mdi:clock-outline",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=_rtc,
    ),
    PikSensorDescription(
        key="timer_enable",
        name="Timer Enable Flags",
        icon="mdi:timer-cog-outline",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=_timer_flags,
    ),
)


# ── Platform setup ───────────────────────────────────────────────────────────

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up PIK Outlet sensor entities."""
    coordinator: PikOutletCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        PikSensorEntity(coordinator, desc) for desc in SENSOR_DESCRIPTIONS
    )


# ── Entity implementation ────────────────────────────────────────────────────

class PikSensorEntity(PikOutletEntity, SensorEntity):
    """Sensor entity backed by a ``PikSensorDescription``."""

    entity_description: PikSensorDescription

    def __init__(
        self,
        coordinator: PikOutletCoordinator,
        description: PikSensorDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{self._mac_id}_{description.key}"

    @property
    def native_value(self) -> float | str | None:
        """Return the current sensor value."""
        state = self.coordinator.data
        if state is None:
            return None
        return self.entity_description.value_fn(state)

    @callback
    def _handle_coordinator_update(self) -> None:
        self.async_write_ha_state()
