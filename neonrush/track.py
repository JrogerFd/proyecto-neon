"""Static, flat circuit geometry and progress helpers."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

CHAMPIONSHIP_TRACKS: dict[str, str] = {
    "jungle": "SELVA TROPICAL",
    "canyon": "CAÑÓN ROJO",
    "cyberpunk": "CIUDAD CYBERPUNK 2049",
    "neon_city": "NEON CITY",
    "cyber_desert": "CYBER DESERT",
    "plasma_circuit": "PLASMA CIRCUIT",
}

# One closed, hand-authored racing line: main straight, two hairpins and a
# central chicane. Style changes presentation only; geometry never changes.
_WAYPOINTS: tuple[tuple[float, float], ...] = (
    (-520.0, 220.0),
    (-340.0, 220.0),
    (-180.0, 220.0),
    (-120.0, 120.0),
    (-60.0, 210.0),
    (80.0, 220.0),
    (300.0, 220.0),
    (440.0, 190.0),
    (500.0, 100.0),
    (500.0, -20.0),
    (440.0, -90.0),
    (340.0, -90.0),
    (280.0, -20.0),
    (210.0, -20.0),
    (150.0, -100.0),
    (80.0, -180.0),
    (-60.0, -210.0),
    (-200.0, -180.0),
    (-270.0, -100.0),
    (-240.0, -20.0),
    (-300.0, 70.0),
    (-430.0, 70.0),
    (-520.0, 40.0),
    (-550.0, 120.0),
)
_SAMPLE_COUNT = 384


def _catmull_rom(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        2.0 * p1
        + (-p0 + p2) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    )


@dataclass(frozen=True)
class Track:
    center_x: float = 0.0
    center_y: float = 0.0
    width: float = 168.0
    style: str = "neon"
    name: str = "NEON RUSH CIRCUIT"
    seed: int = 0

    @classmethod
    def oval(cls) -> "Track":
        return cls()

    @classmethod
    def procedural(cls, style: str = "neon", seed: int | None = None) -> "Track":
        """Compatibility factory; the fixed racing line is not procedural."""
        names = {
            "neon": "NEON RUSH CIRCUIT",
            "synth": "SYNTH CIRCUIT",
            "code": "CODE CIRCUIT",
            "void": "VOID CIRCUIT",
        }
        name = CHAMPIONSHIP_TRACKS.get(style, names.get(style, names["neon"]))
        return cls(style=style, name=name, seed=0 if seed is None else seed)

    def point_at(self, progress: float) -> tuple[float, float]:
        point = (progress % 1.0) * len(_WAYPOINTS)
        index = math.floor(point)
        amount = point - index
        count = len(_WAYPOINTS)
        p0 = _WAYPOINTS[(index - 1) % count]
        p1 = _WAYPOINTS[index % count]
        p2 = _WAYPOINTS[(index + 1) % count]
        p3 = _WAYPOINTS[(index + 2) % count]
        return (
            self.center_x + _catmull_rom(p0[0], p1[0], p2[0], p3[0], amount),
            self.center_y + _catmull_rom(p0[1], p1[1], p2[1], p3[1], amount),
        )

    def heading_at(self, progress: float) -> float:
        delta = 1e-5
        before = self.point_at(progress - delta)
        after = self.point_at(progress + delta)
        return math.atan2(after[1] - before[1], after[0] - before[0])

    def progress_and_offset(
        self,
        x: float,
        y: float,
        reference_progress: float | None = None,
    ) -> tuple[float, float]:
        if reference_progress is None:
            indices = range(_SAMPLE_COUNT)
        else:
            center = round((reference_progress % 1.0) * _SAMPLE_COUNT)
            indices = ((center + delta) % _SAMPLE_COUNT for delta in range(-24, 25))

        best_distance = math.inf
        best_progress = 0.0
        for index in indices:
            start_progress = index / _SAMPLE_COUNT
            end_progress = (index + 1) / _SAMPLE_COUNT
            ax, ay = self.point_at(start_progress)
            bx, by = self.point_at(end_progress)
            dx, dy = bx - ax, by - ay
            length_squared = dx * dx + dy * dy
            if length_squared <= 1e-12:
                continue
            amount = max(
                0.0,
                min(1.0, ((x - ax) * dx + (y - ay) * dy) / length_squared),
            )
            nearest_x, nearest_y = ax + amount * dx, ay + amount * dy
            offset_x, offset_y = x - nearest_x, y - nearest_y
            distance = offset_x * offset_x + offset_y * offset_y
            if distance < best_distance:
                best_distance = distance
                best_progress = (index + amount) / _SAMPLE_COUNT
        seed_progress = best_progress
        for _ in range(8):
            point = self.point_at(best_progress)
            before = self.point_at(best_progress - 1e-4)
            after = self.point_at(best_progress + 1e-4)
            first_x = (after[0] - before[0]) / 2e-4
            first_y = (after[1] - before[1]) / 2e-4
            second_x = (after[0] - 2.0 * point[0] + before[0]) / 1e-8
            second_y = (after[1] - 2.0 * point[1] + before[1]) / 1e-8
            residual_x, residual_y = point[0] - x, point[1] - y
            numerator = residual_x * first_x + residual_y * first_y
            denominator = (
                first_x * first_x + first_y * first_y
                + residual_x * second_x + residual_y * second_y
            )
            if abs(denominator) < 1e-9:
                break
            adjustment = max(-0.003, min(0.003, numerator / denominator))
            best_progress = max(
                seed_progress - 0.01,
                min(seed_progress + 0.01, best_progress - adjustment),
            )
        point = self.point_at(best_progress)
        heading = self.heading_at(best_progress)
        normal_x, normal_y = -math.sin(heading), math.cos(heading)
        signed_offset = (x - point[0]) * normal_x + (y - point[1]) * normal_y
        return best_progress % 1.0, abs(signed_offset)

    def clamp_position(
        self,
        x: float,
        y: float,
        max_offset: float,
        reference_progress: float | None = None,
    ) -> tuple[float, float, float]:
        progress, offset = self.progress_and_offset(
            x, y, reference_progress=reference_progress
        )
        if offset <= max_offset:
            return x, y, progress
        center_x, center_y = self.point_at(progress)
        heading = self.heading_at(progress)
        normal_x, normal_y = -math.sin(heading), math.cos(heading)
        side = 1.0 if (x - center_x) * normal_x + (y - center_y) * normal_y >= 0.0 else -1.0
        return (
            center_x + normal_x * side * max_offset,
            center_y + normal_y * side * max_offset,
            progress,
        )

    def start_pose(self, slot: int) -> tuple[float, float, float, float]:
        row = slot // 2
        side = -1.0 if slot % 2 == 0 else 1.0
        progress = (0.010 + row * 0.016) % 1.0
        x, y = self.point_at(progress)
        heading = self.heading_at(progress)
        x += -math.sin(heading) * side * self.width * 0.13
        y += math.cos(heading) * side * self.width * 0.13
        return x, y, heading, progress

    def bounds(self) -> tuple[float, float, float, float]:
        margin = self.width * 0.9
        return (
            self.center_x - 550.0 - margin,
            self.center_y - 260.0 - margin,
            self.center_x + 550.0 + margin,
            self.center_y + 260.0 + margin,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "center_x": self.center_x,
            "center_y": self.center_y,
            "width": self.width,
            "style": self.style,
            "name": self.name,
            "seed": self.seed,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Track":
        return cls(
            center_x=float(data.get("center_x", 0.0)),
            center_y=float(data.get("center_y", 0.0)),
            width=float(data.get("width", 168.0)),
            style=str(data.get("style", "neon")),
            name=str(data.get("name", "NEON RUSH CIRCUIT")),
            seed=int(data.get("seed", 0)),
        )
