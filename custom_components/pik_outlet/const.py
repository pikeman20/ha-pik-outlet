"""Constants for PIK BLE 6-Switch Outlet integration."""
from __future__ import annotations

DOMAIN = "pik_outlet"

# ── BLE GATT UUIDs (JDY/BT04-A FFF0 service) ────────────────────────────────
SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb"
WRITE_CHAR_UUID = "0000fff2-0000-1000-8000-00805f9b34fb"
NOTIFY_CHAR_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"

# ── Device ────────────────────────────────────────────────────────────────────
SOCKET_COUNT = 6
MANUFACTURER = "PIK Electronics"
MODEL = "6-Switch BLE Outlet 2500W"

# ── Socket Modes ──────────────────────────────────────────────────────────────
MODE_OFF = "OFF"
MODE_MANUAL = "MAN"
MODE_CLOUD = "CLD"

MODE_LABELS: dict[str, str] = {
    MODE_OFF: "Off",
    MODE_MANUAL: "Manual",
    MODE_CLOUD: "Cloud",
}
MODE_FROM_LABEL: dict[str, str] = {v: k for k, v in MODE_LABELS.items()}

# ── Config keys ──────────────────────────────────────────────────────────────
CONF_ADDRESS = "address"

# ── Timing ────────────────────────────────────────────────────────────────────
POLL_INTERVAL_SECONDS = 60       # heartbeat when connected
RECONNECT_RETRY_SECONDS = 15     # fast-retry interval when disconnected
CONNECT_TIMEOUT = 30.0
COMMAND_TIMEOUT = 5.0
AT_COMMAND_TIMEOUT = 8.0
RECONNECT_BACKOFF_MAX = 300  # seconds

# ── Services ──────────────────────────────────────────────────────────────────
SERVICE_SET_TIMER_ENABLE = "set_timer_enable"
SERVICE_SET_TIMER_PROFILE = "set_timer_profile"
SERVICE_SEND_RAW_COMMAND = "send_raw_command"
SERVICE_SYNC_TIME = "sync_time"
