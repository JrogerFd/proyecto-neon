"""Fábrica de renderizadores opcionales."""

from __future__ import annotations

import importlib.util
import logging
import os
import sys
from typing import Any

from ..track import Track
from .base import NullRenderer, Renderer
from .console import ConsoleRenderer

LOGGER = logging.getLogger("neonrush.render")


def create_renderer(
    kind: str,
    track: Track,
    title: str = "NEON RUSH",
    logger: logging.Logger | None = None,
    screen: Any | None = None,
    interactive_tutorial: bool = False,
) -> Renderer:
    kind = (kind or "auto").lower()
    log = logger or LOGGER

    if kind == "none":
        return NullRenderer(track, title)
    if kind in {"console", "headless", "text"}:
        return ConsoleRenderer(track, title)
    if kind == "auto":
        has_display = bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
        has_offscreen = os.environ.get("SDL_VIDEODRIVER", "").lower() == "offscreen"
        has_pygame = importlib.util.find_spec("pygame") is not None
        if (has_display or has_offscreen) and has_pygame:
            kind = "pygame"
        else:
            kind = "console"

    if kind == "pygame":
        try:
            from .pygame_renderer import PygameRenderer

            return PygameRenderer(
                track,
                title,
                screen=screen,
                interactive_tutorial=interactive_tutorial,
            )
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"No se pudo iniciar el renderer Pygame: {exc}") from exc

    log.warning("Renderer '%s' desconocido; usando consola.", kind)
    return ConsoleRenderer(track, title)


def renderer_hint() -> str:
    if sys.platform.startswith("linux"):
        return "Instalá Pygame y ejecutá con DISPLAY activo."
    return "Instalá Pygame para habilitar el renderer gráfico."
