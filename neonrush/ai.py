"""Piloto automático simple para demos y pruebas headless."""

from __future__ import annotations

import math

from .config import PhysicsConfig
from .physics import VehicleInput, clamp
from .track import Track


def angle_difference(target: float, current: float) -> float:
    return (target - current + math.pi) % math.tau - math.pi


def autopilot_control(
    vehicle: dict,
    track: Track,
    physics: PhysicsConfig | None = None,
    lookahead: float = 0.032,
) -> VehicleInput:
    cfg = physics or PhysicsConfig()
    progress = float(vehicle.get("progress", 0.0))
    target_progress = (progress + lookahead) % 1.0
    target_x, target_y = track.point_at(target_progress)
    desired_heading = math.atan2(
        target_y - float(vehicle.get("y", 0.0)),
        target_x - float(vehicle.get("x", 0.0)),
    )
    error = angle_difference(desired_heading, float(vehicle.get("heading", 0.0)))
    steer = clamp(error * 2.0, -1.0, 1.0)

    speed = float(vehicle.get("speed", 0.0))
    speed_ratio = clamp(speed / cfg.max_speed, 0.0, 1.0)
    throttle = 1.0
    brake = 0.0
    if abs(error) > 0.35:
        throttle = 0.55
    if abs(error) > 0.85:
        throttle = 0.30
    if speed_ratio > 0.90 and abs(error) > 0.18:
        throttle = 0.0
        brake = 0.35
    if speed_ratio > 0.97:
        throttle = 0.0
        brake = max(brake, 0.25)
    heading = track.heading_at(progress)
    curve_change = max(
        abs(angle_difference(track.heading_at(progress + distance), heading))
        for distance in (lookahead * 0.5, lookahead, lookahead * 1.5)
    )
    corner_speed = cfg.max_speed * clamp(1.0 - curve_change / 1.2, 0.28, 1.0)
    if speed > corner_speed:
        throttle = 0.0
        brake = max(
            brake,
            clamp((speed - corner_speed) / max(cfg.max_speed * 0.35, 1.0), 0.25, 1.0),
        )
    if vehicle.get("off_track"):
        throttle = 0.75
        brake = 0.0

    return VehicleInput(throttle=throttle, brake=brake, steer=steer)
