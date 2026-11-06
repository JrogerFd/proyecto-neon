"""Aplicación de escritorio OASIS / NEON RUSH.

Flujo completo:
  título -> tutorial IA -> menú -> garaje -> carga virtual -> carrera -> resultados

La UI usa Pygame y la estética de Ready Player One: neón cian/magenta, rejillas
en perspectiva, lluvia de código, hologramas y barras de progreso virtuales.
La carrera delega en Master-Worker (modo multijugador) o en el modo local.
"""

from __future__ import annotations

import logging
import math
import os
import random
import socket
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

import pygame

from .asset_manager import AssetManager, AssetSpec
from .audio import SynthAudio
from .config import PLAYER_COLORS, RENDER_FPS
from .content import (
    CHARACTERS,
    MODES,
    MODES_BY_ID,
    POWERS,
    VEHICLES,
    GameMode,
    Loadout,
    Profile,
    build_track,
    get_loadout,
    make_race_players,
    rival_loadout,
)
RIM_STYLES = ("aero", "turbine", "forged")
from .local import LocalGame
from .master import MasterNode
from .render import theme as T
from .worker import WorkerClient

WIDTH = 1280
HEIGHT = 720
TRANSITION_SECONDS = 2.6
LOGGER = logging.getLogger("neonrush.app")

TUTORIAL_PAGES: tuple[tuple[str, str], ...] = (
    (
        "BIENVENIDO AL OASIS",
        "Soy ORACLE-9, tu guía virtual. Has cruzado la transición al FUTURE "
        "MODE: el OASIS es una red de circuitos holográficos donde cada piloto "
        "reescribe la pista. NEON RUSH corre sobre nodos Master-Worker.",
    ),
    (
        "CONTROLES DE PILOTO",
        "Jugador 1: W acelerar, S frenar, A/D girar, ESPACIO turbo, E poder. "
        "Jugador 2: flechas, CTRL turbo, SHIFT poder. "
        "La carrera usa una vista superior fija; ESC sale. "
        "En el garaje elegís personaje, vehículo y poder; "
        "cada combinación cambia la física real del coche.",
    ),
    (
        "TELEMETRÍA HOLOGRÁFICA",
        "Abajo a la derecha tenés el velocímetro digital con aguja y marcha. "
        "Arriba ves la posición P1/P2, la barra de vuelta L1/L2, el minimapa "
        "GPS y la telemetría de acelerador, freno y mejor vuelta.",
    ),
    (
        "PISTA, BORDES Y COLISIONES",
        "Recorre un circuito técnico fijo con recta principal, chicanes y "
        "horquillas. Los bordes laterales limitan la pista y penalizan las salidas.",
    ),
    (
        "REGLAS DEL CAMPEONATO",
        "Cruzá la meta tantas veces como indique el modo. El Master simula a "
        "60 Hz y envía snapshots a 30 Hz; tu render interpola para que todo se "
        "vea suave. Ganá, suma puntos y desbloqueá tu lugar en el OASIS.",
    ),
)

MAIN_MENU_ITEMS = (
    ("championships", "CAMPEONATOS", "Mapas, niveles y trofeos"),
    ("quick_race", "CARRERA RÁPIDA", "Una vuelta contra la IA"),
    ("garage", "GARAJE", "Vehículo, piloto y circuito"),
    ("shop", "TIENDA", "Pinturas y equipo del OASIS"),
    ("challenges", "DESAFÍOS", "Misiones diarias y NEON CUP"),
)
CHAMPIONSHIP_LEVELS = (
    ("neon_city", "NEON CITY", "Recta principal y chicane técnica", 0),
    ("cyber_desert", "CYBER DESERT", "Horquillas cerradas y zona de frenada", 3),
    ("plasma_circuit", "PLASMA CIRCUIT", "Trazado fijo de curvas enlazadas", 8),
)
SHOP_ITEMS = (
    ("paint_jade", "PINTURA JADE", "#31d88a", "coins", 120),
    ("paint_solar", "PINTURA SOLAR", "#ffb84d", "coins", 200),
    ("suit_oracle", "TRAJE ORACLE", "#b98cff", "coins", 450),
)


def _valid_hex_color(value: str | None) -> bool:
    if not isinstance(value, str) or len(value) != 7 or value[0] != "#":
        return False
    try:
        int(value[1:], 16)
    except ValueError:
        return False
    return True


@dataclass(frozen=True)
class _Rect:
    x: int
    y: int
    w: int
    h: int

    def pygame(self) -> pygame.Rect:
        return pygame.Rect(self.x, self.y, self.w, self.h)

    def contains(self, pos: tuple[int, int]) -> bool:
        return self.pygame().collidepoint(pos)


class OasisBackground:
    """Fondo animado: rejilla en perspectiva, lluvia de código y tráfico."""

    def __init__(self, seed: int = 7) -> None:
        self.rng = random.Random(seed)
        self.t = 0.0
        self.columns = [
            {
                "x": self.rng.randrange(0, WIDTH, 28),
                "y": self.rng.uniform(-HEIGHT, HEIGHT),
                "speed": self.rng.uniform(28, 90),
                "char": self.rng.choice("01<>[]{}#$%&@ABCDEF"),
                "swap": self.rng.uniform(0.08, 0.4),
            }
            for _ in range(22)
        ]

    def update(self, dt: float) -> None:
        self.t += dt
        for column in self.columns:
            column["y"] += column["speed"] * dt
            column["swap"] -= dt
            if column["swap"] <= 0:
                column["swap"] = self.rng.uniform(0.08, 0.4)
                column["char"] = self.rng.choice("01<>[]{}#$%&@ABCDEF")
            if column["y"] > HEIGHT + 20:
                column["y"] = -self.rng.uniform(20, 220)
                column["x"] = self.rng.randrange(0, WIDTH, 28)

    def draw(self, screen: pygame.Surface, font: pygame.font.Font) -> None:
        horizon = 392
        for column in self.columns:
            text = font.render(str(column["char"]), True, T.scale_color(T.CYAN, 0.24))
            screen.blit(text, (int(column["x"]), int(column["y"])))

        pygame.draw.circle(
            screen, T.scale_color(T.MAGENTA, 0.16), (WIDTH // 2, horizon - 120), 165
        )
        pygame.draw.circle(
            screen, T.scale_color(T.ORANGE, 0.13), (WIDTH // 2, horizon - 120), 128
        )
        for stripe in range(7):
            y = horizon - 210 + stripe * 20
            pygame.draw.line(
                screen,
                (6, 6, 16),
                (WIDTH // 2 - 190, y),
                (WIDTH // 2 + 190, y),
                5,
            )

        vanish_x = WIDTH // 2
        road_left = []
        road_right = []
        for step in range(19):
            z = (step / 18.0) ** 1.7
            y = int(horizon + z * (HEIGHT - horizon))
            half = int(50 + z * 780)
            road_left.append((vanish_x - half, y))
            road_right.append((vanish_x + half, y))
            if step:
                pygame.draw.line(
                    screen,
                    T.scale_color(T.MAGENTA, 0.10 + z * 0.16),
                    road_left[step - 1],
                    road_left[step],
                    1 if step < 8 else 2,
                )
                pygame.draw.line(
                    screen,
                    T.scale_color(T.CYAN, 0.10 + z * 0.16),
                    road_right[step - 1],
                    road_right[step],
                    1 if step < 8 else 2,
                )
        phase = (self.t * 0.55) % 1.0
        for index in range(20):
            z = ((index + phase) / 20.0) ** 1.7
            y = int(horizon + z * (HEIGHT - horizon))
            half = int(50 + z * 780)
            pygame.draw.line(
                screen,
                T.scale_color(T.CYAN, 0.04 + z * 0.10),
                (vanish_x - half, y),
                (vanish_x + half, y),
                1,
            )
        for lane in (-0.5, 0.0, 0.5):
            for index in range(1, 18):
                z0 = (index / 18.0) ** 1.7
                z1 = ((index + 0.42) / 18.0) ** 1.7
                x0 = vanish_x + int(lane * (100 + z0 * 1400))
                x1 = vanish_x + int(lane * (100 + z1 * 1400))
                y0 = int(horizon + z0 * (HEIGHT - horizon))
                y1 = int(horizon + z1 * (HEIGHT - horizon))
                pygame.draw.line(
                    screen,
                    T.scale_color(T.WHITE, 0.06 + z0 * 0.12),
                    (x0, y0),
                    (x1, y1),
                    max(1, int(1 + z0 * 3)),
                )

        colors = (T.CYAN, T.MAGENTA, T.LIME, T.ORANGE)
        for index in range(7):
            z = (self.t * 0.22 + index / 7.0) % 1.0
            y = int(horizon + (z**1.8) * (HEIGHT - horizon))
            lane = (index % 3) - 1
            x = vanish_x + int(lane * (80 + z * 620))
            size = 3 + z * 20
            color = colors[index % len(colors)]
            trail_end = (x, int(y - size * 0.7))
            trail_start = (x, int(y - size * 7.0))
            pygame.draw.line(
                screen,
                T.scale_color(color, 0.08 + z * 0.18),
                trail_start,
                trail_end,
                max(1, int(size * 0.22)),
            )
            self._draw_remote_car(screen, x, y, size, color)

    def draw_jungle(self, screen: pygame.Surface) -> None:
        for index in range(24):
            ratio = index / 23
            color = (
                int(16 + 73 * ratio),
                int(67 + 83 * ratio),
                int(83 + 32 * ratio),
            )
            pygame.draw.rect(
                screen,
                color,
                (0, int(index * HEIGHT / 24), WIDTH, HEIGHT // 24 + 1),
            )

        sun_x = WIDTH // 2 + int(math.sin(self.t * 0.06) * 90)
        pygame.draw.circle(screen, (247, 215, 142), (sun_x, 190), 58)
        pygame.draw.circle(screen, (255, 232, 173), (sun_x, 190), 39)
        pygame.draw.polygon(
            screen,
            (78, 134, 101),
            [(0, 360), (190, 276), (370, 340), (610, 275), (850, 342), (1080, 284), (1280, 350), (1280, 500), (0, 500)],
        )
        pygame.draw.polygon(
            screen,
            (42, 100, 74),
            [(0, 414), (230, 330), (420, 400), (700, 324), (925, 398), (1120, 334), (1280, 405), (1280, 570), (0, 570)],
        )
        pygame.draw.rect(screen, (24, 91, 61), (0, 430, WIDTH, 290))
        for side in (-1, 1):
            for index in range(9):
                x = 26 + index * 75 if side < 0 else WIDTH - 26 - index * 75
                y = 318 + (index % 3) * 32
                trunk_width = 10 + (index % 2) * 4
                pygame.draw.polygon(
                    screen,
                    (93, 75, 48),
                    [
                        (x - trunk_width, y + 145),
                        (x + trunk_width, y + 145),
                        (x + trunk_width // 2, y),
                        (x - trunk_width // 2, y),
                    ],
                )
                canopy_color = (28 + index % 3 * 5, 105 + index % 2 * 15, 63)
                for leaf in range(7):
                    angle = math.tau * leaf / 7 + math.sin(self.t * 0.12 + index) * 0.04
                    end = (
                        int(x + math.cos(angle) * (38 + index % 3 * 6)),
                        int(y + math.sin(angle) * (24 + index % 2 * 7)),
                    )
                    pygame.draw.line(screen, canopy_color, (x, y), end, 9)

        horizon = 414
        road = [
            (WIDTH // 2 - 54, horizon),
            (WIDTH // 2 + 54, horizon),
            (WIDTH + 120, HEIGHT),
            (-120, HEIGHT),
        ]
        pygame.draw.polygon(screen, (135, 125, 99), road)
        pygame.draw.polygon(
            screen,
            (212, 196, 153),
            [(WIDTH // 2 - 49, horizon), (WIDTH // 2 - 43, horizon), (-64, HEIGHT), (-120, HEIGHT)],
        )
        pygame.draw.polygon(
            screen,
            (212, 196, 153),
            [(WIDTH // 2 + 43, horizon), (WIDTH // 2 + 49, horizon), (WIDTH + 120, HEIGHT), (WIDTH + 64, HEIGHT)],
        )
        phase = (self.t * 0.35) % 1.0
        for index in range(9):
            depth = ((index + phase) / 9.0) ** 1.7
            y = int(horizon + depth * (HEIGHT - horizon))
            half = int(5 + depth * 48)
            pygame.draw.line(
                screen,
                (229, 212, 165),
                (WIDTH // 2 - half, y),
                (WIDTH // 2 + half, y),
                max(1, int(1 + depth * 3)),
            )


    @staticmethod
    def _draw_remote_car(
        screen: pygame.Surface,
        x: int,
        y: int,
        size: float,
        color: tuple[int, int, int],
    ) -> None:
        width = max(2, int(size * 0.62))
        height = max(3, int(size * 1.35))
        pygame.draw.rect(
            screen,
            T.scale_color(color, 0.18),
            (x - width * 2, y - height, width * 4, height * 2),
            border_radius=max(2, int(size * 0.25)),
        )
        pygame.draw.polygon(
            screen,
            T.scale_color(color, 0.75),
            [
                (x, y - height),
                (x + width, y - height * 0.2),
                (x + width * 0.7, y + height * 0.6),
                (x - width * 0.7, y + height * 0.6),
                (x - width, y - height * 0.2),
            ],
        )
        pygame.draw.circle(
            screen, T.scale_color(T.WHITE, 0.8), (x, y - int(height * 0.55)), max(1, int(size * 0.07))
        )


class NeonApp:
    def __init__(
        self,
        *,
        asset_delay: float = 0.8,
        enable_audio: bool = True,
        skip_tutorial: bool = False,
        mode_id: str | None = None,
        autostart: bool = False,
        logger: logging.Logger | None = None,
    ) -> None:
        self.logger = logger or LOGGER
        driver = os.environ.get("SDL_VIDEODRIVER", "").lower()
        if not (
            os.environ.get("DISPLAY")
            or os.environ.get("WAYLAND_DISPLAY")
            or driver in {"dummy", "offscreen"}
        ):
            raise RuntimeError(
                "Neon Rush necesita un servidor gráfico. Usá una terminal con "
                "DISPLAY/WAYLAND_DISPLAY o SDL_VIDEODRIVER=dummy para pruebas."
            )
        pygame.init()
        self._headless_test = driver == "dummy"
        pygame.display.set_caption("NEON RUSH // OASIS")
        self.display_surface = pygame.display.set_mode((WIDTH, HEIGHT), pygame.DOUBLEBUF)
        self.screen = self.display_surface
        self.clock = pygame.time.Clock()
        self.audio = SynthAudio(enabled=enable_audio)
        self.profile = Profile.load()
        self.mode: GameMode = MODES_BY_ID.get(mode_id or self.profile.last_mode, MODES[3])
        self.loadout: Loadout = self.profile.loadout()
        self._force_skip_tutorial = skip_tutorial
        self._autostart = autostart
        self.asset_delay = max(0.0, asset_delay)

        self.state = "title"
        self.time = 0.0
        self.state_time = 0.0
        self.error = ""
        self.results: list[dict[str, Any]] = []
        self._active_race_id: str | None = None
        self.tutorial_index = 0
        self.menu_index = max(
            0,
            next(
                (index for index, mode in enumerate(MODES) if mode.id == self.mode.id),
                0,
            ),
        )
        self.main_menu_index = 0
        self.championship_index = 0
        self.shop_index = 0
        self._selected_championship_track: str | None = None
        self.garage_row = 0
        self.garage_indices = {
            "character": next(
                index
                for index, item in enumerate(CHARACTERS)
                if item.id == self.loadout.character.id
            ),
            "vehicle": next(
                index
                for index, item in enumerate(VEHICLES)
                if item.id == self.loadout.vehicle.id
            ),
            "power": next(
                index
                for index, item in enumerate(POWERS)
                if item.id == self.loadout.power.id
            ),
        }
        track_styles = ("neon", "synth", "code", "void")
        stored_car_color = self.profile.car_color
        stored_outfit_color = self.profile.outfit_color
        car_color: str = (
            stored_car_color
            if stored_car_color is not None and _valid_hex_color(stored_car_color)
            else self.loadout.color
        )
        outfit_color: str = (
            stored_outfit_color
            if stored_outfit_color is not None and _valid_hex_color(stored_outfit_color)
            else self.loadout.accent
        )
        car_palette_color = (
            car_color if car_color in PLAYER_COLORS else self.loadout.color
        )
        outfit_palette_color = (
            outfit_color if outfit_color in PLAYER_COLORS else self.loadout.accent
        )
        self.garage_indices.update(
            {
                "car_color": PLAYER_COLORS.index(car_palette_color),
                "outfit_color": PLAYER_COLORS.index(outfit_palette_color),
                "track_style": (
                    track_styles.index(self.profile.track_style)
                    if self.profile.track_style in track_styles
                    else track_styles.index(self.loadout.character.style)
                ),
                "rim_style": (
                    RIM_STYLES.index(self.profile.rim_style)
                    if self.profile.rim_style in RIM_STYLES
                    else 0
                ),
            }
        )
        self.car_color: str = car_color
        self.outfit_color: str = outfit_color
        self.hex_editing = False
        self.hex_buffer = ""
        self.track_style = track_styles[self.garage_indices["track_style"]]
        self.rim_style = RIM_STYLES[self.garage_indices["rim_style"]]
        self._loading_manager: AssetManager | None = None
        self._loading_started_at = 0.0
        self._loading_ready_at: float | None = None
        self._loading_progress = 0.0
        self._network_executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="oasis-network-preflight"
        )
        self._network_future: Future[
            tuple[MasterNode, WorkerClient, threading.Thread, int]
        ] | None = None
        self._network_status = "pending"
        self._fonts: dict[tuple[int, bool], pygame.font.Font] = {}
        self._gradient: pygame.Surface | None = None
        self._scanlines: pygame.Surface | None = None
        self.bg = OasisBackground()
        self._camera_blend = 0.0
        self._camera_target = 0.0

    # ------------------------------------------------------------------
    # Infraestructura de dibujo
    # ------------------------------------------------------------------
    def _font(self, size: int, bold: bool = True) -> pygame.font.Font:
        key = (size, bold)
        font = self._fonts.get(key)
        if font is None:
            font = T.make_font(pygame, size, bold)
            self._fonts[key] = font
        return font

    def _text(
        self,
        text: str,
        size: int,
        color: tuple[int, int, int],
        pos: tuple[int, int],
        *,
        anchor: str = "center",
        glow: tuple[int, int, int] | None = None,
        bold: bool = True,
    ) -> pygame.Rect:
        return T.blit_text(
            self.screen,
            self._font(size, bold),
            text,
            pos,
            color,
            glow=glow,
            anchor=anchor,
        )

    def _wrap(
        self, text: str, size: int, max_width: int, bold: bool = True
    ) -> list[str]:
        font = self._font(size, bold)
        words = text.split()
        lines: list[str] = []
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if font.size(candidate)[0] <= max_width or not current:
                current = candidate
            else:
                lines.append(current)
                current = word
        if current:
            lines.append(current)
        return lines

    def _base_gradient(self) -> pygame.Surface:
        if self._gradient is not None:
            return self._gradient
        surface = pygame.Surface((WIDTH, HEIGHT))
        for y in range(HEIGHT):
            ratio = y / HEIGHT
            color = T.lerp_color((6, 10, 26), (2, 4, 12), ratio)
            pygame.draw.line(surface, color, (0, y), (WIDTH, y))
        self._gradient = surface
        return surface

    def _scanline_surface(self) -> pygame.Surface:
        if self._scanlines is not None:
            return self._scanlines
        surface = pygame.Surface((WIDTH, HEIGHT), pygame.SRCALPHA)
        for y in range(0, HEIGHT, 4):
            pygame.draw.line(surface, (0, 0, 0, 34), (0, y), (WIDTH, y))
        self._scanlines = surface
        return surface

    def _draw_base(self) -> None:
        if self.state in ("menu", "championship_map", "shop"):
            self.bg.draw_jungle(self.screen)
            return
        self.screen.blit(self._base_gradient(), (0, 0))
        self.bg.draw(self.screen, self._font(14, False))
        for x in range(-HEIGHT, WIDTH + HEIGHT, 64):
            pygame.draw.line(
                self.screen,
                (8, 18, 34),
                (x, HEIGHT),
                (x + HEIGHT, 0),
                1,
            )
        self._draw_orbit_vehicle()
        self.screen.blit(self._scanline_surface(), (0, 0))

    def _draw_orbit_vehicle(self) -> None:
        blend = self._camera_blend
        orbit = self.time * 0.62 * (1.0 - blend)
        center = (
            int(WIDTH * 0.5 + math.cos(orbit) * 208.0 * (1.0 - blend)),
            int(HEIGHT * 0.63 + math.sin(orbit) * 26.0 * (1.0 - blend) + blend * 92.0),
        )
        scale = 0.94 + blend * 0.25
        rotation = orbit * 0.58
        cos_rotation, sin_rotation = math.cos(rotation), math.sin(rotation)
        silhouette = (
            (0, -72),
            (28, -36),
            (35, 18),
            (24, 58),
            (0, 70),
            (-24, 58),
            (-35, 18),
            (-28, -36),
            (0, -72),
        )

        def transform(point: tuple[int, int]) -> tuple[int, int]:
            x = point[0] * scale
            y = point[1] * scale
            return (
                int(center[0] + x * cos_rotation - y * sin_rotation),
                int(center[1] + x * sin_rotation + y * cos_rotation),
            )

        body = [transform(point) for point in silhouette]
        accent = T.lerp_color(T.CYAN, T.MAGENTA, 0.5 + 0.5 * math.sin(self.time))
        pygame.draw.polygon(self.screen, (4, 12, 24), body[:-1])
        pygame.draw.lines(self.screen, T.scale_color(accent, 0.22), True, body, 10)
        pygame.draw.lines(self.screen, accent, True, body, 2)
        canopy = [
            transform(point)
            for point in ((0, -48), (17, -24), (15, 8), (0, 17), (-15, 8), (-17, -24))
        ]
        pygame.draw.polygon(self.screen, (7, 25, 39), canopy)
        pygame.draw.polygon(self.screen, T.scale_color(T.CYAN, 0.82), canopy, 1)
        for side in (-1, 1):
            wheel = [
                transform((side * 30, -28)),
                transform((side * 36, -21)),
                transform((side * 36, 25)),
                transform((side * 30, 30)),
            ]
            pygame.draw.polygon(self.screen, T.scale_color(T.MAGENTA, 0.7), wheel, 1)

    def _draw_panel(
        self,
        rect: pygame.Rect,
        accent: tuple[int, int, int],
        *,
        alpha: int = 178,
        radius: int = 12,
    ) -> None:
        panel = pygame.Surface(rect.size, pygame.SRCALPHA)
        panel.fill((3, 7, 18, alpha))
        pygame.draw.rect(panel, (*T.scale_color(accent, 0.55), 210), panel.get_rect(), 1, radius)
        top_glow = T.scale_color(accent, 0.28)
        pygame.draw.line(
            panel, (*top_glow, 150), (14, 2), (rect.width - 14, 2), 2
        )
        self.screen.blit(panel, rect.topleft)

    def _button(
        self,
        rect: pygame.Rect,
        label: str,
        accent: tuple[int, int, int],
        *,
        selected: bool = False,
        sub: str = "",
        hotkey: str = "",
    ) -> None:
        mouse = pygame.mouse.get_pos()
        hover = rect.collidepoint(mouse)
        pulse = 0.5 + 0.5 * math.sin(self.time * 4.2)
        border = accent if (selected or hover) else T.scale_color(accent, 0.45)
        fill = (4, 9, 20, 218 if selected or hover else 184)
        panel = pygame.Surface(rect.size, pygame.SRCALPHA)
        panel.fill(fill)
        pygame.draw.rect(panel, (*T.scale_color(border, 0.28), 255), panel.get_rect(), 2, 10)
        pygame.draw.rect(panel, (*border, 255), panel.get_rect(), 1, 10)
        pygame.draw.line(panel, (*accent, 170), (16, 3), (rect.width - 16, 3), 2)
        self.screen.blit(panel, rect.topleft)
        if selected or hover:
            glow_alpha = int(28 + pulse * 34)
            self.screen.blit(
                self._glow_surface(rect.inflate(18, 14), accent, glow_alpha),
                rect.inflate(18, 14).topleft,
            )
        self._text(label, 24, T.WHITE, rect.center, glow=T.scale_color(accent, 0.55))
        if sub:
            self._text(sub, 13, T.MUTED, (rect.centerx, rect.bottom - 15), bold=False)
        if hotkey:
            self._text(hotkey, 12, accent, (rect.right - 14, rect.top + 13), anchor="topright")

    def _glow_surface(
        self, rect: pygame.Rect, color: tuple[int, int, int], alpha: int
    ) -> pygame.Surface:
        surface = pygame.Surface(rect.size, pygame.SRCALPHA)
        for index in range(4):
            inflate = index * 2
            pygame.draw.rect(
                surface,
                (*color, max(4, alpha // (index + 1))),
                pygame.Rect(0, 0, rect.width, rect.height).inflate(-inflate, -inflate),
                2,
                10,
            )
        return surface

    # ------------------------------------------------------------------
    # Bucle principal
    # ------------------------------------------------------------------
    def run(self) -> int:
        if self._autostart:
            self._start_loading(self.mode)
        while self.state != "exit":
            dt = min(0.05, self.clock.tick(RENDER_FPS) / 1000.0)
            self.time += dt
            self.state_time += dt
            self._update_camera(dt)
            self.bg.update(dt)
            for event in pygame.event.get():
                self._handle_event(event)
            if self.state == "transition":
                self._update_transition()
            elif self.state == "loading":
                self._update_loading()
            if self.state == "exit":
                break
            self._draw()
            pygame.display.flip()
        self.close()
        return 0

    def _update_camera(self, dt: float) -> None:
        alpha = 1.0 - math.exp(-dt / 0.82)
        self._camera_blend += (self._camera_target - self._camera_blend) * alpha

    def close(self) -> None:
        self._cancel_network_preflight()
        self._network_executor.shutdown(wait=False, cancel_futures=True)
        self.audio.close()
        try:
            pygame.quit()
        except Exception:  # noqa: BLE001
            pass

    def _set_state(self, state: str) -> None:
        self.state = state
        self.state_time = 0.0
        if state == "title":
            self._camera_target = 0.0

    def _handle_event(self, event: pygame.event.Event) -> None:
        if event.type == pygame.QUIT:
            self._set_state("exit")
            return
        if event.type == pygame.TEXTINPUT and self.hex_editing:
            incoming = "".join(
                character for character in event.text if character in "0123456789abcdefABCDEF"
            )
            self.hex_buffer = (self.hex_buffer + incoming)[:6]
            return
        if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            self._handle_click(event.pos)
            return
        if event.type != pygame.KEYDOWN:
            return
        key = event.key
        if self.hex_editing:
            if key == pygame.K_BACKSPACE:
                self.hex_buffer = self.hex_buffer[:-1]
            elif key == pygame.K_RETURN:
                self._commit_hex_color()
            elif key == pygame.K_ESCAPE:
                self._stop_hex_edit()
            return
        if self.state == "title":
            if key in (pygame.K_RETURN, pygame.K_SPACE):
                self._enter_oasis()
            elif key == pygame.K_t:
                self._open_tutorial()
            elif key == pygame.K_ESCAPE:
                self._set_state("exit")
        elif self.state == "transition":
            if key in (pygame.K_RETURN, pygame.K_SPACE, pygame.K_ESCAPE):
                self._finish_transition()
        elif self.state == "tutorial":
            if key in (
                pygame.K_RETURN,
                pygame.K_SPACE,
                pygame.K_RIGHT,
                pygame.K_w,
                pygame.K_c,
            ):
                self._tutorial_next()
            elif key in (pygame.K_ESCAPE, pygame.K_s):
                self._tutorial_skip()
            elif key == pygame.K_LEFT:
                self.tutorial_index = max(0, self.tutorial_index - 1)
        elif self.state == "menu":
            if key in (pygame.K_1, pygame.K_2, pygame.K_3, pygame.K_4, pygame.K_5):
                self.main_menu_index = key - pygame.K_1
                self._activate_main_menu(self.main_menu_index)
            elif key in (pygame.K_LEFT, pygame.K_a):
                self.main_menu_index = (self.main_menu_index - 1) % len(MAIN_MENU_ITEMS)
                self.audio.sfx("hover")
            elif key in (pygame.K_RIGHT, pygame.K_d):
                self.main_menu_index = (self.main_menu_index + 1) % len(MAIN_MENU_ITEMS)
                self.audio.sfx("hover")
            elif key in (pygame.K_RETURN, pygame.K_SPACE):
                self._activate_main_menu(self.main_menu_index)
            elif key == pygame.K_m:
                self.menu_index = (self.menu_index + 1) % len(MODES)
                self.mode = MODES[self.menu_index]
            elif key == pygame.K_t:
                self._open_tutorial()
            elif key == pygame.K_ESCAPE:
                self._set_state("title")
        elif self.state == "championship_map":
            if key in (pygame.K_LEFT, pygame.K_a):
                self.championship_index = (self.championship_index - 1) % len(CHAMPIONSHIP_LEVELS)
            elif key in (pygame.K_RIGHT, pygame.K_d):
                self.championship_index = (self.championship_index + 1) % len(CHAMPIONSHIP_LEVELS)
            elif key in (pygame.K_RETURN, pygame.K_SPACE):
                self._select_championship_level(self.championship_index)
            elif key == pygame.K_ESCAPE:
                self._set_state("menu")
        elif self.state == "shop":
            if key in (pygame.K_LEFT, pygame.K_a):
                self.shop_index = (self.shop_index - 1) % len(SHOP_ITEMS)
            elif key in (pygame.K_RIGHT, pygame.K_d):
                self.shop_index = (self.shop_index + 1) % len(SHOP_ITEMS)
            elif key in (pygame.K_RETURN, pygame.K_SPACE):
                self._activate_shop_item(self.shop_index)
            elif key == pygame.K_ESCAPE:
                self._set_state("menu")
        elif self.state == "challenges":
            if key == pygame.K_ESCAPE:
                self._set_state("menu")
        elif self.state == "garage":
            if key == pygame.K_e and self.garage_row in (3, 4):
                self._start_hex_edit()
            elif key in (pygame.K_UP, pygame.K_w):
                self.garage_row = (self.garage_row - 1) % 7
                self.audio.sfx("hover")
            elif key in (pygame.K_DOWN, pygame.K_s):
                self.garage_row = (self.garage_row + 1) % 7
                self.audio.sfx("hover")
            elif key in (pygame.K_LEFT, pygame.K_a):
                self._cycle_garage(-1)
            elif key in (pygame.K_RIGHT, pygame.K_d):
                self._cycle_garage(1)
            elif key in (pygame.K_RETURN, pygame.K_SPACE):
                self._start_loading(self.mode)
            elif key == pygame.K_ESCAPE:
                self._set_state("menu")
        elif self.state == "loading":
            if key == pygame.K_ESCAPE:
                self._cancel_loading()
        elif self.state == "results":
            if key in (pygame.K_RETURN, pygame.K_SPACE, pygame.K_r):
                self._start_loading(self.mode)
            elif key in (pygame.K_ESCAPE, pygame.K_m):
                self._set_state("menu")

    def _handle_click(self, pos: tuple[int, int]) -> None:
        if self.state == "title":
            if self._title_button_rect().collidepoint(pos):
                self._enter_oasis()
            elif self._title_tutorial_rect().collidepoint(pos):
                self._open_tutorial()
        elif self.state == "transition":
            self._finish_transition()
        elif self.state == "tutorial":
            if self._tutorial_next_rect().collidepoint(pos):
                self._tutorial_next()
            elif self._tutorial_skip_rect().collidepoint(pos):
                self._tutorial_skip()
        elif self.state == "menu":
            for index, rect in enumerate(self._main_menu_rects()):
                if rect.collidepoint(pos):
                    self.main_menu_index = index
                    self._activate_main_menu(index)
                    return
            if self._menu_tutorial_rect().collidepoint(pos):
                self._open_tutorial()
        elif self.state == "championship_map":
            for index, rect in enumerate(self._championship_level_rects()):
                if rect.collidepoint(pos):
                    self.championship_index = index
                    self._select_championship_level(index)
                    return
        elif self.state == "shop":
            for index, rect in enumerate(self._shop_item_rects()):
                if rect.collidepoint(pos):
                    self.shop_index = index
                    self._activate_shop_item(index)
                    return
        elif self.state == "challenges":
            if self._challenges_back_rect().collidepoint(pos):
                self._set_state("menu")
        elif self.state == "garage":
            for row, rect in enumerate(self._garage_row_rects()):
                if rect.collidepoint(pos):
                    self.garage_row = row
                    return
                left, right = self._garage_arrows(row)
                if left.collidepoint(pos):
                    self.garage_row = row
                    self._cycle_garage(-1)
                    return
                if right.collidepoint(pos):
                    self.garage_row = row
                    self._cycle_garage(1)
                    return
            if self._garage_ready_rect().collidepoint(pos):
                self._start_loading(self.mode)
            elif self._garage_back_rect().collidepoint(pos):
                self._set_state("menu")
        elif self.state == "loading":
            if self._loading_cancel_rect().collidepoint(pos):
                self._cancel_loading()
        elif self.state == "results":
            if self._results_again_rect().collidepoint(pos):
                self._start_loading(self.mode)
            elif self._results_menu_rect().collidepoint(pos):
                self._set_state("menu")

    # ------------------------------------------------------------------
    # Transiciones
    # ------------------------------------------------------------------
    def _enter_oasis(self) -> None:
        self.audio.sfx("start")
        self.audio.play_music()
        self._camera_target = 1.0
        self._set_state("transition")

    def _update_transition(self) -> None:
        elapsed = self.state_time
        if elapsed >= TRANSITION_SECONDS:
            self._finish_transition()

    def _finish_transition(self) -> None:
        if self.state != "transition":
            return
        if self._force_skip_tutorial or self.profile.tutorial_seen:
            self._set_state("menu")
        else:
            self._open_tutorial()

    def _open_tutorial(self) -> None:
        self.tutorial_index = 0
        self._set_state("tutorial")

    def _tutorial_next(self) -> None:
        self.audio.sfx("click")
        if self.tutorial_index < len(TUTORIAL_PAGES) - 1:
            self.tutorial_index += 1
        else:
            self._finish_tutorial()

    def _tutorial_skip(self) -> None:
        self.audio.sfx("click")
        self._finish_tutorial()

    def _finish_tutorial(self) -> None:
        if not self._force_skip_tutorial:
            self.profile.tutorial_seen = True
            self.profile.save()
        self._set_state("menu")

    def _choose_mode(self, mode: GameMode) -> None:
        self.audio.sfx("confirm")
        self.mode = mode
        self.menu_index = next(
            (index for index, item in enumerate(MODES) if item.id == mode.id),
            self.menu_index,
        )
        self.profile.last_mode = mode.id
        self.profile.save()
        self._set_state("garage")

    def _activate_main_menu(self, index: int) -> None:
        action = MAIN_MENU_ITEMS[index][0]
        self.audio.sfx("confirm")
        if action == "championships":
            self.championship_index = 0
            self._set_state("championship_map")
        elif action == "quick_race":
            self._selected_championship_track = None
            self._choose_mode(MODES_BY_ID["short"])
        elif action == "garage":
            self._selected_championship_track = None
            self._set_state("garage")
        elif action == "challenges":
            self.profile.ensure_daily_missions()
            self.profile.save()
            self._set_state("challenges")
        else:
            self._set_state("shop")

    def _select_championship_level(self, index: int) -> None:
        level = CHAMPIONSHIP_LEVELS[index]
        track_id = level[0]
        required_trophies = level[3]
        if self.profile.trophies < required_trophies:
            self.error = f"Se necesitan {required_trophies} trofeos para desbloquear este circuito."
            self.audio.sfx("hover")
            return
        self.error = ""
        self._selected_championship_track = track_id
        self.track_style = track_id
        self._choose_mode(MODES_BY_ID["championship"])

    def _activate_shop_item(self, index: int) -> None:
        item = SHOP_ITEMS[index]
        cosmetic_id, color, currency, price = item[0], item[2], item[3], item[4]
        if cosmetic_id not in self.profile.owned_cosmetics and not self.profile.purchase_cosmetic(
            cosmetic_id, price=price, currency=currency
        ):
            balance = getattr(self.profile, currency)
            self.error = f"Saldo insuficiente: hacen falta {price - balance} NC."
            self.audio.sfx("hover")
            return
        if cosmetic_id == "suit_oracle":
            self.outfit_color = color
            self.profile.outfit_color = color
        else:
            self.car_color = color
            self.profile.car_color = color
        self.error = ""
        self.profile.save()
        self.audio.sfx("confirm")

    def _cycle_garage(self, delta: int) -> None:
        self.audio.sfx("hover")
        key = (
            "character",
            "vehicle",
            "power",
            "car_color",
            "outfit_color",
            "track_style",
            "rim_style",
        )[self.garage_row]
        items = {
            "character": CHARACTERS,
            "vehicle": VEHICLES,
            "power": POWERS,
            "car_color": PLAYER_COLORS,
            "outfit_color": PLAYER_COLORS,
            "track_style": ("neon", "synth", "code", "void"),
            "rim_style": RIM_STYLES,
        }[key]
        self.garage_indices[key] = (self.garage_indices[key] + delta) % len(items)
        if key in ("character", "vehicle", "power"):
            self.loadout = get_loadout(
                CHARACTERS[self.garage_indices["character"]].id,
                VEHICLES[self.garage_indices["vehicle"]].id,
                POWERS[self.garage_indices["power"]].id,
            )
        elif key == "car_color":
            self.car_color = PLAYER_COLORS[self.garage_indices[key]]
        elif key == "outfit_color":
            self.outfit_color = PLAYER_COLORS[self.garage_indices[key]]
        else:
            if key == "track_style":
                self.track_style = ("neon", "synth", "code", "void")[
                    self.garage_indices["track_style"]
                ]
            else:
                self.rim_style = RIM_STYLES[self.garage_indices["rim_style"]]
        self.profile.apply_loadout(self.loadout)
        self.profile.car_color = self.car_color
        self.profile.outfit_color = self.outfit_color
        self.profile.track_style = self.track_style
        self.profile.rim_style = self.rim_style
        self.profile.save()

    def _start_hex_edit(self) -> None:
        self.hex_buffer = ""
        self.hex_editing = True
        pygame.key.start_text_input()

    def _stop_hex_edit(self) -> None:
        self.hex_editing = False
        self.hex_buffer = ""
        pygame.key.stop_text_input()

    def _commit_hex_color(self) -> None:
        value = f"#{self.hex_buffer}"
        if len(self.hex_buffer) == 6 and _valid_hex_color(value):
            if self.garage_row == 3:
                self.car_color = value.lower()
                self.profile.car_color = self.car_color
            else:
                self.outfit_color = value.lower()
                self.profile.outfit_color = self.outfit_color
            self.profile.save()
        else:
            self.error = "El color debe tener formato hexadecimal #RRGGBB."
        self._stop_hex_edit()

    def _loading_specs(self) -> list[AssetSpec]:
        scale = max(0.0, self.asset_delay)
        return [
            AssetSpec("master-handshake", 32, 0.34 * scale),
            AssetSpec("oasis-shaders", 640, 0.52 * scale),
            AssetSpec("synthwave-audio", 1024, 0.64 * scale),
            AssetSpec("hologram-fonts", 96, 0.22 * scale),
            AssetSpec("vehicle-skins", 512, 0.46 * scale),
            AssetSpec("track-geometry", 256, 0.30 * scale),
            AssetSpec("ai-pilot", 384, 0.42 * scale),
        ]

    def _start_loading(self, mode: GameMode) -> None:
        self.audio.sfx("start")
        self._active_race_id = uuid.uuid4().hex
        self.mode = mode
        self._set_state("loading")
        self._loading_progress = 0.0
        self._loading_ready_at = None
        self._loading_started_at = time.monotonic()
        self._loading_manager = AssetManager(
            self._loading_specs(),
            max_workers=4,
            name="oasis-app",
            logger=self.logger.getChild("loading"),
        )
        self._loading_manager.start()
        if mode.distributed:
            self._network_status = "loading"
            self._network_future = self._network_executor.submit(
                self._prepare_network_race,
                mode,
                self.loadout,
                self._selected_championship_track or self.track_style,
            )
        else:
            self._network_status = "pending"

    def _cancel_loading(self) -> None:
        if self._loading_manager is not None:
            self._loading_manager.cancel()
            self._loading_manager = None
        self._cancel_network_preflight()
        self._set_state("menu")

    def _update_loading(self) -> None:
        manager = self._loading_manager
        if manager is None:
            return
        network_ready = not self.mode.distributed
        if self.mode.distributed and self._network_future is not None:
            if self._network_future.done():
                try:
                    self._network_future.result()
                except Exception as exc:  # noqa: BLE001
                    self._network_status = "failed"
                    self.error = f"No se pudo preparar la red: {exc}"
                    self._cancel_loading()
                    return
                self._network_status = "ready"
                network_ready = True
        done, total = manager.progress()
        target = done / total if total else 0.0
        self._loading_progress += (target - self._loading_progress) * 0.12
        if manager.error:
            self.error = manager.error
            self._cancel_loading()
            return
        if manager.ready and network_ready:
            if self._loading_ready_at is None:
                self._loading_ready_at = time.monotonic()
                self.audio.sfx("confirm")
            if time.monotonic() - self._loading_ready_at >= 0.6:
                self._begin_race()

    def _begin_race(self) -> None:
        mode = self.mode
        loadout = self.loadout
        race_track_style = self._selected_championship_track or self.track_style
        self.audio.stop_music()
        try:
            if mode.distributed:
                results = self._run_network_race(mode, loadout)
            else:
                results = self._run_local_race(mode, loadout, race_track_style)
        except Exception as exc:  # noqa: BLE001
            self.logger.exception("Fallo al iniciar la carrera")
            self.error = str(exc)
            results = []
        self.audio.play_music()
        self.results = results
        if results:
            self.profile.record_result(
                results,
                mode,
                result_id=self._active_race_id,
                track_key=self._selected_championship_track or self.track_style,
                vehicle_id=loadout.vehicle.id,
            )
        self._set_state("results")

    def _run_local_race(
        self, mode: GameMode, loadout: Loadout, track_style: str
    ) -> list[dict[str, Any]]:
        track = build_track(loadout, style=track_style)
        players = make_race_players(
            loadout,
            mode,
            player_color=self.car_color,
        )
        game = LocalGame(
            laps=mode.laps,
            render="pygame",
            players=players,
            track=track,
            human_players=1,
            focus_players=[1],
            skip_assets=True,
            title=f"NEON RUSH | {mode.name}",
            display_surface=self.screen,
            interactive_tutorial=True,
            logger=self.logger.getChild("race"),
        )
        ok = game.run()
        if not ok and game.error:
            self.error = game.error
        return game.results or []

    def _run_network_race(
        self, mode: GameMode, loadout: Loadout
    ) -> list[dict[str, Any]]:
        self.logger.info("Conectando el piloto a OASIS para %s.", mode.name)
        future = self._network_future
        if future is None:
            raise RuntimeError("La preconexión de red no se inició")
        session = future.result(timeout=0)
        master = session[0]
        port = session[3]
        self._network_future = None
        human: WorkerClient | None = None
        try:
            human = WorkerClient(
                host="127.0.0.1",
                port=port,
                room="OASIS",
                name=f"P1 {loadout.character.name}",
                render="pygame",
                autopilot=False,
                asset_delay=0.02,
                physics_config=loadout.physics(),
                color=self.car_color,
                split_view=True,
                display_surface=self.screen,
                interactive_tutorial=True,
                logger=self.logger.getChild("pilot"),
            )
            human.run()
            master.wait_finished(5.0)
        finally:
            if human is not None:
                human.request_stop()
            self._stop_network_session(session)
        return (human.results if human is not None else None) or master.finish_results or []

    def _prepare_network_race(
        self, mode: GameMode, loadout: Loadout, track_style: str | None = None
    ) -> tuple[MasterNode, WorkerClient, threading.Thread, int]:
        port = _free_port()
        track = build_track(loadout, style=track_style or self.track_style)
        rival = rival_loadout(loadout)
        self.logger.info(
            "Preflight OASIS en 127.0.0.1:%d | %s | pista %s",
            port,
            mode.name,
            track.name,
        )
        master = MasterNode(
            host="127.0.0.1",
            port=port,
            room="OASIS",
            expected_players=2,
            track=track,
            laps=mode.laps,
            asset_delay=0.02,
            auto_shutdown=False,
            logger=self.logger.getChild("master"),
        )
        bot = WorkerClient(
            host="127.0.0.1",
            port=port,
            room="OASIS",
            name=f"BOT {rival.character.name}",
            render="none",
            autopilot=True,
            asset_delay=0.02,
            physics_config=rival.physics(),
            color=rival.color,
            logger=self.logger.getChild("bot"),
        )
        bot_thread = threading.Thread(target=bot.run, name="oasis-bot", daemon=True)
        try:
            master.start_background()
            bot_thread.start()
            if not bot._welcome_event.wait(timeout=8.0):
                raise RuntimeError(
                    bot.error or "Timeout esperando la conexión del rival IA"
                )
            return master, bot, bot_thread, port
        except Exception:
            bot.request_stop()
            master.stop()
            if bot_thread.is_alive():
                bot_thread.join(timeout=2.0)
            raise

    def _cancel_network_preflight(self) -> None:
        future = self._network_future
        self._network_future = None
        if future is None or future.cancel():
            return
        if future.done():
            try:
                self._stop_network_session(future.result())
            except Exception as exc:
                self.logger.warning("Preconexión cancelada antes de quedar lista: %s", exc)
                return
        else:
            future.add_done_callback(self._cleanup_network_future)

    def _cleanup_network_future(
        self,
        future: Future[tuple[MasterNode, WorkerClient, threading.Thread, int]],
    ) -> None:
        try:
            self._stop_network_session(future.result())
        except Exception:
            self.logger.exception("Falló la limpieza de la preconexión OASIS")

    @staticmethod
    def _stop_network_session(
        session: tuple[MasterNode, WorkerClient, threading.Thread, int],
    ) -> None:
        master, bot, bot_thread, port = session
        del port
        bot.request_stop()
        master.stop()
        if bot_thread.is_alive():
            bot_thread.join(timeout=2.0)

    # ------------------------------------------------------------------
    # Layouts
    # ------------------------------------------------------------------
    def _title_button_rect(self) -> pygame.Rect:
        return pygame.Rect(WIDTH // 2 - 280, 494, 560, 82)

    def _title_tutorial_rect(self) -> pygame.Rect:
        return pygame.Rect(WIDTH // 2 - 120, 596, 240, 34)

    def _tutorial_next_rect(self) -> pygame.Rect:
        return pygame.Rect(646, 576, 250, 58)

    def _tutorial_skip_rect(self) -> pygame.Rect:
        return pygame.Rect(912, 576, 264, 58)

    def _mode_rects(self) -> list[pygame.Rect]:
        return [
            pygame.Rect(
                156 + (index % 2) * 492,
                164 + (index // 2) * 202,
                464,
                178,
            )
            for index in range(4)
        ]

    def _main_menu_rects(self) -> list[pygame.Rect]:
        width, gap = 220, 16
        left = (WIDTH - (len(MAIN_MENU_ITEMS) * width + (len(MAIN_MENU_ITEMS) - 1) * gap)) // 2
        return [
            pygame.Rect(left + index * (width + gap), HEIGHT - 104, width, 72)
            for index in range(len(MAIN_MENU_ITEMS))
        ]

    def _championship_level_rects(self) -> list[pygame.Rect]:
        return [pygame.Rect(82 + index * 376, 260, 340, 270) for index in range(3)]

    def _shop_item_rects(self) -> list[pygame.Rect]:
        return [pygame.Rect(92 + index * 376, 255, 340, 300) for index in range(3)]

    def _menu_tutorial_rect(self) -> pygame.Rect:
        return pygame.Rect(40, 548, 220, 48)

    def _garage_row_rects(self) -> list[pygame.Rect]:
        return [
            pygame.Rect(642, 188 + row * 58, 596, 52)
            for row in range(7)
        ]

    def _garage_arrows(self, row: int) -> tuple[pygame.Rect, pygame.Rect]:
        rect = self._garage_row_rects()[row]
        return (
            pygame.Rect(rect.x + 8, rect.centery - 17, 34, 34),
            pygame.Rect(rect.right - 42, rect.centery - 17, 34, 34),
        )

    def _garage_ready_rect(self) -> pygame.Rect:
        return pygame.Rect(874, 642, 364, 56)

    def _garage_back_rect(self) -> pygame.Rect:
        return pygame.Rect(642, 642, 220, 56)

    def _loading_cancel_rect(self) -> pygame.Rect:
        return pygame.Rect(WIDTH // 2 - 110, 588, 220, 44)

    def _results_again_rect(self) -> pygame.Rect:
        return pygame.Rect(WIDTH // 2 - 280, 590, 250, 60)

    def _results_menu_rect(self) -> pygame.Rect:
        return pygame.Rect(WIDTH // 2 + 30, 590, 250, 60)

    def _challenges_back_rect(self) -> pygame.Rect:
        return pygame.Rect(WIDTH // 2 - 120, 616, 240, 52)

    # ------------------------------------------------------------------
    # Dibujo por estado
    # ------------------------------------------------------------------
    def _draw(self) -> None:
        if self.state == "title":
            self._draw_title()
        elif self.state == "transition":
            self._draw_transition()
        elif self.state == "tutorial":
            self._draw_tutorial()
        elif self.state == "menu":
            self._draw_menu()
        elif self.state == "championship_map":
            self._draw_championship_map()
        elif self.state == "shop":
            self._draw_shop()
        elif self.state == "challenges":
            self._draw_challenges()
        elif self.state == "garage":
            self._draw_garage()
        elif self.state == "loading":
            self._draw_loading()
        elif self.state == "results":
            self._draw_results()

    def _draw_title(self) -> None:
        self._draw_base()
        overlay = pygame.Surface((WIDTH, HEIGHT), pygame.SRCALPHA)
        overlay.fill((2, 4, 12, 96))
        self.screen.blit(overlay, (0, 0))

        self._text(
            "SISTEMA // UNIVERSO NORMAL",
            13,
            T.CYAN,
            (38, 30),
            anchor="topleft",
            bold=False,
        )
        self._text(
            "MODO CLÁSICO · FUTURE MODE LISTO",
            13,
            T.MAGENTA,
            (WIDTH - 38, 30),
            anchor="topright",
            bold=False,
        )

        pulse = 0.5 + 0.5 * math.sin(self.time * 2.2)
        self._text(
            "NEON RUSH",
            104,
            T.WHITE,
            (WIDTH // 2, 250),
            glow=T.scale_color(T.CYAN, 0.55 + pulse * 0.3),
        )
        self._text(
            "READY PLAYER ONE // OASIS RACING PROTOCOL",
            20,
            T.MAGENTA,
            (WIDTH // 2, 326),
            glow=T.scale_color(T.MAGENTA, 0.35),
        )
        self._text(
            "ENTRA AL OASIS. CORRE. REESCRIBE LA REALIDAD.",
            16,
            T.MUTED,
            (WIDTH // 2, 364),
            bold=False,
        )
        self._text(
            "UNIVERSO NORMAL / CLÁSICO · TRANSICIÓN FUTURE MODE DISPONIBLE",
            13,
            T.scale_color(T.CYAN, 0.75),
            (WIDTH // 2, 412),
            bold=False,
        )

        for index in range(5):
            x = WIDTH // 2 - 210 + index * 105
            alpha = 0.3 + 0.5 * (0.5 + 0.5 * math.sin(self.time * 3 + index))
            pygame.draw.line(
                self.screen,
                T.scale_color(T.CYAN if index % 2 else T.MAGENTA, alpha),
                (x, 390),
                (x + 54, 390),
                2,
            )

        self._button(
            self._title_button_rect(),
            "[ ENTRAR AL OASIS / FUTURE MODE ]",
            T.CYAN,
            selected=True,
            sub="ENTER · CLICK · TRANSICIÓN DE UNIVERSO",
            hotkey="READY",
        )
        self._button(
            self._title_tutorial_rect(),
            "T · TUTORIAL DE ORACLE-9",
            T.MAGENTA,
            sub="",
        )
        self._text(
            f"PERFIL  {self.profile.wins} VICTORIAS  ·  {self.profile.points} PUNTOS",
            13,
            T.MUTED,
            (38, HEIGHT - 30),
            anchor="bottomleft",
            bold=False,
        )
        self._text(
            "ESC · SALIR",
            13,
            T.MUTED,
            (WIDTH - 38, HEIGHT - 30),
            anchor="bottomright",
            bold=False,
        )

    def _draw_transition(self) -> None:
        t = max(0.0, min(1.0, self.state_time / TRANSITION_SECONDS))
        smooth = t * t * (3.0 - 2.0 * t)
        self._draw_base()
        tint = pygame.Surface((WIDTH, HEIGHT), pygame.SRCALPHA)
        tint.fill((0, 26, 48, int(68 * smooth)))
        self.screen.blit(tint, (0, 0))

        cx, cy = WIDTH // 2, HEIGHT // 2
        line_colors = (T.CYAN, T.MAGENTA, T.LIME, T.ORANGE)
        for index in range(36):
            angle = index * math.tau / 36 + self.time * 0.18
            length = 38 + 160 * smooth
            start = (cx + math.cos(angle) * 210, cy + math.sin(angle) * 135)
            end = (
                cx + math.cos(angle) * (210 + length),
                cy + math.sin(angle) * (135 + length * 0.65),
            )
            color = line_colors[index % len(line_colors)]
            pygame.draw.line(self.screen, T.scale_color(color, 0.16 + smooth * 0.3), start, end, 2)

        title = "ENTRANDO AL OASIS" if t < 0.82 else "FUTURE MODE"
        color = T.CYAN if int(self.state_time * 10) % 2 else T.MAGENTA
        self._text(title, 40, color, (cx, cy - 34), glow=T.scale_color(color, 0.5))
        self._text(
            "NEON RUSH // OASIS RACING PROTOCOL",
            16,
            T.scale_color(T.WHITE, 0.7),
            (cx, cy + 22),
            bold=False,
        )
        self._text(
            f"CÁMARA ORBITAL → CHASE  {int(t * 100):3d}%",
            13,
            T.CYAN,
            (cx, HEIGHT - 54),
            bold=False,
        )

        bar = pygame.Rect(cx - 260, HEIGHT - 38, 520, 8)
        pygame.draw.rect(self.screen, (8, 16, 30), bar, border_radius=4)
        for index in range(40):
            fraction = (index + 1) / 40
            if fraction <= t:
                pygame.draw.rect(
                    self.screen,
                    T.gradient_color(index / 40),
                    (
                        int(bar.x + index * bar.width / 40),
                        bar.y,
                        max(2, int(bar.width / 40) - 2),
                        bar.height,
                    ),
                    border_radius=2,
                )

    def _draw_hologram_avatar(
        self,
        center: tuple[int, int],
        accent: tuple[int, int, int],
        *,
        outfit_color: tuple[int, int, int] | None = None,
        label: str = "ORACLE-9",
    ) -> None:
        cx, cy = center
        pulse = 0.5 + 0.5 * math.sin(self.time * 3.4)
        for index in range(3):
            radius = 96 + index * 20 + int(pulse * 5)
            pygame.draw.circle(
                self.screen,
                T.scale_color(accent, 0.18 + index * 0.08),
                (cx, cy),
                radius,
                2,
            )
        for index in range(18):
            angle = self.time * 0.8 + index * math.tau / 18
            x = cx + int(math.cos(angle) * 132)
            y = cy + int(math.sin(angle) * 132)
            pygame.draw.circle(
                self.screen,
                T.scale_color(T.CYAN if index % 2 else accent, 0.5),
                (x, y),
                2,
            )
        head = pygame.Rect(cx - 46, cy - 70, 92, 104)
        pygame.draw.ellipse(self.screen, T.scale_color(accent, 0.18), head)
        pygame.draw.ellipse(self.screen, accent, head, 2)
        pygame.draw.rect(
            self.screen,
            T.scale_color(outfit_color or accent, 0.30),
            (cx - 66, cy + 34, 132, 70),
            border_radius=18,
        )
        pygame.draw.rect(
            self.screen,
            outfit_color or accent,
            (cx - 66, cy + 34, 132, 70),
            2,
            18,
        )
        for side in (-1, 1):
            eye_x = cx + side * 18
            pygame.draw.circle(
                self.screen,
                T.scale_color(T.WHITE, 0.85),
                (eye_x, cy - 24),
                6,
            )
            pygame.draw.circle(
                self.screen,
                T.CYAN,
                (eye_x, cy - 24),
                2,
            )
        pygame.draw.arc(
            self.screen,
            T.scale_color(T.MAGENTA, 0.8),
            (cx - 24, cy - 8, 48, 34),
            math.pi * 0.15,
            math.pi * 0.85,
            2,
        )
        self._text(label, 16, accent, (cx, cy + 132), glow=T.scale_color(accent, 0.3))
        self._text("GUÍA VIRTUAL DEL OASIS", 11, T.MUTED, (cx, cy + 154), bold=False)

    def _draw_tutorial(self) -> None:
        self._draw_base()
        title, body = TUTORIAL_PAGES[self.tutorial_index]
        self._text(
            "INICIALIZACIÓN DEL PILOTO",
            14,
            T.CYAN,
            (WIDTH // 2, 66),
            glow=T.scale_color(T.CYAN, 0.3),
        )
        self._text("ORACLE-9 // TUTORIAL", 38, T.WHITE, (WIDTH // 2, 108), glow=T.scale_color(T.MAGENTA, 0.35))
        self._draw_hologram_avatar((248, 370), T.CYAN)

        panel = pygame.Rect(512, 178, 664, 352)
        self._draw_panel(panel, T.MAGENTA)
        self._text(title, 30, T.CYAN, (panel.x + 34, panel.y + 38), anchor="topleft", glow=T.scale_color(T.CYAN, 0.3))
        lines = self._wrap(body, 19, panel.width - 68, bold=False)
        for index, line in enumerate(lines):
            self._text(
                line,
                19,
                T.WHITE,
                (panel.x + 34, panel.y + 92 + index * 30),
                anchor="topleft",
                bold=False,
            )
        dots_y = panel.bottom - 34
        for index in range(len(TUTORIAL_PAGES)):
            x = panel.x + 36 + index * 24
            color = T.CYAN if index == self.tutorial_index else T.scale_color(T.MUTED, 0.5)
            if index == self.tutorial_index:
                pygame.draw.circle(self.screen, color, (x, dots_y), 6)
            else:
                pygame.draw.circle(self.screen, color, (x, dots_y), 3)

        self._button(
            self._tutorial_next_rect(),
            "SIGUIENTE >" if self.tutorial_index < len(TUTORIAL_PAGES) - 1 else "ENTRAR AL OASIS",
            T.CYAN,
            selected=True,
            hotkey="ENTER",
        )
        self._button(
            self._tutorial_skip_rect(),
            "OMITIR / SALIR",
            T.MAGENTA,
            sub="DEL TUTORIAL · ESC",
        )
        self._text(
            f"{self.tutorial_index + 1}/{len(TUTORIAL_PAGES)}",
            14,
            T.MUTED,
            (WIDTH // 2, HEIGHT - 30),
            bold=False,
        )
        self._text(
            "BOT AVATAR ORACLE-9 // TUTORIAL HOLOGRÁFICO",
            11,
            T.scale_color(T.CYAN, 0.65),
            (38, HEIGHT - 30),
            anchor="topleft",
            bold=False,
        )

    def _draw_menu(self) -> None:
        self._draw_base()
        self._draw_economy_bar()
        self._text(
            "NEON RUSH",
            48,
            T.WHITE,
            (54, 70),
            anchor="topleft",
            glow=T.scale_color((255, 231, 173), 0.24),
        )
        self._text(
            "OASIS GRAND TOUR  /  HUB CENTRAL",
            15,
            (229, 232, 209),
            (58, 124),
            anchor="topleft",
            bold=False,
        )
        selected_label, selected_description = MAIN_MENU_ITEMS[self.main_menu_index][1:]
        focus = pygame.Rect(50, 222, 405, 214)
        self._draw_panel(focus, (223, 215, 173), alpha=202, radius=18)
        self._text(
            selected_label,
            26,
            (255, 238, 195),
            (focus.x + 24, focus.y + 28),
            anchor="topleft",
        )
        for line_index, line in enumerate(
            self._wrap(selected_description, 17, focus.width - 48, bold=False)
        ):
            self._text(
                line,
                17,
                (231, 237, 215),
                (focus.x + 24, focus.y + 76 + line_index * 26),
                anchor="topleft",
                bold=False,
            )
        self._text(
            f"CLASE DE CARRERA: {self.mode.name}",
            12,
            (193, 221, 193),
            (focus.x + 24, focus.bottom - 24),
            anchor="bottomleft",
            bold=False,
        )
        player_color = pygame.Color(self.car_color)
        self._draw_car_preview(
            pygame.Rect(500, 300, 290, 300),
            (player_color.r, player_color.g, player_color.b),
        )
        self._draw_hologram_avatar(
            (920, 420),
            (125, 221, 168),
            outfit_color=(84, 162, 108),
            label=self.loadout.character.name,
        )
        for index, rect in enumerate(self._main_menu_rects()):
            label = MAIN_MENU_ITEMS[index][1]
            selected = index == self.main_menu_index
            fill = (16, 52, 39) if selected else (19, 42, 37)
            pygame.draw.rect(self.screen, fill, rect, border_radius=15)
            pygame.draw.rect(
                self.screen,
                (190, 218, 172) if selected else (91, 135, 105),
                rect,
                2 if selected else 1,
                border_radius=15,
            )
            self._text(
                label,
                19,
                (255, 247, 224) if selected else (207, 220, 198),
                (rect.centerx, rect.y + 27),
            )
            hotkey = str(index + 1)
            self._text(
                f"{hotkey}  ·  {'ENTER' if selected else 'SELECT'}",
                10,
                (178, 205, 176),
                (rect.centerx, rect.bottom - 13),
                bold=False,
            )
        self._button(
            self._menu_tutorial_rect(),
            "T · TUTORIAL",
            (228, 213, 159),
            sub="",
        )
        self._text(
            f"{self.loadout.character.name}  ·  {self.loadout.vehicle.name}  ·  {self.loadout.power.name}",
            12,
            (230, 236, 218),
            (WIDTH - 32, 571),
            anchor="topright",
            bold=False,
        )
        self._text("A / D  NAVEGAR    ENTER  CONFIRMAR    M  CAMBIAR MODO", 11, (230, 236, 218), (WIDTH // 2, 600), bold=False)
        self._text("ESC · VOLVER", 11, (230, 236, 218), (WIDTH - 36, HEIGHT - 18), anchor="bottomright", bold=False)

    def _draw_economy_bar(self) -> None:
        rect = pygame.Rect(WIDTH - 520, 20, 492, 64)
        self._draw_panel(rect, (207, 218, 186), alpha=208, radius=14)
        values = (
            ("TROFEOS", self.profile.trophies, (255, 219, 131)),
            ("NEON COINS", self.profile.coins, (248, 202, 102)),
            ("NIVEL", self.profile.level, (117, 219, 235)),
        )
        for index, (label, amount, color) in enumerate(values):
            x = rect.x + 26 + index * 154
            self._text(label, 10, color, (x, rect.y + 14), anchor="topleft", bold=False)
            self._text(str(amount), 23, (250, 249, 235), (x, rect.y + 37), anchor="topleft")

    def _draw_championship_map(self) -> None:
        self._draw_base()
        self._draw_economy_bar()
        self._text("NEON CUP", 42, (250, 247, 230), (WIDTH // 2, 118), glow=(59, 115, 77))
        self._text("SELECCIONA UN DESTINO", 14, (224, 232, 211), (WIDTH // 2, 158), bold=False)
        for index, (level, rect) in enumerate(
            zip(CHAMPIONSHIP_LEVELS, self._championship_level_rects())
        ):
            track_id, title, description, required = level
            unlocked = self.profile.trophies >= required
            selected = index == self.championship_index
            accent = (125, 206, 145) if unlocked else (121, 127, 112)
            self._draw_panel(rect, accent, alpha=220 if selected else 188, radius=18)
            if selected:
                pygame.draw.rect(self.screen, (237, 229, 183), rect, 2, border_radius=18)
            track_colors = {
                "neon_city": (0, 204, 232),
                "cyber_desert": (223, 147, 66),
                "plasma_circuit": (167, 87, 255),
            }
            pygame.draw.rect(
                self.screen,
                track_colors[track_id],
                pygame.Rect(rect.x + 18, rect.y + 20, rect.width - 36, 112),
                border_radius=12,
            )
            self._text(title, 18, (251, 247, 226), (rect.centerx, rect.y + 162))
            for line_index, line in enumerate(
                self._wrap(description, 13, rect.width - 42, bold=False)
            ):
                self._text(
                    line,
                    13,
                    (226, 232, 213),
                    (rect.centerx, rect.y + 194 + line_index * 18),
                    bold=False,
                )
            badge = "DESBLOQUEADO" if unlocked else f"REQUIERE {required} TROFEOS"
            self._text(
                badge,
                11,
                (244, 224, 166) if unlocked else (208, 198, 180),
                (rect.centerx, rect.bottom - 24),
                bold=False,
            )
        if self.error:
            self._text(self.error, 13, (255, 215, 152), (WIDTH // 2, 565))
        self._text("A / D  DESTINO    ENTER  CORRER    ESC  MENÚ", 12, (235, 239, 221), (WIDTH // 2, 617), bold=False)

    def _draw_shop(self) -> None:
        self._draw_base()
        self._draw_economy_bar()
        self._text("TIENDA DEL OASIS", 42, (250, 247, 230), (WIDTH // 2, 118))
        for index, (item, rect) in enumerate(zip(SHOP_ITEMS, self._shop_item_rects())):
            item_id, title, color, _, price = item
            owned = item_id in self.profile.owned_cosmetics
            selected = index == self.shop_index
            accent = pygame.Color(color)
            accent_tuple = (accent.r, accent.g, accent.b)
            self._draw_panel(rect, accent_tuple, alpha=220 if selected else 188, radius=18)
            if selected:
                pygame.draw.rect(self.screen, (243, 232, 192), rect, 2, border_radius=18)
            pygame.draw.rect(
                self.screen,
                accent_tuple,
                pygame.Rect(rect.centerx - 55, rect.y + 42, 110, 110),
                border_radius=22,
            )
            self._text(title, 19, (250, 247, 230), (rect.centerx, rect.y + 190))
            status = "ADQUIRIDO · EQUIPAR" if owned else f"{price} NC"
            self._text(status, 14, (238, 223, 177), (rect.centerx, rect.y + 235), bold=False)
        if self.error:
            self._text(self.error, 13, (255, 215, 152), (WIDTH // 2, 580))
        self._text("A / D  ARTÍCULO    ENTER  COMPRAR / EQUIPAR    ESC  MENÚ", 12, (235, 239, 221), (WIDTH // 2, 617), bold=False)

    def _draw_challenges(self) -> None:
        self._draw_base()
        self._draw_economy_bar()
        daily = self.profile.ensure_daily_missions()
        self._text("DESAFÍOS Y NEON CUP", 40, (250, 247, 230), (WIDTH // 2, 112))
        self._text(
            f"MISIONES UTC · {daily.get('date', '---')} · Reinicio 00:00 UTC",
            13,
            (117, 219, 235),
            (WIDTH // 2, 151),
            bold=False,
        )
        for index, mission in enumerate(daily.get("missions", [])[:3]):
            rect = pygame.Rect(118, 178 + index * 75, 590, 62)
            self._draw_panel(rect, (117, 219, 235), alpha=190, radius=12)
            complete = mission.get("status") == "completed"
            self._text(
                str(mission.get("description", "Misión")),
                16,
                (182, 255, 138) if complete else (250, 247, 230),
                (rect.x + 18, rect.y + 13),
                anchor="topleft",
            )
            progress = int(mission.get("progress", 0))
            target = max(1, int(mission.get("target", 1)))
            self._text(
                f"{progress}/{target} · +{mission.get('reward', 0)} NC",
                12,
                (248, 202, 102),
                (rect.right - 18, rect.y + 38),
                anchor="topright",
                bold=False,
            )

        cup = self.profile.championship
        panel = pygame.Rect(738, 178, 424, 287)
        self._draw_panel(panel, (255, 179, 44), alpha=190, radius=16)
        self._text("NEON CUP", 22, (255, 219, 131), (panel.centerx, panel.y + 28))
        status = str(cup.get("status", "not_started")).replace("_", " ").upper()
        self._text(
            f"ESTADO: {status} · CARRERAS {cup.get('completed_races', 0)}/3",
            12,
            (235, 239, 221),
            (panel.centerx, panel.y + 59),
            bold=False,
        )
        tracks = cup.get("tracks", {})
        for index, track_key in enumerate(("neon_city", "cyber_desert", "plasma_circuit")):
            data = tracks.get(track_key, {})
            y = panel.y + 96 + index * 36
            text = f"{track_key.replace('_', ' ').upper()} · {str(data.get('result_id', 'PENDIENTE'))[:12]}"
            self._text(
                text,
                11,
                (182, 255, 138) if data else (164, 174, 178),
                (panel.x + 20, y),
                anchor="topleft",
                bold=False,
            )
        standings = sorted(
            cup.get("standings", {}).items(),
            key=lambda item: -int(item[1].get("points", 0)),
        )
        for index, (participant, standing) in enumerate(standings[:2]):
            self._text(
                f"{standing.get('name', participant)}  {standing.get('points', 0)} PTS",
                13,
                (250, 247, 230),
                (panel.x + 20, panel.y + 214 + index * 22),
                anchor="topleft",
                bold=False,
            )
        self._text(
            f"RÉCORD: {self.profile.best_lap or '--'} s · VICTORIAS: {self.profile.wins} · NIVEL: {self.profile.level}",
            12,
            (230, 236, 218),
            (WIDTH // 2, 516),
            bold=False,
        )
        self._button(self._challenges_back_rect(), "VOLVER AL MENÚ", (228, 213, 159))

    def _draw_car_preview(self, rect: pygame.Rect, accent: tuple[int, int, int]) -> None:
        cx, cy = rect.centerx, rect.centery + 18
        pulse = 0.5 + 0.5 * math.sin(self.time * 2.8)
        for index in range(3):
            pygame.draw.ellipse(
                self.screen,
                T.scale_color(accent, 0.10 + index * 0.05),
                (cx - 120 - index * 18, cy - 66 - index * 10, 240 + index * 36, 132 + index * 20),
            )
        length, width = 230, 48
        points = [
            (cx, cy - length * 0.62),
            (cx + width, cy - length * 0.16),
            (cx + width * 0.8, cy + length * 0.48),
            (cx, cy + length * 0.6),
            (cx - width * 0.8, cy + length * 0.48),
            (cx - width, cy - length * 0.16),
        ]
        pygame.draw.polygon(self.screen, T.scale_color(accent, 0.18), points)
        pygame.draw.polygon(self.screen, accent, points, 2)
        cockpit = [
            (cx, cy - length * 0.30),
            (cx + width * 0.55, cy + length * 0.06),
            (cx, cy + length * 0.30),
            (cx - width * 0.55, cy + length * 0.06),
        ]
        pygame.draw.polygon(self.screen, T.scale_color(accent, 0.45), cockpit)
        pygame.draw.polygon(self.screen, T.scale_color(T.WHITE, 0.55), cockpit, 1)
        pygame.draw.line(
            self.screen,
            T.scale_color(accent, 0.8 + pulse * 0.2),
            (cx - width * 0.72, cy + length * 0.5),
            (cx + width * 0.72, cy + length * 0.5),
            5,
        )
        pygame.draw.circle(self.screen, T.WHITE, (cx, cy - length * 0.54), 4)
        self._text(self.loadout.vehicle.name, 24, accent, (cx, rect.y + rect.height - 24), glow=T.scale_color(accent, 0.35))

    def _draw_garage(self) -> None:
        self._draw_base()
        self._draw_economy_bar()
        accent = pygame.Color(self.loadout.accent)
        accent_tuple = (accent.r, accent.g, accent.b)
        player_color = pygame.Color(self.car_color)
        player_tuple = (player_color.r, player_color.g, player_color.b)
        outfit = pygame.Color(self.outfit_color)
        outfit_tuple = (outfit.r, outfit.g, outfit.b)
        self._text("GARAJE DEL OASIS", 42, T.WHITE, (60, 62), anchor="topleft", glow=T.scale_color(accent_tuple, 0.4))
        self._text(
            f"{self.mode.name}  ·  {self.mode.subtitle}",
            15,
            accent_tuple,
            (62, 112),
            anchor="topleft",
            bold=False,
        )

        preview = pygame.Rect(36, 146, 548, 510)
        self._draw_panel(preview, player_tuple, alpha=190)
        self._draw_car_preview(
            pygame.Rect(preview.x + 8, preview.y + 24, 280, 390),
            player_tuple,
        )
        self._draw_hologram_avatar(
            (preview.x + 404, preview.y + 225),
            accent_tuple,
            outfit_color=outfit_tuple,
            label=self.loadout.character.name,
        )
        self._text(
            "PILOTO Y VEHÍCULO · VISTA SUPERIOR",
            12,
            T.MUTED,
            (preview.x + 20, preview.y + 18),
            anchor="topleft",
            bold=False,
        )
        self._text(
            f"{self.loadout.vehicle.name}  ·  {self.loadout.vehicle.class_name}",
            14,
            player_tuple,
            (preview.x + 20, preview.bottom - 50),
            anchor="bottomleft",
            bold=False,
        )
        self._text(
            f"{self.loadout.character.name}  ·  {self.loadout.power.name}",
            15,
            T.WHITE,
            (preview.x + 20, preview.bottom - 24),
            anchor="bottomleft",
            glow=T.scale_color(accent_tuple, 0.35),
        )

        self._draw_stats(pygame.Rect(preview.x + 20, preview.y + 432, 500, 18))
        self._draw_panel(
            pygame.Rect(620, 146, 624, 498),
            accent_tuple,
            alpha=232,
        )
        self._text(
            "PERSONALIZACIÓN",
            22,
            T.WHITE,
            (642, 156),
            anchor="topleft",
            glow=T.scale_color(accent_tuple, 0.32),
        )
        self._text(
            "CAMBIOS INSTANTÁNEOS · GUARDA AUTOMÁTICA",
            11,
            T.MUTED,
            (644, 180),
            anchor="topleft",
            bold=False,
        )

        styles = ("NEON", "SYNTH", "CODE", "VOID")
        labels = (
            "AVATAR",
            "VEHÍCULO",
            "PODER BASE",
            "COLOR DE CARROCERÍA",
            "VESTIMENTA",
            "DISEÑO DE PISTA",
            "DISEÑO DE RINES",
        )
        paint_value = (
            f"#{self.hex_buffer}" if self.hex_editing and self.garage_row == 3 else self.car_color.upper()
        )
        outfit_value = (
            f"#{self.hex_buffer}" if self.hex_editing and self.garage_row == 4 else self.outfit_color.upper()
        )
        selections = (
            self.loadout.character.name,
            f"{self.loadout.vehicle.name} · {self.loadout.vehicle.class_name}",
            f"{self.loadout.power.name} · {self.loadout.power.glyph}",
            paint_value,
            outfit_value,
            styles[self.garage_indices["track_style"]],
            self.rim_style.upper(),
        )
        for row, (label, selected) in enumerate(zip(labels, selections)):
            rect = self._garage_row_rects()[row]
            active = row == self.garage_row
            self._draw_panel(
                rect,
                accent_tuple if active else T.MUTED,
                alpha=238 if active else 205,
                radius=8,
            )
            if active:
                pygame.draw.rect(
                    self.screen,
                    (*accent_tuple, 255),
                    rect,
                    2,
                    border_radius=8,
                )
            self._text(
                label,
                10,
                accent_tuple if active else T.MUTED,
                (rect.x + 54, rect.y + 7),
                anchor="topleft",
                bold=False,
            )
            self._text(
                selected,
                19,
                T.WHITE,
                (rect.x + 54, rect.y + 26),
                anchor="topleft",
                glow=T.scale_color(accent_tuple, 0.28) if active else None,
            )
            left, right = self._garage_arrows(row)
            for arrow_rect, glyph in ((left, "<"), (right, ">")):
                pygame.draw.rect(
                    self.screen,
                    T.scale_color(accent_tuple, 0.22),
                    arrow_rect,
                    border_radius=8,
                )
                pygame.draw.rect(
                    self.screen,
                    T.scale_color(accent_tuple, 0.7),
                    arrow_rect,
                    1,
                    8,
                )
                self._text(glyph, 20, T.WHITE, arrow_rect.center)

        self._text(
            "↑ ↓ NAVEGAR    ← → CAMBIAR    E EDITAR HEX    ENTER CONFIRMAR",
            11,
            T.MUTED,
            (644, 602),
            anchor="topleft",
            bold=False,
        )

        self._button(self._garage_back_rect(), "< VOLVER", T.MAGENTA, sub="ESC")
        self._button(
            self._garage_ready_rect(),
            "LISTO · CORRER",
            T.CYAN,
            selected=True,
            sub="ENTER · INICIAR CARRERA",
        )

    def _draw_stats(self, rect: pygame.Rect) -> None:
        physics = self.loadout.physics()
        values = (
            ("VELOCIDAD", (physics.max_speed - 320) / (680 - 320)),
            ("ACELERACIÓN", (physics.engine_accel - 180) / (480 - 180)),
            ("AGARRE", (physics.turn_rate - 1.6) / (4.2 - 1.6)),
            ("FRENADA", (physics.brake_decel - 420) / (820 - 420)),
        )
        segment_width = rect.width / 4
        for index, (label, ratio) in enumerate(values):
            x = rect.x + index * segment_width
            self._text(label, 10, T.MUTED, (int(x), rect.y - 2), anchor="bottomleft", bold=False)
            bar = pygame.Rect(int(x), rect.y + 6, int(segment_width - 26), 8)
            pygame.draw.rect(self.screen, (10, 20, 34), bar, border_radius=4)
            fill = max(0.03, min(1.0, ratio))
            color = T.gradient_color(index / 4 + fill * 0.2)
            pygame.draw.rect(
                self.screen,
                color,
                (bar.x, bar.y, int(bar.w * fill), bar.h),
                border_radius=4,
            )

    def _draw_loading(self) -> None:
        self._draw_base()
        self._text("INICIALIZANDO OASIS", 46, T.WHITE, (WIDTH // 2, 112), glow=T.scale_color(T.CYAN, 0.5))
        self._text(
            f"{self.mode.name}  ·  {self.loadout.character.name}  ·  {self.loadout.vehicle.name}",
            15,
            T.MAGENTA,
            (WIDTH // 2, 156),
        )

        panel = pygame.Rect(190, 204, 900, 342)
        self._draw_panel(panel, T.CYAN)
        stages = (
            (0.00, "Conectando al servidor Master..."),
            (0.20, "Sincronizando geometría del circuito..."),
            (0.42, "Cargando vehículos y hologramas..."),
            (0.63, "Entrenando piloto IA ORACLE-9..."),
            (0.82, "Compilando shaders synthwave..."),
            (0.97, "Abriendo portal al OASIS..."),
        )
        message = stages[0][1]
        for threshold, text in stages:
            if self._loading_progress >= threshold:
                message = text
        self._text(message, 24, T.CYAN, (panel.centerx, panel.y + 58), glow=T.scale_color(T.CYAN, 0.35))

        bar = pygame.Rect(panel.x + 54, panel.y + 116, panel.width - 108, 22)
        pygame.draw.rect(self.screen, (6, 14, 28), bar, border_radius=8)
        segments = 50
        seg_width = bar.width / segments
        for index in range(segments):
            fraction = (index + 1) / segments
            if fraction <= self._loading_progress:
                color = T.gradient_color(index / segments)
                pygame.draw.rect(
                    self.screen,
                    color,
                    (
                        int(bar.x + index * seg_width),
                        bar.y,
                        max(2, int(seg_width - 2)),
                        bar.height,
                    ),
                    border_radius=3,
                )
        pygame.draw.rect(self.screen, T.scale_color(T.CYAN, 0.6), bar, 1, 8)
        self._text(
            f"{int(self._loading_progress * 100):3d}%",
            28,
            T.WHITE,
            (bar.centerx, bar.bottom + 34),
            glow=T.scale_color(T.MAGENTA, 0.3),
        )

        manager = self._loading_manager
        statuses = manager.status_snapshot() if manager else {}
        if self.mode.distributed:
            statuses["master-handshake"] = self._network_status
        labels = {
            "master-handshake": "MASTER HANDSHAKE",
            "oasis-shaders": "OASIS SHADERS",
            "synthwave-audio": "SYNTHWAVE AUDIO",
            "hologram-fonts": "HOLOGRAM FONTS",
            "vehicle-skins": "VEHICLE SKINS",
            "track-geometry": "TRACK GEOMETRY",
            "ai-pilot": "AI PILOT",
        }
        for index, (name, label) in enumerate(labels.items()):
            column = index // 4
            row = index % 4
            x = panel.x + 58 + column * 420
            y = panel.y + 184 + row * 26
            state = statuses.get(name, "pending")
            color = {
                "ready": T.LIME,
                "loading": T.CYAN,
                "failed": T.RED,
                "pending": T.MUTED,
            }.get(state, T.MUTED)
            glyph = "[OK]" if state == "ready" else "[..]" if state == "loading" else "[  ]"
            self._text(glyph, 12, color, (x, y), anchor="topleft", bold=False)
            self._text(f"{label:<20}", 12, T.WHITE if state == "ready" else T.MUTED, (x + 42, y), anchor="topleft", bold=False)
            if state == "loading":
                shimmer = 0.4 + 0.6 * (0.5 + 0.5 * math.sin(self.time * 9 + index))
                pygame.draw.line(
                    self.screen,
                    T.scale_color(T.CYAN, shimmer),
                    (x + 42, y + 13),
                    (x + 42 + int(180 * shimmer), y + 13),
                    1,
                )

        self._button(self._loading_cancel_rect(), "CANCELAR (ESC)", T.MAGENTA)
        self._text(
            "THREADPOOLEXECUTOR · CARGA PARALELA DE ASSETS",
            12,
            T.MUTED,
            (WIDTH // 2, 660),
            bold=False,
        )

    def _draw_results(self) -> None:
        self._draw_base()
        self._text("CARRERA FINALIZADA", 48, T.WHITE, (WIDTH // 2, 92), glow=T.scale_color(T.MAGENTA, 0.45))
        self._text(
            f"{self.mode.name}  ·  {self.mode.subtitle}",
            15,
            T.CYAN,
            (WIDTH // 2, 138),
            bold=False,
        )
        if self.results:
            winner = self.results[0]
            self._text(
                f"GANADOR: {winner.get('name', '---')}",
                30,
                T.LIME,
                (WIDTH // 2, 194),
                glow=T.scale_color(T.LIME, 0.35),
            )
            panel = pygame.Rect(270, 226, 740, 316)
            self._draw_panel(panel, T.CYAN)
            for index, result in enumerate(self.results[:4]):
                y = panel.y + 34 + index * 66
                accent = pygame.Color(result.get("color", "#00e5ff"))
                accent_tuple = (accent.r, accent.g, accent.b)
                pygame.draw.rect(
                    self.screen,
                    T.scale_color(accent_tuple, 0.15),
                    (panel.x + 28, y, panel.width - 56, 50),
                    border_radius=9,
                )
                pygame.draw.rect(
                    self.screen,
                    T.scale_color(accent_tuple, 0.6),
                    (panel.x + 28, y, panel.width - 56, 50),
                    1,
                    9,
                )
                placement = int(result.get("placement", index + 1))
                self._text(
                    f"P{placement}",
                    28,
                    T.WHITE,
                    (panel.x + 60, y + 25),
                    glow=T.scale_color(accent_tuple, 0.35),
                )
                self._text(
                    str(result.get("name", "PILOTO")),
                    20,
                    accent_tuple,
                    (panel.x + 122, y + 14),
                    anchor="topleft",
                )
                status = "FIN" if result.get("finished") else "DNF"
                time_text = result.get("finish_time")
                time_text = f"{time_text:.3f}s" if isinstance(time_text, (int, float)) else "---"
                best = result.get("best_lap")
                best_text = f"{best:.3f}s" if isinstance(best, (int, float)) else "---"
                self._text(
                    f"{status}  ·  TOTAL {time_text}  ·  MEJOR {best_text}",
                    14,
                    T.MUTED,
                    (panel.x + 122, y + 34),
                    anchor="topleft",
                    bold=False,
                )
                if self.mode.championship:
                    points = {1: 15, 2: 12, 3: 10, 4: 8}.get(placement, 0)
                else:
                    points = 10 if placement == 1 else 5 if placement == 2 else 2
                if not result.get("finished"):
                    points = 0
                nc = (
                    ({1: 500, 2: 300, 3: 200, 4: 100}.get(placement, 0) + 100)
                    if result.get("finished")
                    else 0
                )
                self._text(
                    f"+{points} PTS · +{nc} NC",
                    16,
                    T.LIME,
                    (panel.right - 54, y + 25),
                    anchor="center",
                    bold=False,
                )
        else:
            self._text(
                "SIN TELEMETRÍA: LA CARRERA SE CANCELÓ O SE PERDIÓ LA CONEXIÓN.",
                18,
                T.RED,
                (WIDTH // 2, 330),
            )
        self._button(self._results_again_rect(), "REVANCHA", T.CYAN, selected=True, hotkey="R")
        self._button(self._results_menu_rect(), "VOLVER AL MENÚ", T.MAGENTA, hotkey="M")
        self._text(
            f"PERFIL: {self.profile.wins}W / {self.profile.races} carreras  ·  {self.profile.points} pts",
            13,
            T.MUTED,
            (WIDTH // 2, 674),
            bold=False,
        )


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def run_neon_app(
    *,
    asset_delay: float = 0.8,
    enable_audio: bool = True,
    skip_tutorial: bool = False,
    mode_id: str | None = None,
    autostart: bool = False,
    logger: logging.Logger | None = None,
) -> int:
    app = NeonApp(
        asset_delay=asset_delay,
        enable_audio=enable_audio,
        skip_tutorial=skip_tutorial,
        mode_id=mode_id,
        autostart=autostart,
        logger=logger,
    )
    return app.run()
