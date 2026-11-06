"""Estado compartido de la carrera con sincronización explícita.

Regla de concurrencia:
  * Varios hilos de red (Master) o el hilo de entrada (modo local) escriben
    intenciones mediante ``set_input``.
  * Un único hilo de simulación ejecuta ``step``.
  * ``snapshot`` y ``results`` construyen copias inmutables bajo el mismo
    ``RLock`` para que el renderizado nunca lea estructuras a medio actualizar.
"""

from __future__ import annotations

import threading
import math
import random
from dataclasses import dataclass
from typing import Any, Protocol

from .config import PhysicsConfig, RaceConfig, PLAYER_COLORS
from .physics import PhysicsEngine, VehicleInput, VehicleState
from .track import Track


@dataclass(frozen=True)
class PlayerSpec:
    player_id: int
    name: str
    color: str
    physics: PhysicsConfig | None = None


@dataclass
class PowerupPickup:
    pickup_id: int
    progress: float
    offset: float
    power: str
    available_at: float = 0.0


class ComputePool(Protocol):
    def autopilot_controls(
        self, vehicles: list[dict[str, Any]], track: Track
    ) -> dict[int, VehicleInput]: ...

    def step_vehicles(
        self,
        vehicles: dict[int, VehicleState],
        engines: dict[int, PhysicsEngine],
        controls: dict[int, VehicleInput],
        dt: float,
        track: Track,
        race_time: float,
    ) -> None: ...


def make_player_specs(names: list[str]) -> list[PlayerSpec]:
    return [
        PlayerSpec(
            player_id=index + 1,
            name=name,
            color=PLAYER_COLORS[index % len(PLAYER_COLORS)],
        )
        for index, name in enumerate(names)
    ]


class RaceWorld:
    def __init__(
        self,
        track: Track,
        players: list[PlayerSpec],
        race_config: RaceConfig | None = None,
        physics_config: PhysicsConfig | None = None,
        compute_pool: ComputePool | None = None,
    ) -> None:
        self.track = track
        self.race_config = race_config or RaceConfig()
        self._default_physics = physics_config or PhysicsConfig()
        self._compute_pool = compute_pool
        self._physics: dict[int, PhysicsEngine] = {}
        self._lock = threading.RLock()
        self._vehicles: dict[int, VehicleState] = {}
        self._inputs: dict[int, VehicleInput] = {}
        self._tick = 0
        self._race_time = 0.0
        self._status = "waiting"
        self._powerup_rng = random.Random((track.seed ^ 0x4E454F4E) & 0xFFFFFFFF)
        self._powerups = self._make_powerups()

        for index, player in enumerate(players):
            self._physics[player.player_id] = PhysicsEngine(
                player.physics or self._default_physics
            )
            x, y, heading, progress = track.start_pose(index)
            self._vehicles[player.player_id] = VehicleState(
                player_id=player.player_id,
                name=player.name,
                color=player.color,
                x=x,
                y=y,
                heading=heading,
                progress=progress,
                laps=self.race_config.laps,
            )
            self._inputs[player.player_id] = VehicleInput.neutral()

    @property
    def tick(self) -> int:
        with self._lock:
            return self._tick

    @property
    def race_time(self) -> float:
        with self._lock:
            return self._race_time

    @property
    def status(self) -> str:
        with self._lock:
            return self._status

    def set_input(self, player_id: int, control: VehicleInput) -> bool:
        with self._lock:
            vehicle = self._vehicles.get(player_id)
            if vehicle is None or vehicle.finished or not vehicle.connected:
                return False
            self._inputs[player_id] = control.clamped()
            return True

    def mark_disconnected(self, player_id: int) -> None:
        with self._lock:
            vehicle = self._vehicles.get(player_id)
            if vehicle is None:
                return
            vehicle.connected = False
            self._inputs[player_id] = VehicleInput.neutral()

    def step(self, dt: float) -> None:
        with self._lock:
            self._race_time += dt
            self._tick += 1
            self._status = "racing"
            if self._compute_pool is not None:
                self._compute_pool.step_vehicles(
                    self._vehicles,
                    self._physics,
                    self._inputs,
                    dt,
                    self.track,
                    self._race_time,
                )
            else:
                for player_id, vehicle in self._vehicles.items():
                    control = self._inputs.get(player_id, VehicleInput.neutral())
                    if not vehicle.connected:
                        control = VehicleInput.neutral()
                    engine = self._physics.get(vehicle.player_id)
                    if engine is not None:
                        engine.step(
                            vehicle, control, dt, self.track, self._race_time
                        )
            if self._all_finished_locked():
                self._status = "finished"
            self._update_arcade_items()

    def all_finished(self) -> bool:
        with self._lock:
            return self._all_finished_locked()

    def _all_finished_locked(self) -> bool:
        return all(
            vehicle.finished or not vehicle.connected
            for vehicle in self._vehicles.values()
        )

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "tick": self._tick,
                "race_time": round(self._race_time, 3),
                "status": self._status,
                "laps": self.race_config.laps,
                "tick_rate": self.race_config.tick_rate,
                "snapshot_rate": self.race_config.snapshot_rate,
                "max_speed": max(
                    (
                        engine.config.max_speed
                        for engine in self._physics.values()
                    ),
                    default=self._default_physics.max_speed,
                ),
                "vehicles": [
                    vehicle.to_dict(self._race_time)
                    for vehicle in self._vehicles.values()
                ],
                "powerups": [
                    {
                        "id": pickup.pickup_id,
                        "progress": round(pickup.progress, 5),
                        "offset": round(pickup.offset, 1),
                        "power": pickup.power,
                    }
                    for pickup in self._powerups
                    if pickup.available_at <= self._race_time
                ],
            }

    def _make_powerups(self) -> list[PowerupPickup]:
        pickups: list[PowerupPickup] = []
        width = max(0.0, self.track.width * 0.18)
        for pickup_id in range(10):
            progress = (
                0.035
                + pickup_id * 0.1
                + self._powerup_rng.uniform(-0.018, 0.018)
            ) % 1.0
            pickups.append(
                PowerupPickup(
                    pickup_id=pickup_id,
                    progress=progress,
                    offset=self._powerup_rng.uniform(-width, width),
                    power=self._powerup_rng.choice(("shield", "missile", "warp")),
                )
            )
        return pickups

    def _update_arcade_items(self) -> None:
        for vehicle_id, vehicle in self._vehicles.items():
            if not vehicle.connected or vehicle.finished:
                continue
            control = self._inputs.get(vehicle_id, VehicleInput.neutral())
            if control.use_power:
                self._inputs[vehicle_id] = VehicleInput(
                    throttle=control.throttle,
                    brake=control.brake,
                    steer=control.steer,
                    turbo=control.turbo,
                )
                if vehicle.power_up is not None:
                    self._activate_power(vehicle)
            if vehicle.power_up is not None:
                continue
            for pickup in self._powerups:
                if pickup.available_at > self._race_time:
                    continue
                px, py = self.track.point_at(pickup.progress)
                heading = self.track.heading_at(pickup.progress)
                px -= math.sin(heading) * pickup.offset
                py += math.cos(heading) * pickup.offset
                if math.hypot(vehicle.x - px, vehicle.y - py) > 34.0:
                    continue
                vehicle.power_up = pickup.power
                pickup.available_at = self._race_time + 9.0
                pickup.power = self._powerup_rng.choice(
                    ("shield", "missile", "warp")
                )
                break

    def _activate_power(self, vehicle: VehicleState) -> None:
        power = vehicle.power_up
        vehicle.power_up = None
        if power == "shield":
            vehicle.shield_until = self._race_time + 5.0
        elif power == "warp":
            vehicle.warp_until = self._race_time + 1.5
            engine = self._physics.get(vehicle.player_id)
            if engine is not None:
                vehicle.speed = min(
                    engine.config.max_speed * 1.35,
                    vehicle.speed + 190.0,
                )
                vehicle.turbo_charge = max(vehicle.turbo_charge, 45.0)
        elif power == "missile":
            target = self._missile_target(vehicle)
            if target is None:
                vehicle.warp_until = self._race_time + 1.0
                engine = self._physics.get(vehicle.player_id)
                if engine is not None:
                    vehicle.speed = min(
                        engine.config.max_speed * 1.25,
                        vehicle.speed + 120.0,
                    )
                return
            if target.shield_until <= self._race_time:
                target.speed *= 0.55
                target.missile_hit_until = self._race_time + 1.2

    def _missile_target(self, vehicle: VehicleState) -> VehicleState | None:
        targets = []
        for candidate in self._vehicles.values():
            if (
                candidate.player_id == vehicle.player_id
                or not candidate.connected
                or candidate.finished
            ):
                continue
            distance = (candidate.progress - vehicle.progress) % 1.0
            if 0.0 < distance <= 0.18:
                targets.append((distance, candidate))
        return min(targets, key=lambda item: item[0])[1] if targets else None

    def results(self) -> list[dict[str, Any]]:
        with self._lock:
            ordered = sorted(
                self._vehicles.values(),
                key=lambda vehicle: (
                    0 if vehicle.finished else 1,
                    vehicle.finish_time
                    if vehicle.finish_time is not None
                    else float("inf"),
                    -vehicle.progress,
                ),
            )
            return [
                {
                    "placement": index + 1,
                    "id": vehicle.player_id,
                    "name": vehicle.name,
                    "color": vehicle.color,
                    "finished": vehicle.finished,
                    "connected": vehicle.connected,
                    "finish_time": (
                        round(vehicle.finish_time, 3)
                        if vehicle.finish_time is not None
                        else None
                    ),
                    "best_lap": (
                        round(vehicle.best_lap, 3)
                        if vehicle.best_lap is not None
                        else None
                    ),
                    "laps_completed": max(0, min(vehicle.lap, vehicle.laps)),
                    "collisions": vehicle.collisions,
                    "jumps_completed": vehicle.jumps_completed,
                    "distance": round(vehicle.distance_travelled, 2),
                    "race_time": round(self._race_time, 3),
                }
                for index, vehicle in enumerate(ordered)
            ]

    def force_finish(self) -> None:
        """Cierra la carrera por timeout, conservando el orden actual."""
        with self._lock:
            for vehicle in self._vehicles.values():
                if not vehicle.finished:
                    vehicle.finished = True
                    vehicle.finish_time = self._race_time
                    vehicle.speed = 0.0
            self._status = "finished"
