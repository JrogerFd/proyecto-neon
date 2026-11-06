"""Parámetros globales de NEON RUSH.

Los valores de red, simulación y físicas viven aquí para que Master,
Workers y el modo local compartan exactamente la misma configuración.
"""

from dataclasses import dataclass

PROTOCOL_VERSION = 2
DEFAULT_HOST = "0.0.0.0"
DEFAULT_CLIENT_HOST = "127.0.0.1"
DEFAULT_PORT = 50505
DEFAULT_ROOM = "NEON"

MAX_MESSAGE_BYTES = 1 << 20
SOCKET_TIMEOUT = 0.5
CONNECT_TIMEOUT = 15.0

SNAPSHOT_QUEUE_SIZE = 64
SERVER_BACKLOG = 32

RENDER_FPS = 60
START_COUNTDOWN_SECONDS = 3.0
SNAPSHOT_HISTORY = 12
INTERPOLATION_DELAY = 0.065
MAX_EXTRAPOLATION = 0.085

PLAYER_COLORS = (
    "#00e5ff",
    "#ff2e88",
    "#b6ff00",
    "#ffb300",
    "#9d6bff",
    "#00ffa3",
    "#ff5c33",
    "#e0e0e0",
)


@dataclass(frozen=True)
class PhysicsConfig:
    """Modelo de físicas independiente del motor de renderizado."""

    max_speed: float = 520.0
    reverse_speed: float = -90.0
    engine_accel: float = 320.0
    brake_decel: float = 620.0
    drag: float = 0.30
    rolling_resistance: float = 18.0
    off_track_drag: float = 2.1
    turn_rate: float = 2.5
    min_turn_speed: float = 55.0
    wall_restitution: float = 0.45
    vehicle_half_width: float = 30.0

    def to_dict(self) -> dict[str, float]:
        return {
            "max_speed": self.max_speed,
            "reverse_speed": self.reverse_speed,
            "engine_accel": self.engine_accel,
            "brake_decel": self.brake_decel,
            "drag": self.drag,
            "rolling_resistance": self.rolling_resistance,
            "off_track_drag": self.off_track_drag,
            "turn_rate": self.turn_rate,
            "min_turn_speed": self.min_turn_speed,
            "wall_restitution": self.wall_restitution,
            "vehicle_half_width": self.vehicle_half_width,
        }

    @classmethod
    def from_dict(cls, data: dict[str, float] | None) -> "PhysicsConfig":
        data = data or {}
        defaults = cls()
        return cls(
            max_speed=float(data.get("max_speed", defaults.max_speed)),
            reverse_speed=float(data.get("reverse_speed", defaults.reverse_speed)),
            engine_accel=float(data.get("engine_accel", defaults.engine_accel)),
            brake_decel=float(data.get("brake_decel", defaults.brake_decel)),
            drag=float(data.get("drag", defaults.drag)),
            rolling_resistance=float(
                data.get("rolling_resistance", defaults.rolling_resistance)
            ),
            off_track_drag=float(
                data.get("off_track_drag", defaults.off_track_drag)
            ),
            turn_rate=float(data.get("turn_rate", defaults.turn_rate)),
            min_turn_speed=float(
                data.get("min_turn_speed", defaults.min_turn_speed)
            ),
            wall_restitution=float(
                data.get("wall_restitution", defaults.wall_restitution)
            ),
            vehicle_half_width=float(
                data.get("vehicle_half_width", defaults.vehicle_half_width)
            ),
        )


@dataclass(frozen=True)
class RaceConfig:
    tick_rate: int = 60
    snapshot_rate: int = 60
    laps: int = 3
    max_race_seconds: float = 180.0

    @property
    def fixed_dt(self) -> float:
        return 1.0 / float(self.tick_rate)

    @property
    def snapshot_interval(self) -> float:
        return 1.0 / float(self.snapshot_rate)
