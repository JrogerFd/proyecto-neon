"""Paleta y utilidades visuales de carreras Future/OASIS."""

from __future__ import annotations

from typing import Any, Iterable

import pygame

Color = tuple[int, int, int]

BACKGROUND: Color = (7, 10, 14)
BACKGROUND_TOP: Color = (14, 19, 24)
PANEL: Color = (9, 14, 18)
GRID: Color = (20, 31, 37)
CYAN: Color = (83, 196, 200)
CYAN_DIM: Color = (48, 111, 119)
MAGENTA: Color = (199, 115, 146)
MAGENTA_DIM: Color = (103, 55, 75)
LIME: Color = (184, 202, 127)
ORANGE: Color = (225, 163, 105)
RED: Color = (213, 95, 93)
GREEN: Color = (110, 195, 150)
WHITE: Color = (231, 236, 230)
MUTED: Color = (124, 142, 148)
ASPHALT: Color = (31, 38, 43)
ASPHALT_LIGHT: Color = (45, 54, 60)

PLAYER_FALLBACK = "#53c4c8"

TRACK_PALETTES: dict[str, dict[str, Color]] = {
    "neon": {
        "background_top": (14, 19, 24),
        "background": (7, 10, 14),
        "grid": (20, 31, 37),
        "grid_major": (35, 51, 57),
        "road": (43, 69, 73),
        "asphalt": (31, 38, 43),
        "asphalt_light": (45, 54, 60),
        "edge_outer": MAGENTA,
        "edge_inner": CYAN,
        "post": CYAN,
        "post_alt": MAGENTA,
        "accent": CYAN,
    },
    "synth": {
        "background_top": (24, 6, 32),
        "background": (10, 2, 18),
        "grid": (49, 12, 66),
        "grid_major": (94, 28, 112),
        "road": (94, 20, 72),
        "asphalt": (36, 24, 44),
        "asphalt_light": (54, 36, 62),
        "edge_outer": MAGENTA,
        "edge_inner": ORANGE,
        "post": MAGENTA,
        "post_alt": ORANGE,
        "accent": MAGENTA,
    },
    "code": {
        "background_top": (3, 22, 20),
        "background": (2, 9, 10),
        "grid": (10, 48, 42),
        "grid_major": (20, 82, 68),
        "road": (12, 76, 60),
        "asphalt": (22, 35, 36),
        "asphalt_light": (32, 50, 50),
        "edge_outer": LIME,
        "edge_inner": GREEN,
        "post": LIME,
        "post_alt": GREEN,
        "accent": LIME,
    },
    "void": {
        "background_top": (20, 8, 8),
        "background": (8, 3, 4),
        "grid": (52, 18, 22),
        "grid_major": (94, 32, 30),
        "road": (92, 38, 22),
        "asphalt": (40, 28, 28),
        "asphalt_light": (60, 40, 38),
        "edge_outer": ORANGE,
        "edge_inner": RED,
        "post": ORANGE,
        "post_alt": MAGENTA,
        "accent": ORANGE,
    },
}


def track_palette(style: str) -> dict[str, Color]:
    return TRACK_PALETTES.get(style, TRACK_PALETTES["neon"])

SPEED_DISPLAY_FACTOR = 0.76


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def scale_color(color: Color, factor: float) -> Color:
    factor = clamp(factor, 0.0, 1.0)
    return (
        int(clamp(color[0] * factor, 0, 255)),
        int(clamp(color[1] * factor, 0, 255)),
        int(clamp(color[2] * factor, 0, 255)),
    )


def lerp_color(a: Color, b: Color, alpha: float) -> Color:
    alpha = clamp(alpha, 0.0, 1.0)
    return (
        int(a[0] + (b[0] - a[0]) * alpha),
        int(a[1] + (b[1] - a[1]) * alpha),
        int(a[2] + (b[2] - a[2]) * alpha),
    )


def gradient_color(ratio: float) -> Color:
    ratio = clamp(ratio, 0.0, 1.0)
    if ratio < 0.55:
        return lerp_color(CYAN, MAGENTA, ratio / 0.55)
    return lerp_color(MAGENTA, ORANGE, (ratio - 0.55) / 0.45)


def make_font(pygame: Any, size: int, bold: bool = True) -> Any:
    for name in ("bahnschrift", "consolas", "dejavusansmono", "monospace"):
        path = pygame.font.match_font(name, bold=bold)
        if path:
            return pygame.font.Font(path, size)
    return pygame.font.Font(None, size)


def draw_neon_line(
    surface: Any,
    color: Color,
    points: Iterable[tuple[int, int]],
    width: int = 1,
    closed: bool = False,
) -> None:
    points = list(points)
    if len(points) < 2:
        return
    glow_width = width + max(8, width // 2)
    pygame.draw.lines(surface, scale_color(color, 0.18), closed, points, glow_width)
    pygame.draw.lines(surface, scale_color(color, 0.45), closed, points, width + 4)
    pygame.draw.lines(surface, color, closed, points, width)


def draw_neon_rect(
    surface: Any,
    rect: Any,
    color: Color,
    width: int = 1,
    radius: int = 0,
) -> None:
    pygame.draw.rect(
        surface, scale_color(color, 0.25), rect.inflate(6, 6), width + 3, radius
    )
    pygame.draw.rect(surface, color, rect, width, radius)


def draw_panel(
    surface: Any,
    rect: Any,
    color: Color = CYAN,
    alpha: int = 148,
    radius: int = 10,
) -> None:
    panel = pygame.Surface((max(1, rect.width), max(1, rect.height)), pygame.SRCALPHA)
    panel.fill((*PANEL, alpha))
    pygame.draw.rect(panel, (*color, min(255, alpha + 55)), panel.get_rect(), 1, radius)
    surface.blit(panel, rect.topleft)


def render_glow_text(
    pygame: Any,
    font: Any,
    text: str,
    color: Color,
    glow: Color | None = None,
) -> Any:
    base = font.render(text, True, color)
    if glow is None:
        return base
    pad = 3
    result = pygame.Surface(
        (base.get_width() + pad * 2, base.get_height() + pad * 2), pygame.SRCALPHA
    )
    glow_layer = font.render(text, True, glow)
    for dx, dy in ((-2, 0), (2, 0), (0, -2), (0, 2), (-1, -1), (1, 1)):
        result.blit(glow_layer, (pad + dx, pad + dy))
    result.blit(base, (pad, pad))
    return result


def blit_text(
    surface: Any,
    font: Any,
    text: str,
    pos: tuple[int, int],
    color: Color,
    *,
    glow: Color | None = None,
    anchor: str = "topleft",
) -> Any:
    rendered = render_glow_text(pygame, font, text, color, glow)
    rect = rendered.get_rect()
    setattr(rect, anchor, pos)
    surface.blit(rendered, rect)
    return rect
