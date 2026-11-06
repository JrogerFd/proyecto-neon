"""Modo local concurrente: 1 o 2 jugadores con carga asíncrona y barrera.

La barrera local usa ``threading.Barrier`` de 3 participantes (un loader por
jugador + hilo coordinador). El hilo principal dibuja el lobby de carga y la
simulación no arranca hasta que ambos loaders confirman el 100% de sus assets.
La aplicación OASIS puede reutilizar el modo local con ``skip_assets=True`` si
ya mostró su propia pantalla de carga.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from .ai import autopilot_control
from .asset_manager import AssetManager, default_asset_specs
from .config import (
    RENDER_FPS,
    SNAPSHOT_HISTORY,
    START_COUNTDOWN_SECONDS,
    PhysicsConfig,
    RaceConfig,
)
from .interpolation import SnapshotBuffer
from .render import create_renderer
from .session import SimulationLoop
from .track import Track
from .world import PlayerSpec, RaceWorld, make_player_specs


class LocalGame:
    def __init__(
        self,
        *,
        laps: int = 3,
        render: str = "auto",
        autopilot: bool = False,
        duration: float | None = None,
        asset_delay: float = 1.0,
        players: list[PlayerSpec] | None = None,
        track: Track | None = None,
        physics_config: PhysicsConfig | None = None,
        human_players: int = 2,
        focus_players: list[int] | None = None,
        skip_assets: bool = False,
        title: str = "NEON RUSH | OASIS",
        display_surface: Any | None = None,
        interactive_tutorial: bool = False,
        logger: logging.Logger | None = None,
    ) -> None:
        self.laps = laps
        self.render_kind = render
        self.force_autopilot = autopilot
        self.duration = duration
        self.asset_delay = asset_delay
        self.players = players
        self.track = track
        self.physics_config = physics_config
        self.human_players = max(1, human_players)
        self.focus_players = list(focus_players) if focus_players else None
        self.skip_assets = skip_assets
        self.title = title
        self.display_surface = display_surface
        self.interactive_tutorial = interactive_tutorial
        self.logger = logger or logging.getLogger("neonrush.local")
        self.results: list[dict[str, Any]] | None = None
        self.error: str | None = None

    def run(self) -> bool:
        track = self.track or Track.oval()
        players = self.players or make_player_specs(["P1", "P2"])
        human_players = min(self.human_players, len(players))
        race_config = RaceConfig(laps=self.laps)
        renderer = create_renderer(
            self.render_kind,
            track,
            title=self.title,
            logger=self.logger,
            screen=self.display_surface,
            interactive_tutorial=self.interactive_tutorial,
        )
        if not renderer.supports_keyboard:
            self.force_autopilot = True

        managers: list[AssetManager] = []
        load_errors: list[str] = []
        managers_lock = threading.Lock()
        errors_lock = threading.Lock()
        barrier = threading.Barrier(len(players) + 1)
        load_done = threading.Event()
        assets_ok = threading.Event()
        threads: list[threading.Thread] = []
        coordinator: threading.Thread | None = None

        def load_player_assets(player: PlayerSpec) -> None:
            manager = AssetManager(
                default_asset_specs(self.asset_delay, f"local-{player.name}"),
                name=f"local-assets-{player.name}",
                logger=self.logger,
            )
            with managers_lock:
                managers.append(manager)
            manager.start()
            ok = manager.wait(timeout=60.0)
            if not ok:
                with errors_lock:
                    load_errors.append(
                        f"{player.name}: {manager.error or 'timeout'}"
                    )
                self.logger.error(
                    "Loader %s falló: %s", player.name, manager.error
                )
                try:
                    barrier.abort()
                except Exception:  # noqa: BLE001
                    pass
                return
            self.logger.info(
                "Loader local %s: assets al 100%% en %.2fs.",
                player.name,
                manager.elapsed,
            )
            try:
                barrier.wait(timeout=5.0)
            except threading.BrokenBarrierError:
                pass

        def coordinate_barrier() -> None:
            try:
                barrier.wait(timeout=65.0)
            except threading.BrokenBarrierError:
                pass
            with errors_lock:
                failed = bool(load_errors)
            if not failed:
                assets_ok.set()
            load_done.set()

        if self.skip_assets:
            self.logger.info(
                "Modo local: assets precargados por la aplicación OASIS."
            )
            assets_ok.set()
            load_done.set()
        else:
            self.logger.info(
                "Modo local: cargando assets de %d jugadores en paralelo "
                "(barrera de %d participantes).",
                len(players),
                len(players) + 1,
            )
            threads = [
                threading.Thread(
                    target=load_player_assets,
                    args=(player,),
                    name=f"local-loader-{player.player_id}",
                    daemon=True,
                )
                for player in players
            ]
            coordinator = threading.Thread(
                target=coordinate_barrier,
                name="local-barrier-coordinator",
                daemon=True,
            )
            for thread in threads:
                thread.start()
            coordinator.start()

            while not load_done.is_set() and not renderer.closed:
                with managers_lock:
                    snapshot_managers = list(managers)
                done = total = 0
                parts: list[str] = []
                for manager in snapshot_managers:
                    manager_done, manager_total = manager.progress()
                    done += manager_done
                    total += manager_total
                    label = manager.name.rsplit("-", 1)[-1]
                    parts.append(f"{label} {manager_done}/{manager_total}")
                progress = done / total if total else 0.0
                renderer.draw_lobby(
                    "INICIALIZANDO SIMULACIÓN",
                    progress,
                    " · ".join(parts) if parts else "iniciando loaders...",
                )
                time.sleep(1.0 / RENDER_FPS)

            if renderer.closed:
                self.logger.info("Ventana cerrada durante la carga local.")
                for manager in managers:
                    manager.cancel()
                if coordinator is not None:
                    coordinator.join(timeout=1.0)
                for thread in threads:
                    thread.join(timeout=1.0)
                renderer.close()
                return True

            if coordinator is not None:
                coordinator.join(timeout=1.0)
            for thread in threads:
                thread.join(timeout=1.0)

            if not assets_ok.is_set() or load_errors:
                with errors_lock:
                    self.error = "; ".join(load_errors) or "barrera local abortada"
                self.logger.error("No se puede largar: %s", self.error)
                for manager in managers:
                    manager.cancel()
                renderer.close()
                return False

        self.logger.info(
            "BARRERA LOCAL LIBERADA: %d/%d jugadores con assets al 100%%.",
            len(players),
            len(players),
        )
        self.logger.info(
            "Interpolación activa: snapshots a %d Hz, render a %d FPS.",
            race_config.snapshot_rate,
            RENDER_FPS,
        )

        world = RaceWorld(
            track,
            players,
            race_config,
            physics_config=self.physics_config,
        )
        stop_event = threading.Event()
        start_event = threading.Event()
        buffer = SnapshotBuffer(history=SNAPSHOT_HISTORY)
        buffer.push(world.snapshot())
        available = {player.player_id for player in players}
        focus = [
            player_id
            for player_id in (self.focus_players or [player.player_id for player in players])
            if player_id in available
        ]
        if not focus:
            focus = [players[0].player_id]

        def on_snapshot(snapshot: dict[str, Any]) -> None:
            buffer.push(snapshot)

        sim = SimulationLoop(
            world,
            race_config,
            start_event=start_event,
            stop_event=stop_event,
            on_snapshot=on_snapshot,
            logger=self.logger,
        )
        sim.start()
        draw_countdown = getattr(renderer, "draw_countdown", None)
        if callable(draw_countdown):
            countdown_until = time.monotonic() + START_COUNTDOWN_SECONDS
            while time.monotonic() < countdown_until and not renderer.closed:
                latest = buffer.latest() or world.snapshot()
                renderer.draw(latest, focus)
                remaining = countdown_until - time.monotonic()
                draw_countdown(str(max(1, int(remaining) + 1)))
                if renderer.supports_keyboard:
                    renderer.poll_inputs(latest)
                time.sleep(1.0 / RENDER_FPS)
            if not renderer.closed:
                latest = buffer.latest() or world.snapshot()
                renderer.draw(latest, focus)
                draw_countdown("GO")
                time.sleep(0.35)
                start_event.set()
        else:
            start_event.set()

        started_at = time.monotonic()
        try:
            while not stop_event.is_set():
                now = time.monotonic()
                if self.duration is not None and now - started_at >= self.duration:
                    self.logger.info("Duración alcanzada; cerrando modo local.")
                    break

                latest = buffer.latest()
                snapshot = buffer.sample(now)
                if snapshot is None:
                    snapshot = world.snapshot()
                    buffer.push(snapshot)

                polled = None
                if renderer.supports_keyboard and not self.force_autopilot:
                    polled = renderer.poll_inputs(latest or snapshot)

                vehicles = {
                    int(vehicle["id"]): vehicle
                    for vehicle in (latest or snapshot).get("vehicles", [])
                }
                for index, player in enumerate(players):
                    if polled is not None and index < human_players:
                        control = polled[index]
                    else:
                        vehicle = vehicles.get(player.player_id)
                        if vehicle is None:
                            continue
                        control = autopilot_control(
                            vehicle,
                            track,
                            lookahead=0.032 + index * 0.004,
                        )
                    world.set_input(player.player_id, control)

                renderer.draw(snapshot, focus)

                if world.all_finished():
                    final_snapshot = world.snapshot()
                    buffer.push(final_snapshot)
                    renderer.draw(final_snapshot, focus)
                    break
                if renderer.closed:
                    break
                time.sleep(1.0 / RENDER_FPS)
        finally:
            stop_event.set()
            sim.join(timeout=1.5)
            buffer.clear()
            renderer.close()
            for manager in managers:
                manager.cancel()

        self.results = world.results()
        self._log_results()
        return True

    def _log_results(self) -> None:
        if not self.results:
            return
        for result in self.results:
            self.logger.info(
                "P%d %-4s %s tiempo=%s mejor=%s",
                result["placement"],
                result["name"],
                "FIN" if result["finished"] else "DNF",
                result["finish_time"],
                result["best_lap"],
            )
