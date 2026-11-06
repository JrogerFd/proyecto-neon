"""Motor de físicas puro (sin sockets, sin gráficos, sin hilos).

Recibe el estado de un vehículo y una intención de control, y devuelve el
nuevo estado aplicando aceleración, frenado, arrastre, giro y límites de pista.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .config import PhysicsConfig
from .track import Track


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass
class VehicleInput:
    throttle: float = 0.0
    brake: float = 0.0
    steer: float = 0.0
    turbo: bool = False
    use_power: bool = False

    @classmethod
    def neutral(cls) -> "VehicleInput":
        return cls()

    def clamped(self) -> "VehicleInput":
        return VehicleInput(
            throttle=clamp(self.throttle, 0.0, 1.0),
            brake=clamp(self.brake, 0.0, 1.0),
            steer=clamp(self.steer, -1.0, 1.0),
            turbo=bool(self.turbo),
            use_power=bool(self.use_power),
        )

    def to_dict(self) -> dict[str, float | bool]:
        return {
            "throttle": round(self.throttle, 3),
            "brake": round(self.brake, 3),
            "steer": round(self.steer, 3),
            "turbo": self.turbo,
            "use_power": self.use_power,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "VehicleInput":
        return cls(
            throttle=float(data.get("throttle", 0.0)),
            brake=float(data.get("brake", 0.0)),
            steer=float(data.get("steer", 0.0)),
            turbo=bool(data.get("turbo", False)),
            use_power=bool(data.get("use_power", False)),
        ).clamped()


@dataclass
class VehicleState:
    player_id: int
    name: str
    color: str
    x: float
    y: float
    heading: float
    progress: float
    lap: int = 1
    laps: int = 3
    speed: float = 0.0
    steer: float = 0.0
    throttle: float = 0.0
    brake: float = 0.0
    off_track: bool = False
    connected: bool = True
    finished: bool = False
    finish_time: float | None = None
    lap_start: float = 0.0
    lap_times: list[float] = field(default_factory=list)
    best_lap: float | None = None
    turbo_charge: float = 35.0
    turbo_active: bool = False
    drifting: bool = False
    power_up: str | None = None
    shield_until: float = 0.0
    warp_until: float = 0.0
    missile_hit_until: float = 0.0
    sector_start: float = 0.0
    sector_times: list[float | None] = field(
        default_factory=lambda: [None, None, None]
    )
    jumps_completed: int = 0
    collisions: int = 0
    distance_travelled: float = 0.0

    def to_dict(self, race_time: float) -> dict[str, Any]:
        last_lap = self.lap_times[-1] if self.lap_times else None
        return {
            "id": self.player_id,
            "name": self.name,
            "color": self.color,
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "heading": round(self.heading, 4),
            "speed": round(self.speed, 2),
            "steer": round(self.steer, 3),
            "throttle": round(self.throttle, 3),
            "brake": round(self.brake, 3),
            "progress": round(self.progress, 5),
            "lap": self.lap,
            "laps": self.laps,
            "off_track": self.off_track,
            "turbo": round(self.turbo_charge / 100.0, 3),
            "turbo_active": self.turbo_active,
            "drifting": self.drifting,
            "power_up": self.power_up,
            "shield": race_time < self.shield_until,
            "warp_active": race_time < self.warp_until,
            "missile_hit": race_time < self.missile_hit_until,
            "connected": self.connected,
            "finished": self.finished,
            "finish_time": (
                round(self.finish_time, 3) if self.finish_time is not None else None
            ),
            "last_lap": round(last_lap, 3) if last_lap is not None else None,
            "best_lap": round(self.best_lap, 3) if self.best_lap is not None else None,
            "jumps_completed": self.jumps_completed,
            "collisions": self.collisions,
            "distance": round(self.distance_travelled, 2),
            "sector_times": [
                round(value, 3) if value is not None else None
                for value in self.sector_times
            ],
            "race_time": round(race_time, 3),
        }


class PhysicsEngine:
    """Integrador determinista de un vehículo."""

    MAX_SUBSTEP = 1.0 / 120.0

    def __init__(self, config: PhysicsConfig | None = None) -> None:
        self.config = config or PhysicsConfig()

    def step(
        self,
        state: VehicleState,
        control: VehicleInput,
        dt: float,
        track: Track,
        race_time: float,
    ) -> None:
        if dt < 0.0:
            raise ValueError("El paso de física no puede ser negativo")
        control = control.clamped()
        if dt == 0.0:
            self._step_once(state, control, dt, track, race_time)
            return
        substeps = max(1, math.ceil(dt / self.MAX_SUBSTEP))
        sub_dt = dt / substeps
        start_time = race_time - dt
        for index in range(substeps):
            self._step_once(
                state,
                control,
                sub_dt,
                track,
                start_time + sub_dt * (index + 1),
            )

    def _step_once(
        self,
        state: VehicleState,
        control: VehicleInput,
        dt: float,
        track: Track,
        race_time: float,
    ) -> None:
        cfg = self.config
        state.throttle = control.throttle
        state.brake = control.brake
        state.steer = control.steer
        state.turbo_active = False
        state.drifting = False

        if state.finished:
            state.speed = 0.0
            return

        if control.brake > 0.0:
            if state.speed > 0.0:
                state.speed -= control.brake * cfg.brake_decel * dt
            else:
                state.speed -= control.brake * cfg.engine_accel * 0.45 * dt
        else:
            state.speed += control.throttle * cfg.engine_accel * dt

        drag_force = cfg.drag * state.speed
        if abs(state.speed) > 1.0:
            drag_force += math.copysign(cfg.rolling_resistance, state.speed)
        state.speed -= drag_force * dt
        if (
            abs(state.speed) < 1.0
            and control.throttle == 0.0
            and control.brake == 0.0
        ):
            state.speed = 0.0
        boosting = (
            control.turbo
            and state.turbo_charge > 0.0
            and control.throttle > 0.0
        )
        state.drifting = (
            not boosting
            and control.throttle > 0.25
            and abs(control.steer) >= 0.55
            and abs(state.speed) >= cfg.min_turn_speed
        )
        if boosting:
            state.speed += cfg.engine_accel * 1.15 * dt
            state.turbo_charge = max(0.0, state.turbo_charge - 34.0 * dt)
            state.turbo_active = True
        else:
            if state.drifting:
                state.turbo_charge += 16.0 * dt
        state.turbo_charge = clamp(state.turbo_charge, 0.0, 100.0)
        speed_limit = (
            cfg.max_speed * 1.35
            if boosting or race_time < state.warp_until
            else cfg.max_speed
        )
        state.speed = clamp(state.speed, cfg.reverse_speed, speed_limit)

        speed_ratio = clamp(abs(state.speed) / cfg.min_turn_speed, 0.0, 1.0)
        if state.speed < 0.0:
            speed_ratio = -speed_ratio
        state.heading += control.steer * cfg.turn_rate * speed_ratio * dt

        distance = state.speed * dt
        state.x += math.cos(state.heading) * distance
        state.y += math.sin(state.heading) * distance
        state.distance_travelled += abs(distance)

        previous_progress = state.progress
        progress, offset = track.progress_and_offset(
            state.x, state.y, reference_progress=previous_progress
        )
        state.progress = progress
        driveable_half_width = max(
            0.0, track.width * 0.5 - cfg.vehicle_half_width
        )
        state.off_track = offset > driveable_half_width * 0.82

        if previous_progress < 1.0 / 3.0 <= progress:
            self._complete_sector(state, race_time, 0)
        if previous_progress < 2.0 / 3.0 <= progress:
            self._complete_sector(state, race_time, 1)

        if state.off_track:
            state.speed *= max(0.0, 1.0 - cfg.off_track_drag * dt)

        wall_limit = driveable_half_width
        if offset > wall_limit:
            center_x, center_y = track.point_at(progress)
            tangent = track.heading_at(progress)
            normal_x, normal_y = -math.sin(tangent), math.cos(tangent)
            side = (
                1.0
                if (state.x - center_x) * normal_x + (state.y - center_y) * normal_y >= 0.0
                else -1.0
            )
            velocity_x = math.cos(state.heading)
            velocity_y = math.sin(state.heading)
            outward_speed = (velocity_x * normal_x + velocity_y * normal_y) * side
            state.x, state.y, state.progress = track.clamp_position(
                state.x, state.y, wall_limit, reference_progress=progress
            )
            if outward_speed > 0.0 and race_time >= state.shield_until:
                velocity_x -= 2.0 * outward_speed * side * normal_x
                velocity_y -= 2.0 * outward_speed * side * normal_y
                state.heading = math.atan2(velocity_y, velocity_x)
                state.speed *= cfg.wall_restitution

        if previous_progress > 0.80 and state.progress < 0.20:
            self._complete_sector(state, race_time, 2)
            self._complete_lap(state, race_time)

    @staticmethod
    def _complete_sector(state: VehicleState, race_time: float, index: int) -> None:
        state.sector_times[index] = max(0.0, race_time - state.sector_start)
        state.sector_start = race_time

    @staticmethod
    def _complete_lap(state: VehicleState, race_time: float) -> None:
        lap_time = max(0.0, race_time - state.lap_start)
        state.lap_times.append(lap_time)
        state.best_lap = (
            lap_time if state.best_lap is None else min(state.best_lap, lap_time)
        )
        state.lap_start = race_time
        state.sector_start = race_time
        state.lap += 1
        if state.lap > state.laps:
            state.lap = state.laps
            state.finished = True
            state.finish_time = race_time
            state.speed = 0.0
