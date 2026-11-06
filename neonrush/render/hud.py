"""HUD arcade estilo Need for Speed para el renderer Pygame."""

from __future__ import annotations

import math
from typing import Any

import pygame

from ..config import PhysicsConfig
from ..track import Track
from . import theme as T


def format_time(seconds: float | None) -> str:
    if seconds is None:
        return "--:--.---"
    minutes = int(seconds // 60)
    remainder = max(0.0, seconds - minutes * 60)
    return f"{minutes}:{remainder:06.3f}"


def compute_positions(snapshot: dict[str, Any]) -> dict[int, int]:
    vehicles = [v for v in snapshot.get("vehicles", []) if v.get("connected", True)]
    finished = sorted(
        (v for v in vehicles if v.get("finished")),
        key=lambda v: v.get("finish_time")
        if v.get("finish_time") is not None
        else float("inf"),
    )
    racing = sorted(
        (v for v in vehicles if not v.get("finished")),
        key=lambda v: (int(v.get("lap", 0)), float(v.get("progress", 0.0))),
        reverse=True,
    )
    return {
        int(vehicle["id"]): index + 1
        for index, vehicle in enumerate(finished + racing)
    }


class NFSHud:
    def __init__(
        self,
        track: Track,
        title: str = "NEON RUSH",
        physics: PhysicsConfig | None = None,
    ) -> None:
        self.track = track
        self.title = title
        self.physics = physics or PhysicsConfig()
        self.font_tiny = T.make_font(pygame, 12)
        self.font_small = T.make_font(pygame, 16)
        self.font_medium = T.make_font(pygame, 20)
        self.font_large = T.make_font(pygame, 28)
        self.font_huge = T.make_font(pygame, 44)
        self.font_speed = T.make_font(pygame, 46)
        self.font_speed_big = T.make_font(pygame, 58)
        self.font_position = T.make_font(pygame, 56)
        self.font_go = T.make_font(pygame, 64)
        self.font_finish = T.make_font(pygame, 72)
        self._last_lap: dict[int, int] = {}
        self._lap_flash: dict[int, tuple[int, float]] = {}

    def draw(
        self,
        screen: pygame.Surface,
        rect: pygame.Rect,
        snapshot: dict[str, Any],
        vehicle: dict[str, Any],
        position: int,
        total_players: int,
        accent: tuple[int, int, int],
    ) -> None:
        compact = rect.height < 520
        margin = 12 if compact else 20
        x0 = rect.x + margin
        y0 = rect.y + margin
        x1 = rect.right - margin
        y1 = rect.bottom - margin

        top_h = 90 if compact else 112
        pos_w = 255 if compact else 320
        mm_w = 154 if compact else 194
        mm_h = top_h - 6

        position_rect = pygame.Rect(x0, y0, pos_w, top_h)
        minimap_rect = pygame.Rect(x1 - mm_w, y0, mm_w, mm_h)
        bar_left = position_rect.right + 18
        bar_right = minimap_rect.left - 18
        bar_rect = pygame.Rect(bar_left, y0 + top_h // 2 - 6, bar_right - bar_left, 12)

        self._draw_position_panel(
            screen, position_rect, vehicle, position, total_players, accent, compact
        )
        self._draw_lap_progress(
            screen, bar_rect, snapshot, vehicle, accent, compact
        )
        self._draw_sector_times(screen, bar_rect, vehicle, accent)
        self._draw_minimap(screen, minimap_rect, snapshot, vehicle, accent)

        tel_w = 300 if compact else 364
        tel_h = 86 if compact else 112
        speed_w = 350 if compact else 420
        speed_h = 124 if compact else 158
        telemetry_rect = pygame.Rect(x0, y1 - tel_h, tel_w, tel_h)
        speed_rect = pygame.Rect(x1 - speed_w, y1 - speed_h, speed_w, speed_h)
        self._draw_telemetry(screen, telemetry_rect, vehicle, accent, compact)
        self._draw_speedometer(screen, speed_rect, snapshot, vehicle, accent, compact)

        self._draw_events(screen, rect, snapshot, vehicle, position, accent, compact)
        self._draw_turbo_panel(screen, rect, vehicle, accent)
        if vehicle.get("off_track"):
            self._draw_offtrack(screen, rect, snapshot, compact)

    def _draw_turbo_panel(
        self,
        screen: pygame.Surface,
        viewport: pygame.Rect,
        vehicle: dict[str, Any],
        accent: tuple[int, int, int],
    ) -> None:
        panel = pygame.Rect(
            viewport.centerx - 138,
            viewport.bottom - (58 if viewport.height >= 520 else 52),
            276,
            40,
        )
        self._panel(screen, panel, accent)
        charge = max(0.0, min(1.0, float(vehicle.get("turbo", 0.0))))
        inventory = vehicle.get("power_up")
        status = (
            f"E · {str(inventory).upper()}"
            if inventory
            else "E · SIN PODER"
        )
        self._text(
            screen,
            self.font_tiny,
            "TURBO · ESPACIO",
            (panel.x + 10, panel.y + 5),
            T.WHITE,
        )
        self._text(
            screen,
            self.font_tiny,
            status,
            (panel.right - 10, panel.y + 5),
            T.CYAN if inventory else T.MUTED,
            anchor="topright",
        )
        bar = pygame.Rect(panel.x + 10, panel.y + 23, panel.width - 20, 8)
        pygame.draw.rect(screen, (14, 23, 35), bar, border_radius=4)
        fill = pygame.Rect(bar.x, bar.y, int(bar.width * charge), bar.height)
        if fill.width:
            pygame.draw.rect(
                screen,
                T.LIME if vehicle.get("turbo_active") else accent,
                fill,
                border_radius=4,
            )

    def _panel(
        self,
        screen: pygame.Surface,
        rect: pygame.Rect,
        accent: tuple[int, int, int],
    ) -> None:
        pygame.draw.rect(screen, (4, 8, 18), rect, border_radius=9)
        inner = rect.inflate(-4, -4)
        pygame.draw.rect(screen, T.scale_color(accent, 0.16), inner, 1, 9)
        pygame.draw.rect(screen, T.scale_color(accent, 0.72), rect, 1, 9)
        pygame.draw.line(
            screen,
            T.scale_color(accent, 0.45),
            (rect.left + 10, rect.top + 3),
            (rect.right - 10, rect.top + 3),
            1,
        )

    def _text(
        self,
        screen: pygame.Surface,
        font: Any,
        text: str,
        pos: tuple[int, int],
        color: tuple[int, int, int],
        *,
        glow: tuple[int, int, int] | None = None,
        anchor: str = "topleft",
    ) -> pygame.Rect:
        return T.blit_text(
            screen, font, text, pos, color, glow=glow, anchor=anchor
        )

    def _draw_position_panel(
        self,
        screen: pygame.Surface,
        rect: pygame.Rect,
        vehicle: dict[str, Any],
        position: int,
        total_players: int,
        accent: tuple[int, int, int],
        compact: bool,
    ) -> None:
        self._panel(screen, rect, accent)
        self._text(
            screen,
            self.font_tiny,
            "POSICIÓN",
            (rect.x + 12, rect.y + 7),
            T.MUTED,
        )
        self._text(
            screen,
            self.font_huge if compact else self.font_position,
            f"P{position}",
            (rect.x + 12, rect.y + 20),
            accent,
            glow=T.scale_color(accent, 0.55),
        )
        self._text(
            screen,
            self.font_medium,
            str(vehicle.get("name", "PILOTO"))[:14],
            (rect.x + (94 if compact else 116), rect.y + 24),
            T.WHITE,
        )
        self._text(
            screen,
            self.font_small,
            f"VUELTA {vehicle.get('lap', 1)}/{vehicle.get('laps', 1)}"
            f"   DE {total_players}",
            (rect.x + (94 if compact else 116), rect.y + 52),
            T.scale_color(accent, 0.9),
        )
    def _draw_lap_progress(
        self,
        screen: pygame.Surface,
        rect: pygame.Rect,
        snapshot: dict[str, Any],
        vehicle: dict[str, Any],
        accent: tuple[int, int, int],
        compact: bool,
    ) -> None:
        laps = max(1, int(vehicle.get("laps", 1)))
        progress = max(0.0, min(1.0, float(vehicle.get("progress", 0.0))))
        label_y = rect.y - 26
        self._text(
            screen,
            self.font_small,
            f"VUELTA {vehicle.get('lap', 1)}/{laps}",
            (rect.x, label_y),
            T.WHITE,
        )
        self._text(
            screen,
            self.font_tiny,
            f"MEJOR {format_time(vehicle.get('best_lap'))}",
            (rect.right, label_y + 2),
            T.MUTED,
            anchor="topright",
        )
        self._text(
            screen,
            self.font_tiny,
            f"T+{format_time(float(snapshot.get('race_time', 0.0)))}",
            (rect.centerx, label_y + 1),
            T.scale_color(accent, 0.9),
            anchor="midtop",
        )

        block_w = max(3, rect.width // 42)
        gap = 2
        segments = max(1, rect.width // (block_w + gap))
        for index in range(segments):
            fraction = index / max(1, segments - 1)
            x = rect.x + index * (block_w + gap)
            if x + block_w > rect.right:
                break
            active = fraction <= progress
            color = T.gradient_color(fraction) if active else (21, 31, 45)
            pygame.draw.rect(
                screen, color, (x, rect.y, block_w, rect.height), border_radius=2
            )
        for lap_index in range(1, laps):
            tick_x = rect.x + int(rect.width * lap_index / laps)
            pygame.draw.line(
                screen, T.LIME, (tick_x, rect.y - 3), (tick_x, rect.bottom + 3), 1
            )
        marker_x = rect.x + int(rect.width * progress)
        pygame.draw.polygon(
            screen,
            T.WHITE,
            [
                (marker_x, rect.y - 5),
                (marker_x - 5, rect.y - 10),
                (marker_x + 5, rect.y - 10),
            ],
        )

    def _draw_sector_times(
        self,
        screen: pygame.Surface,
        rect: pygame.Rect,
        vehicle: dict[str, Any],
        accent: tuple[int, int, int],
    ) -> None:
        times = vehicle.get("sector_times", [])
        if not isinstance(times, list):
            return
        for index in range(3):
            value = times[index] if index < len(times) else None
            text = f"S{index + 1}  {value:.2f}s" if isinstance(value, (int, float)) else f"S{index + 1}  --"
            x = rect.x + int(rect.width * (index + 0.5) / 3)
            self._text(
                screen,
                self.font_tiny,
                text,
                (x, rect.bottom + 5),
                T.scale_color(accent, 0.9) if value is not None else T.MUTED,
                anchor="midtop",
            )

    def _draw_telemetry(
        self,
        screen: pygame.Surface,
        rect: pygame.Rect,
        vehicle: dict[str, Any],
        accent: tuple[int, int, int],
        compact: bool,
    ) -> None:
        self._panel(screen, rect, accent)
        self._text(
            screen,
            self.font_tiny,
            "TELEMETRÍA",
            (rect.x + 10, rect.y + 6),
            T.MUTED,
        )
        bar_x = rect.x + 66
        bar_w = rect.width - 80
        throttle = max(0.0, min(1.0, float(vehicle.get("throttle", 0.0))))
        brake = max(0.0, min(1.0, float(vehicle.get("brake", 0.0))))
        self._text(
            screen, self.font_tiny, "ACEL", (rect.x + 10, rect.y + 25), T.CYAN
        )
        self._segmented_bar(
            screen,
            pygame.Rect(bar_x, rect.y + 25, bar_w, 9),
            throttle,
            T.CYAN,
            T.GREEN,
        )
        self._text(
            screen, self.font_tiny, "FRENO", (rect.x + 10, rect.y + 43), T.MAGENTA
        )
        self._segmented_bar(
            screen,
            pygame.Rect(bar_x, rect.y + 43, bar_w, 9),
            brake,
            T.MAGENTA,
            T.RED,
        )
        self._text(
            screen,
            self.font_tiny,
            f"ÚLTIMA {format_time(vehicle.get('last_lap'))}",
            (rect.x + 10, rect.bottom - 21),
            T.MUTED,
        )
        self._text(
            screen,
            self.font_tiny,
            "ASFALTO" if not vehicle.get("off_track") else "¡SUPERFICIE!",
            (rect.right - 10, rect.bottom - 21),
            T.GREEN if not vehicle.get("off_track") else T.RED,
            anchor="topright",
        )
        if not compact:
            self._text(
                screen,
                self.font_tiny,
                f"MEJOR {format_time(vehicle.get('best_lap'))}",
                (rect.x + 10, rect.bottom - 38),
                T.scale_color(accent, 0.9),
            )

    def _segmented_bar(
        self,
        screen: pygame.Surface,
        rect: pygame.Rect,
        ratio: float,
        start: tuple[int, int, int],
        end: tuple[int, int, int],
    ) -> None:
        pygame.draw.rect(screen, (14, 23, 35), rect, border_radius=3)
        segments = 18
        gap = 2
        block_w = max(2, (rect.width - gap * (segments - 1)) // segments)
        for index in range(segments):
            fraction = index / max(1, segments - 1)
            x = rect.x + index * (block_w + gap)
            if fraction <= ratio:
                color = T.lerp_color(start, end, fraction)
            else:
                color = (23, 33, 48)
            pygame.draw.rect(
                screen, color, (x, rect.y, block_w, rect.height), border_radius=2
            )

    def _draw_speedometer(
        self,
        screen: pygame.Surface,
        rect: pygame.Rect,
        snapshot: dict[str, Any],
        vehicle: dict[str, Any],
        accent: tuple[int, int, int],
        compact: bool,
    ) -> None:
        self._panel(screen, rect, accent)
        max_speed = float(
            snapshot.get("max_speed", self.physics.max_speed)
        ) or self.physics.max_speed
        speed = max(0.0, float(vehicle.get("speed", 0.0)))
        ratio = max(0.0, min(1.0, speed / max_speed))
        display_speed = int(speed * T.SPEED_DISPLAY_FACTOR)
        gear = "N" if speed < 5.0 else str(min(6, 1 + int(ratio * 6)))

        speed_font = self.font_speed if compact else self.font_speed_big
        self._text(
            screen,
            speed_font,
            str(display_speed),
            (rect.x + 18, rect.y + 12),
            T.WHITE,
            glow=T.scale_color(accent, 0.55),
        )
        self._text(
            screen,
            self.font_small,
            "KM/H",
            (rect.x + 20, rect.y + (54 if compact else 72)),
            T.MUTED,
        )
        self._text(
            screen,
            self.font_tiny,
            "MARCHA",
            (rect.x + 20, rect.bottom - 36),
            T.MUTED,
        )
        self._text(
            screen,
            self.font_large,
            gear,
            (rect.x + 82, rect.bottom - 40),
            accent,
            glow=T.scale_color(accent, 0.45),
        )

        cx = rect.right - (76 if compact else 100)
        cy = rect.bottom - (66 if compact else 82)
        radius = 48 if compact else 66
        start_angle = math.radians(135)
        sweep = math.radians(270)
        ticks = 24
        for index in range(ticks):
            fraction = index / (ticks - 1)
            angle = start_angle + sweep * fraction
            inner = 0.74 if index % 3 else 0.66
            x0 = cx + math.cos(angle) * radius * inner
            y0 = cy + math.sin(angle) * radius * inner
            x1 = cx + math.cos(angle) * radius
            y1 = cy + math.sin(angle) * radius
            if fraction <= ratio:
                color = T.gradient_color(fraction)
                width = 4 if index % 3 == 0 else 2
            else:
                color = (24, 36, 52)
                width = 2
            pygame.draw.line(screen, color, (x0, y0), (x1, y1), width)

        needle_angle = start_angle + sweep * ratio
        needle_end = (
            cx + math.cos(needle_angle) * radius * 0.82,
            cy + math.sin(needle_angle) * radius * 0.82,
        )
        pygame.draw.line(
            screen, T.scale_color(accent, 0.35), (cx, cy), needle_end, 7
        )
        pygame.draw.line(screen, accent, (cx, cy), needle_end, 3)
        pygame.draw.circle(screen, T.WHITE, (cx, cy), 5)
        pygame.draw.circle(screen, accent, (cx, cy), 9, 1)
        self._text(
            screen,
            self.font_tiny,
            f"{int(ratio * 100):02d}%",
            (cx, cy + radius + 3),
            T.scale_color(accent, 0.85),
            anchor="midtop",
        )

    def _draw_minimap(
        self,
        screen: pygame.Surface,
        rect: pygame.Rect,
        snapshot: dict[str, Any],
        vehicle: dict[str, Any],
        accent: tuple[int, int, int],
    ) -> None:
        self._panel(screen, rect, accent)
        self._text(
            screen,
            self.font_tiny,
            "GPS // NEON RUSH",
            (rect.x + 8, rect.y + 5),
            T.MUTED,
        )
        inner = rect.inflate(-18, -26)
        inner.y += 7
        x0, y0, x1, y1 = self.track.bounds()
        scale = min(inner.width / (x1 - x0), inner.height / (y1 - y0))
        cx = inner.centerx - (x0 + x1) * 0.5 * scale
        cy = inner.centery - (y0 + y1) * 0.5 * scale

        def project(wx: float, wy: float) -> tuple[int, int]:
            return int(cx + wx * scale), int(cy + wy * scale)

        points = [
            project(*self.track.point_at(index / 72.0)) for index in range(73)
        ]
        pygame.draw.lines(screen, T.scale_color(accent, 0.25), True, points, 6)
        pygame.draw.lines(screen, T.scale_color(accent, 0.7), True, points, 2)

        start = project(*self.track.point_at(0.0))
        pygame.draw.line(
            screen, T.LIME, (start[0], start[1] - 4), (start[0], start[1] + 4), 2
        )
        for other in snapshot.get("vehicles", []):
            px, py = project(float(other["x"]), float(other["y"]))
            color = pygame.Color(other.get("color", "#ffffff"))
            if int(other["id"]) == int(vehicle["id"]):
                pygame.draw.circle(screen, T.WHITE, (px, py), 5)
                pygame.draw.circle(screen, color, (px, py), 3)
            else:
                pygame.draw.circle(screen, color, (px, py), 3)

    def _draw_offtrack(
        self,
        screen: pygame.Surface,
        rect: pygame.Rect,
        snapshot: dict[str, Any],
        compact: bool,
    ) -> None:
        pulse = 0.5 + 0.5 * math.sin(float(snapshot.get("race_time", 0.0)) * 18.0)
        color = T.lerp_color(T.RED, T.ORANGE, pulse)
        pygame.draw.rect(screen, color, rect.inflate(-4, -4), 3, border_radius=4)
        banner = pygame.Rect(
            rect.centerx - 150, rect.y + (106 if compact else 136), 300, 36
        )
        pygame.draw.rect(screen, (20, 2, 8), banner, border_radius=6)
        pygame.draw.rect(screen, color, banner, 1, border_radius=6)
        self._text(
            screen,
            self.font_medium,
            "¡FUERA DE PISTA!",
            banner.center,
            color,
            glow=T.scale_color(color, 0.35),
            anchor="center",
        )

    def _draw_events(
        self,
        screen: pygame.Surface,
        rect: pygame.Rect,
        snapshot: dict[str, Any],
        vehicle: dict[str, Any],
        position: int,
        accent: tuple[int, int, int],
        compact: bool,
    ) -> None:
        race_time = float(snapshot.get("race_time", 0.0))
        status = snapshot.get("status")
        player_id = int(vehicle.get("id", 0))
        lap = int(vehicle.get("lap", 1))

        previous_lap = self._last_lap.get(player_id)
        if previous_lap is not None and lap > previous_lap:
            self._lap_flash[player_id] = (lap, race_time)
        self._last_lap[player_id] = lap

        if 0.0 <= race_time < 0.85 and status == "racing":
            self._text(
                screen,
                self.font_go,
                "¡GO!",
                (rect.centerx, rect.centery - 20),
                T.LIME,
                glow=T.scale_color(T.LIME, 0.45),
                anchor="center",
            )

        flash = self._lap_flash.get(player_id)
        if flash is not None and race_time - flash[1] < 1.6:
            self._text(
                screen,
                self.font_large,
                f"VUELTA {flash[0]}/{vehicle.get('laps', 1)}",
                (rect.centerx, rect.y + 112 if compact else rect.y + 142),
                accent,
                glow=T.scale_color(accent, 0.4),
                anchor="midtop",
            )

        if vehicle.get("finished") or status == "finished":
            overlay = pygame.Surface(rect.size, pygame.SRCALPHA)
            overlay.fill((2, 4, 10, 150))
            screen.blit(overlay, rect.topleft)
            self._text(
                screen,
                self.font_finish,
                "META",
                (rect.centerx, rect.centery - 34),
                T.LIME,
                glow=T.scale_color(T.LIME, 0.4),
                anchor="center",
            )
            self._text(
                screen,
                self.font_huge,
                f"P{position}  {vehicle.get('name', '')}",
                (rect.centerx, rect.centery + 34),
                accent,
                glow=T.scale_color(accent, 0.4),
                anchor="center",
            )
            self._text(
                screen,
                self.font_small,
                f"MEJOR VUELTA  {format_time(vehicle.get('best_lap'))}",
                (rect.centerx, rect.centery + 74),
                T.WHITE,
                anchor="center",
            )
