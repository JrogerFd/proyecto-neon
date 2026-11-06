"""Contrato del motor de renderizado.

Las físicas y el estado viven fuera de esta interfaz. Cualquier renderer
(consola, Pygame, null) consume snapshots inmutables y, opcionalmente,
produce controles locales.
"""

from __future__ import annotations

from typing import Any

from ..physics import VehicleInput
from ..track import Track


class Renderer:
    supports_keyboard = False

    def __init__(self, track: Track, title: str = "NEON RUSH") -> None:
        self.track = track
        self.title = title
        self._closed = False

    @property
    def closed(self) -> bool:
        return self._closed

    def poll_inputs(self, snapshot: dict[str, Any] | None) -> list[VehicleInput] | None:
        return None

    def draw_lobby(
        self,
        message: str,
        progress: float | None = None,
        detail: str = "",
    ) -> None:
        """Pantalla de espera/carga previa a la largada (no-op por defecto)."""

    def draw(self, snapshot: dict[str, Any], focus_ids: list[int]) -> None:
        raise NotImplementedError

    def close(self) -> None:
        self._closed = True


class NullRenderer(Renderer):
    """Renderer para servidores, pruebas y demos sin interfaz."""

    def draw(self, snapshot: dict[str, Any], focus_ids: list[int]) -> None:
        return
