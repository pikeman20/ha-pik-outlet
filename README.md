# PIK BLE 6-Switch Outlet — Home Assistant Integration

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)

Home Assistant custom integration for the **PIK 6-Switch BLE Outlet** (2500W).

## Features

| Feature | Entity Type | Details |
|---------|-------------|---------|
| 6 × Socket ON/OFF | `switch` | Turn each socket on (Manual mode) or off |
| 6 × Timer Enable | `switch` | Enable/disable timer per socket |
| 6 × Socket Mode | `select` | Off / Manual / Cloud per socket |
| 1 × Master Mode | `select` | Set all sockets at once |
| 6 × Schedule Days | `select` | Day pattern preset for profile 1 |
| 12 × Schedule Time | `time` | ON/OFF time pickers for profile 1 |
| 1 × Global Lock | `binary_sensor` | Master child lock state |
| 6 × Socket Lock | `binary_sensor` | Per-socket child lock state |
| Voltage | `sensor` | RMS mains voltage (V) |
| Current | `sensor` | RMS load current (A) |
| Power | `sensor` | Active power (W) |
| Frequency | `sensor` | Mains frequency (Hz) |
| Device Clock | `sensor` | RTC time (diagnostic) |
| Timer Flags | `sensor` | Per-socket timer enable state (diagnostic) |
| Sync Time | `button` | Sync device RTC to HA time |
| Refresh Status | `button` | Force full status refresh |
| **Schedule Card** | `custom card` | Circular 24h clock UI for all 6 profiles |

### Services

| Service | Description |
|---------|-------------|
| `pik_outlet.set_timer_enable` | Enable/disable timer per socket (6-char `010101` string) |
| `pik_outlet.set_timer_profile` | Configure a timer schedule (socket, profile, days, on/off times) |
| `pik_outlet.sync_time` | Sync device RTC to HA local time |
| `pik_outlet.send_raw_command` | Send raw PIK-CMD (advanced/debug) |

## Installation

### HACS (Recommended)

1. Open HACS → Integrations → ⋮ → Custom repositories
2. Add this repository URL, category: **Integration**
3. Install **PIK BLE 6-Switch Outlet**
4. Restart Home Assistant

### Manual

1. Copy `custom_components/pik_outlet/` to your HA `config/custom_components/`
2. Restart Home Assistant

## Setup

1. **Auto-discovery**: If the device advertises the FFF0 BLE service UUID, HA will discover it automatically. Confirm in the notification.
2. **Manual**: Go to Settings → Devices & Services → Add Integration → "PIK BLE 6-Switch Outlet" → enter the BLE MAC address.

## Socket Modes

| Mode | Behavior |
|------|----------|
| **Off** | Relay always off |
| **Manual** | Relay always on (user-controlled) |
| **Cloud** | Relay controlled by timer schedules |

The **switch entity** maps ON → Manual, OFF → Off.
Use the **select entity** to set Cloud mode for timer-driven operation.

## Schedule Card (Custom Lovelace Card)

The integration ships with **PIK Schedule Card** — a visual circular-clock card
for configuring timer schedules directly from the HA dashboard.

### Adding the Card

The card is auto-registered when the integration loads. In your dashboard:

1. Click **Edit Dashboard** → **Add Card** → search for **PIK Schedule Card**
2. Pick any timer-enable switch entity (e.g. `switch.pik_outlet_socket_1_timer_enable`)
3. Save

Or in YAML:

```yaml
type: custom:pik-schedule-card
entity: switch.pik_outlet_socket_1_timer_enable
```

### Card Features

- **Socket tabs** (1–6): switch between sockets
- **Profile tabs** (1–6): 6 independent schedules per socket with enabled-dot indicators
- **Circular 24h clock**: drag green (ON) and red (OFF) handles to set times
- **Time input boxes**: type exact hours/minutes (arrow keys ↑↓ supported)
- **Day-of-week selector**: Mon–Sun toggle buttons
- **Enable toggle**: enable/disable the selected profile
- **Apply button**: sends `TIMER_SET` to device; auto-enables the socket timer
- **Warning banner**: shown when the socket timer is globally disabled

## Timer Configuration

Each socket supports **6 independent timer profiles**. Each profile specifies:
- **Days**: Weekday bitmask (bit0=Sun, bit1=Mon, ..., bit6=Sat)
- **ON time**: Hour + minute to turn relay on
- **OFF time**: Hour + minute to turn relay off
- **Enabled**: Active/inactive flag

Common bitmask values: 62 = Mon–Fri, 126 = Mon–Sat, 127 = Every day, 65 = Weekends.

Example automation to set a Mon–Fri schedule:

```yaml
service: pik_outlet.set_timer_profile
data:
  device_id: "<your_device_id>"
  socket: 1
  profile: 1
  days: 62    # Mon-Fri = 0b0111110
  hour_on: 6
  minute_on: 30
  hour_off: 22
  minute_off: 0
  enabled: true
```

Enable the timer for socket 1:

```yaml
service: pik_outlet.set_timer_enable
data:
  device_id: "<your_device_id>"
  flags: "100000"  # Only socket 1 timer enabled
```

## BLE Protocol

The integration communicates over **BLE GATT UART** using the JDY/BT04-A FFF0 service:

| UUID | Use |
|------|-----|
| `0000fff0-...` | Service |
| `0000fff1-...` | Notify (device → app) |
| `0000fff2-...` | Write-no-response (app → device) |

**Protocol**: ASCII line-oriented (`PIK-CMD:…\r\n` / `PIK-NOTIF:…\r\n`).

## Troubleshooting

- **Device not found**: Ensure the outlet is powered on and within BLE range (~10m). Check HA bluetooth integration for adapter status.
- **Frequent disconnections**: BLE range is limited. Consider an ESPHome BLE proxy closer to the device.
- **Commands rejected**: The device has a child lock feature (activated by double-pressing the physical button). Unlock on the device first.
- **Stale data**: Press the "Refresh Status" button or wait for the 60s poll cycle.

## Requirements

- Home Assistant 2024.1+
- Bluetooth adapter or ESPHome BLE proxy
- Python 3.11+
