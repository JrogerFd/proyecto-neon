"""Orthographic top-down Pygame renderer for the flat NEON RUSH circuit."""

from __future__ import annotations

import math
import os
import sys
import time
from typing import Any

import pygame

from ..physics import VehicleInput
from ..track import Track
from . import theme as T
from .base import Renderer
from .hud import NFSHud, compute_positions


class _Camera:
    __slots__ = ("origin_x", "origin_y", "center_x", "center_y", "cos", "sin", "scale")

    def __init__(
        self, vehicle: dict[str, Any], rect: pygame.Rect, scale: float
    ) -> None:
        heading = float(vehicle.get("heading", 0.0))
        self.origin_x = float(vehicle.get("x", 0.0))
        self.origin_y = float(vehicle.get("y", 0.0))
        self.center_x = float(rect.centerx)
        self.center_y = float(rect.centery + rect.height * 0.12)
        rotation = -math.pi * 0.5 - heading
        self.cos = math.cos(rotation)
        self.sin = math.sin(rotation)
        self.scale = scale

    def project(self, x: float, y: float) -> tuple[int, int]:
        dx, dy = x - self.origin_x, y - self.origin_y
        return (
            int(self.center_x + (self.cos * dx - self.sin * dy) * self.scale),
            int(self.center_y + (self.sin * dx + self.cos * dy) * self.scale),
        )


class PygameRenderer(Renderer):
    supports_keyboard = True
    WIDTH = 1280
    HEIGHT = 720

    def __init__(
        self,
        track: Track,
        title: str = "NEON RUSH",
        screen: pygame.Surface | None = None,
        interactive_tutorial: bool = False,
    ) -> None:
        super().__init__(track, title)
        self._owns_display = screen is None
        driver = os.environ.get("SDL_VIDEODRIVER", "").lower()
        headless = driver in {"dummy", "offscreen"}
        if sys.platform.startswith("linux") and not (
            os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY") or headless
        ):
            raise RuntimeError(
                "No hay DISPLAY/WAYLAND_DISPLAY; usá --render console o --render none."
            )
        pygame.init()
        pygame.display.set_caption(title)
        if screen is None:
            flags = pygame.DOUBLEBUF if driver != "dummy" else 0
            self.screen = pygame.display.set_mode((self.WIDTH, self.HEIGHT), flags)
        else:
            self.screen = screen
        self.hud = NFSHud(track, title)
        self.font_tiny = T.make_font(pygame, 12)
        self.font_small = T.make_font(pygame, 16)
        self.font_large = T.make_font(pygame, 30)
        self.font_title = T.make_font(pygame, 74)
        palette_style = {
            "neon_city": "neon",
            "cyber_desert": "void",
            "plasma_circuit": "code",
        }.get(track.style, track.style)
        self.palette = T.track_palette(palette_style)
        self._last_frame = time.monotonic()
        self._p1_power_down = False
        self._p2_power_down = False
        self._live_tutorial_active = interactive_tutorial
        self._live_tutorial_elapsed = 0.0
        self._live_tutorial_completed = [False, False, False, False]
        self._track_samples = self._build_track_samples()

    @property
    def camera_mode(self) -> str:
        return "TOP-DOWN"

    def _build_track_samples(
        self,
    ) -> list[tuple[float, float, float, float, float, float]]:
        samples = []
        for index in range(384):
            progress = index / 384
            x, y = self.track.point_at(progress)
            heading = self.track.heading_at(progress)
            nx, ny = -math.sin(heading), math.cos(heading)
            half_width = self.track.width * 0.5
            samples.append(
                (
                    x,
                    y,
                    x + nx * half_width,
                    y + ny * half_width,
                    x - nx * half_width,
                    y - ny * half_width,
                )
            )
        return samples

    def poll_inputs(self, snapshot: dict[str, Any] | None) -> list[VehicleInput]:
        _ = snapshot
        self._pump_events()
        keys = pygame.key.get_pressed()
        p1_power = bool(keys[pygame.K_e]) and not self._p1_power_down
        p2_power = bool(keys[pygame.K_RSHIFT]) and not self._p2_power_down
        self._p1_power_down = bool(keys[pygame.K_e])
        self._p2_power_down = bool(keys[pygame.K_RSHIFT])
        p1 = VehicleInput(
            1.0 if keys[pygame.K_w] else 0.0,
            1.0 if keys[pygame.K_s] else 0.0,
            float(bool(keys[pygame.K_d])) - float(bool(keys[pygame.K_a])),
            turbo=bool(keys[pygame.K_SPACE]),
            use_power=p1_power,
        )
        p2 = VehicleInput(
            1.0 if keys[pygame.K_UP] else 0.0,
            1.0 if keys[pygame.K_DOWN] else 0.0,
            float(bool(keys[pygame.K_RIGHT])) - float(bool(keys[pygame.K_LEFT])),
            turbo=bool(keys[pygame.K_RCTRL]),
            use_power=p2_power,
        )
        return [p1, p2]

    def _pump_events(self) -> None:
        for event in pygame.event.get():
            if event.type == pygame.QUIT or (
                event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE
            ):
                self._closed = True

    def draw_lobby(
        self, message: str, progress: float | None = None, detail: str = ""
    ) -> None:
        self._pump_events()
        self.screen.fill((5, 9, 20))
        center = (self.WIDTH // 2, self.HEIGHT // 2 - 35)
        pygame.draw.circle(self.screen, T.CYAN, center, 126, 2)
        pygame.draw.circle(self.screen, T.MAGENTA, center, 150, 1)
        title = T.render_glow_text(
            pygame, self.font_title, "NEON RUSH", T.CYAN, T.scale_color(T.CYAN, 0.45)
        )
        self.screen.blit(title, title.get_rect(center=(center[0], center[1] - 95)))
        status_text = message if progress is not None else message + "." * (int(time.monotonic() * 3) % 4)
        status = self.font_large.render(status_text, True, T.WHITE)
        self.screen.blit(status, status.get_rect(center=(center[0], center[1] + 175)))
        if detail:
            line = self.font_small.render(detail, True, T.MUTED)
            self.screen.blit(line, line.get_rect(center=(center[0], center[1] + 207)))
        if progress is not None:
            bar = pygame.Rect(center[0] - 250, center[1] + 235, 500, 10)
            pygame.draw.rect(self.screen, (20, 30, 45), bar, border_radius=4)
            pygame.draw.rect(
                self.screen, T.CYAN,
                (bar.x, bar.y, int(bar.width * max(0.0, min(1.0, progress))), bar.height),
                border_radius=4,
            )
        pygame.display.flip()

    def draw(self, snapshot: dict[str, Any], focus_ids: list[int]) -> None:
        now = time.monotonic()
        dt = min(0.05, max(0.0, now - self._last_frame))
        self._last_frame = now
        focused = [int(player_id) for player_id in focus_ids]
        half = self.HEIGHT // 2
        if len(focused) > 1:
            rects = [pygame.Rect(0, 0, self.WIDTH, half),
                     pygame.Rect(0, half, self.WIDTH, self.HEIGHT - half)]
        else:
            rects = [pygame.Rect(0, 0, self.WIDTH, self.HEIGHT)]
        vehicles = {
            int(vehicle["id"]): vehicle for vehicle in snapshot.get("vehicles", [])
        }
        positions = compute_positions(snapshot)
        for rect, player_id in zip(rects, focused):
            vehicle = vehicles.get(player_id)
            if vehicle is None:
                continue
            self._draw_view(rect, snapshot, vehicle)
            color = pygame.Color(vehicle.get("color", T.PLAYER_FALLBACK))
            self.hud.draw(
                self.screen, rect, snapshot, vehicle,
                positions.get(player_id, 1), len(vehicles),
                (color.r, color.g, color.b),
            )
        if len(rects) > 1:
            pygame.draw.line(self.screen, T.CYAN, (0, half), (self.WIDTH, half), 2)
        if focused and focused[0] in vehicles:
            self._draw_live_tutorial(vehicles[focused[0]], dt)
        pygame.display.flip()

    def _draw_view(
        self, rect: pygame.Rect, snapshot: dict[str, Any], focus: dict[str, Any]
    ) -> None:
        self.screen.set_clip(rect)
        self.screen.fill(self.palette["background"], rect)
        speed = abs(float(focus.get("speed", 0.0)))
        max_speed = float(snapshot.get("max_speed", 520.0) or 520.0)
        speed_ratio = min(1.0, speed / max_speed)
        scale = max(0.62, min(1.05, rect.height / 590.0)) * (1.0 - 0.12 * speed_ratio)
        camera = _Camera(focus, rect, scale)
        outer = [camera.project(x0, y0) for _, _, x0, y0, _, _ in self._track_samples]
        inner = [camera.project(x1, y1) for _, _, _, _, x1, y1 in self._track_samples]
        pygame.draw.lines(
            self.screen, self.palette["edge_outer"], True, outer, max(3, int(scale * 10))
        )
        pygame.draw.lines(
            self.screen, self.palette["edge_inner"], True, inner, max(3, int(scale * 10))
        )
        center_points = [
            camera.project(x, y) for x, y, _, _, _, _ in self._track_samples
        ]
        road_width = max(8, int(self.track.width * scale))
        pygame.draw.lines(self.screen, (5, 8, 15), True, center_points, road_width + 8)
        pygame.draw.lines(
            self.screen, self.palette["asphalt"], True, center_points, road_width
        )
        for index in range(0, len(center_points), 12):
            pygame.draw.circle(
                self.screen,
                self.palette["asphalt_light"],
                center_points[index],
                max(1, int(scale)),
            )
        self._draw_start_line(camera)
        for vehicle in snapshot.get("vehicles", []):
            if not vehicle.get("connected", True):
                continue
            self._draw_car(camera, vehicle, int(vehicle.get("id", -1)) == int(focus["id"]))
        self.screen.set_clip(None)

    def _draw_start_line(self, camera: _Camera) -> None:
        x, y = self.track.point_at(0.0)
        heading = self.track.heading_at(0.0)
        nx, ny = -math.sin(heading), math.cos(heading)
        half_width = self.track.width * 0.5
        start = camera.project(x - nx * half_width, y - ny * half_width)
        end = camera.project(x + nx * half_width, y + ny * half_width)
        pygame.draw.line(
            self.screen, T.WHITE, start, end, max(2, int(camera.scale * 3))
        )

    def _draw_car(
        self, camera: _Camera, vehicle: dict[str, Any], focused: bool
    ) -> None:
        x, y = float(vehicle["x"]), float(vehicle["y"])
        heading = float(vehicle.get("heading", 0.0))
        forward = (math.cos(heading), math.sin(heading))
        side = (-forward[1], forward[0])
        length, width = 25.0, 11.0
        corners = [
            (x + forward[0] * length * 0.62 + side[0] * width * 0.5,
             y + forward[1] * length * 0.62 + side[1] * width * 0.5),
            (x + forward[0] * length * 0.62 - side[0] * width * 0.5,
             y + forward[1] * length * 0.62 - side[1] * width * 0.5),
            (x - forward[0] * length * 0.38 - side[0] * width * 0.5,
             y - forward[1] * length * 0.38 - side[1] * width * 0.5),
            (x - forward[0] * length * 0.38 + side[0] * width * 0.5,
             y - forward[1] * length * 0.38 + side[1] * width * 0.5),
        ]
        points = [camera.project(px, py) for px, py in corners]
        color = pygame.Color(vehicle.get("color", T.PLAYER_FALLBACK))
        pygame.draw.polygon(self.screen, (color.r, color.g, color.b), points)
        pygame.draw.polygon(self.screen, T.WHITE if focused else (12, 18, 27), points, 1)
        if not focused:
            label = self.font_tiny.render(str(vehicle.get("name", "RIVAL")), True, T.WHITE)
            px, py = camera.project(x, y)
            self.screen.blit(label, label.get_rect(center=(px, py - int(18 * camera.scale))))

    def _draw_live_tutorial(
        self, vehicle: dict[str, Any], dt: float
    ) -> None:
        if not self._live_tutorial_active:
            return
        self._live_tutorial_elapsed += dt
        self._live_tutorial_completed[0] |= float(vehicle.get("throttle", 0.0)) > 0.2
        self._live_tutorial_completed[1] |= abs(float(vehicle.get("steer", 0.0))) > 0.25
        self._live_tutorial_completed[2] |= not bool(vehicle.get("off_track"))
        self._live_tutorial_completed[3] |= bool(
            vehicle.get("turbo_active") or vehicle.get("shield") or vehicle.get("warp_active")
        )
        if all(self._live_tutorial_completed) or self._live_tutorial_elapsed >= 45.0:
            self._live_tutorial_active = False
            return
        steps = (
            ("ACELERA", "W", "Siente la respuesta del vehículo."),
            ("TRAZA UNA CURVA", "A / D", "Sigue el trazado fijo del circuito."),
            ("MANTENTE EN PISTA", "BORDES", "Los límites laterales reducen tu velocidad."),
            ("USA EL TURBO", "ESPACIO", "Administra la carga durante la vuelta."),
        )
        index = self._live_tutorial_completed.index(False)
        title, key_hint, description = steps[index]
        panel = pygame.Rect(24, 114, 378, 104)
        pygame.draw.rect(self.screen, (8, 24, 23), panel, border_radius=12)
        pygame.draw.rect(self.screen, (154, 204, 157), panel, 1, border_radius=12)
        self.screen.blit(
            self.font_small.render(f"{title} · {key_hint}", True, (255, 242, 207)),
            (panel.x + 14, panel.y + 20),
        )
        self.screen.blit(
            self.font_tiny.render(description, True, (218, 228, 213)),
            (panel.x + 14, panel.y + 54),
        )

    def draw_countdown(self, value: str) -> None:
        panel = pygame.Rect(self.WIDTH // 2 - 118, 88, 236, 84)
        pygame.draw.rect(self.screen, (2, 8, 18), panel, border_radius=14)
        pygame.draw.rect(self.screen, T.CYAN, panel, 1, border_radius=14)
        label = self.font_large.render(value, True, T.WHITE)
        self.screen.blit(label, label.get_rect(center=panel.center))
        pygame.display.flip()

    def close(self) -> None:
        self._closed = True
        if self._owns_display:
            pygame.display.quit()
