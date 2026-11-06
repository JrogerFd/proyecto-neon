"""Renderer de consola: telemetría periódica sin dependencias externas."""

from __future__ import annotations

import time
from typing import Any

from ..track import Track
from .base import Renderer


class ConsoleRenderer(Renderer):
    supports_keyboard = False

    def __init__(
        self,
        track: Track,
        title: str = "NEON RUSH",
        refresh_seconds: float = 0.75,
    ) -> None:
        super().__init__(track, title)
        self.refresh_seconds = refresh_seconds
        self._last_draw = 0.0

    def draw(self, snapshot: dict[str, Any], focus_ids: list[int]) -> None:
        now = time.monotonic()
        if now - self._last_draw < self.refresh_seconds and snapshot.get(
            "status"
        ) != "finished":
            return
        self._last_draw = now
        by_id = {vehicle["id"]: vehicle for vehicle in snapshot.get("vehicles", [])}
        lines = [
            f"[{self.title}] t={snapshot.get('race_time', 0.0):6.2f}s "
            f"status={snapshot.get('status', '?')}"
        ]
        for player_id in focus_ids:
            vehicle = by_id.get(player_id)
            if vehicle is None:
                continue
            status = "OFF" if vehicle["off_track"] else "OK "
            lines.append(
                f"  P{vehicle['id']} {vehicle['name'][:12]:<12} "
                f"L{vehicle['lap']}/{vehicle['laps']} "
                f"v={vehicle['speed']:6.1f} "
                f"prog={vehicle['progress'] * 100:5.1f}% "
                f"lap={vehicle['last_lap'] if vehicle['last_lap'] is not None else '-':>6} "
                f"{status}"
            )
        print("\n".join(lines), flush=True)

    def close(self) -> None:
        self._closed = True
