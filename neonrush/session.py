"""Bucle autoritativo de simulación a paso fijo.

El hilo de simulación permanece bloqueado en ``start_event`` hasta que el
Master (o la barrera local) confirma que todos los nodos terminaron de cargar.
Solo entonces comienza a ejecutar físicas y a emitir snapshots.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Callable

from .config import RaceConfig
from .world import RaceWorld


class SimulationLoop(threading.Thread):
    def __init__(
        self,
        world: RaceWorld,
        race_config: RaceConfig | None = None,
        *,
        start_event: threading.Event | None = None,
        stop_event: threading.Event | None = None,
        on_tick: Callable[[RaceWorld], None] | None = None,
        on_snapshot: Callable[[dict], None] | None = None,
        on_finish: Callable[[list[dict]], None] | None = None,
        on_error: Callable[[Exception], None] | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        super().__init__(name="neonrush-simulation", daemon=True)
        self.world = world
        self.config = race_config or world.race_config
        self.start_event = start_event or threading.Event()
        self.stop_event = stop_event or threading.Event()
        self._on_snapshot = on_snapshot
        self._on_tick = on_tick
        self._on_finish = on_finish
        self._on_error = on_error
        self.logger = logger or logging.getLogger("neonrush.simulation")
        self.done = threading.Event()
        self.error: Exception | None = None
        self._finish_reported = False

    def request_stop(self) -> None:
        self.stop_event.set()

    def run(self) -> None:
        try:
            self.logger.info(
                "Hilo de físicas esperando la barrera de inicio (assets 100%)."
            )
            while not self.start_event.wait(0.1):
                if self.stop_event.is_set():
                    self.logger.info("Simulación cancelada antes de largar.")
                    return
            if self.stop_event.is_set():
                return

            self.logger.info(
                "Barrera liberada: físicas activas a %d Hz.",
                self.config.tick_rate,
            )
            dt = self.config.fixed_dt
            next_tick = time.monotonic()
            last_snapshot = time.monotonic() - self.config.snapshot_interval

            while not self.stop_event.is_set():
                if self._on_tick is not None:
                    self._on_tick(self.world)
                self.world.step(dt)
                now = time.monotonic()

                if (
                    not self.world.all_finished()
                    and self.world.race_time >= self.config.max_race_seconds
                ):
                    self.logger.warning(
                        "Timeout de carrera (%.1fs); se cierra la carrera.",
                        self.config.max_race_seconds,
                    )
                    self.world.force_finish()

                if now - last_snapshot >= self.config.snapshot_interval:
                    self._emit_snapshot()
                    last_snapshot = now

                if self.world.all_finished():
                    self._emit_snapshot()
                    self._report_finish()
                    return

                next_tick += dt
                delay = next_tick - now
                if delay > 0:
                    self.stop_event.wait(delay)
                else:
                    next_tick = now
        except Exception as exc:
            self.error = exc
            self.logger.exception("Error fatal en el bucle de simulación")
            if self._on_error is not None:
                try:
                    self._on_error(exc)
                except Exception:
                    self.logger.exception("Fallo en callback on_error")
        finally:
            self.done.set()

    def _emit_snapshot(self) -> None:
        if self._on_snapshot is None:
            return
        try:
            self._on_snapshot(self.world.snapshot())
        except Exception:  # noqa: BLE001
            self.logger.exception("Fallo al emitir snapshot")

    def _report_finish(self) -> None:
        if self._finish_reported:
            return
        self._finish_reported = True
        results = self.world.results()
        self.logger.info(
            "Carrera finalizada. Ganador: %s",
            results[0]["name"] if results else "sin participantes",
        )
        if self._on_finish is not None:
            try:
                self._on_finish(results)
            except Exception:  # noqa: BLE001
                self.logger.exception("Fallo en callback on_finish")
