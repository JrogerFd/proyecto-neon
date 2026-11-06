"""Interpolación de snapshots para renderizado suave a 60 FPS.

El Master difunde el estado a 30 Hz. Si el renderer dibujara el último
snapshot recibido, el movimiento se vería a saltos (teletransporte). Este
buffer guarda una pequeña historia y entrega un snapshot interpolado para el
instante de render, con una pequeña latencia de seguridad. Si se agota la
historia, extrapola como máximo unos milisegundos.
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from typing import Any

from .config import (
    INTERPOLATION_DELAY,
    MAX_EXTRAPOLATION,
    SNAPSHOT_HISTORY,
)


def _lerp(a: float, b: float, alpha: float) -> float:
    return a + (b - a) * alpha


def _lerp_angle(a: float, b: float, alpha: float) -> float:
    delta = (b - a + math.pi) % math.tau - math.pi
    return a + delta * alpha


def _lerp_progress(a: float, b: float, alpha: float) -> float:
    delta = (b - a + 0.5) % 1.0 - 0.5
    return (a + delta * alpha) % 1.0


def _blend_snapshots(
    previous: dict[str, Any], current: dict[str, Any], alpha: float
) -> dict[str, Any]:
    result = dict(current)

    previous_time = float(previous.get("race_time", 0.0))
    current_time = float(current.get("race_time", previous_time))
    result["race_time"] = _lerp(previous_time, current_time, alpha)

    previous_vehicles = {
        int(vehicle.get("id", -1)): vehicle
        for vehicle in previous.get("vehicles", [])
    }
    blended: list[dict[str, Any]] = []
    for current_vehicle in current.get("vehicles", []):
        vehicle = dict(current_vehicle)
        old = previous_vehicles.get(int(vehicle.get("id", -1)))
        if old is not None:
            vehicle["x"] = _lerp(float(old.get("x", 0.0)), float(vehicle["x"]), alpha)
            vehicle["y"] = _lerp(float(old.get("y", 0.0)), float(vehicle["y"]), alpha)
            vehicle["heading"] = _lerp_angle(
                float(old.get("heading", 0.0)),
                float(vehicle["heading"]),
                alpha,
            )
            vehicle["speed"] = max(
                0.0,
                _lerp(float(old.get("speed", 0.0)), float(vehicle["speed"]), alpha),
            )
            vehicle["steer"] = _lerp(
                float(old.get("steer", 0.0)), float(vehicle["steer"]), alpha
            )
            vehicle["throttle"] = _lerp(
                float(old.get("throttle", 0.0)),
                float(vehicle["throttle"]),
                alpha,
            )
            vehicle["brake"] = _lerp(
                float(old.get("brake", 0.0)), float(vehicle["brake"]), alpha
            )
            vehicle["progress"] = _lerp_progress(
                float(old.get("progress", 0.0)),
                float(vehicle["progress"]),
                alpha,
            )
        blended.append(vehicle)
    result["vehicles"] = blended
    return result


class SnapshotBuffer:
    def __init__(
        self,
        history: int = SNAPSHOT_HISTORY,
        delay: float = INTERPOLATION_DELAY,
        max_extrapolation: float = MAX_EXTRAPOLATION,
    ) -> None:
        self.delay = max(0.0, delay)
        self.max_extrapolation = max(0.0, max_extrapolation)
        self._samples: deque[tuple[float, dict[str, Any]]] = deque(
            maxlen=max(2, history)
        )
        self._lock = threading.RLock()

    def push(
        self, snapshot: dict[str, Any], received_at: float | None = None
    ) -> None:
        timestamp = time.monotonic() if received_at is None else received_at
        with self._lock:
            self._samples.append((timestamp, snapshot))

    def clear(self) -> None:
        with self._lock:
            self._samples.clear()

    def latest(self) -> dict[str, Any] | None:
        with self._lock:
            if not self._samples:
                return None
            return self._samples[-1][1]

    def sample(
        self, now: float | None = None, delay: float | None = None
    ) -> dict[str, Any] | None:
        with self._lock:
            samples = list(self._samples)
        if not samples:
            return None
        if len(samples) == 1:
            return samples[0][1]

        target = (time.monotonic() if now is None else now) - (
            self.delay if delay is None else delay
        )
        if target <= samples[0][0]:
            return samples[0][1]

        for index in range(1, len(samples)):
            t1, snap1 = samples[index]
            if target <= t1:
                t0, snap0 = samples[index - 1]
                span = t1 - t0
                alpha = 1.0 if span <= 0.0 else (target - t0) / span
                return _blend_snapshots(snap0, snap1, alpha)

        t_prev, snap_prev = samples[-2]
        t_last, snap_last = samples[-1]
        span = t_last - t_prev
        if span <= 0.0:
            return snap_last
        ratio = min(
            max(0.0, (target - t_last) / span),
            self.max_extrapolation / span,
        )
        return _blend_snapshots(snap_prev, snap_last, 1.0 + ratio)

    def __len__(self) -> int:
        with self._lock:
            return len(self._samples)
