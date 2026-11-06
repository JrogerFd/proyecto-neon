"""Asset/Thread Manager: carga asíncrona de recursos en hilos secundarios.

El hilo principal (CLI, render o hilo de red) nunca espera I/O de disco:
``start()`` retorna inmediatamente y el trabajo se reparte en un
``ThreadPoolExecutor``. Un hilo coordinador espera a todos los recursos y
publica el resultado mediante ``threading.Event``. El estado interno está
protegido por un ``Lock`` para que las consultas de progreso sean seguras.
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable


@dataclass(frozen=True)
class AssetSpec:
    """Descripción de un recurso a cargar.

    ``loader`` permite conectar cargas reales (texturas, audio, mapas) sin
    cambiar el gestor. Si no se indica, se simula I/O con ``load_seconds`` y
    se devuelve un payload descriptivo.
    """

    name: str
    size_kb: int = 64
    load_seconds: float = 0.10
    path: str | None = None
    loader: Callable[[], Any] | None = field(default=None, compare=False)


def default_asset_specs(
    delay_scale: float = 1.0, node_name: str = "node"
) -> list[AssetSpec]:
    """Recursos típicos que cada nodo necesita antes de la largada."""
    return [
        AssetSpec(
            f"{node_name}:track-geometry",
            size_kb=96,
            load_seconds=0.22 * delay_scale,
        ),
        AssetSpec(
            f"{node_name}:vehicle-sprites",
            size_kb=256,
            load_seconds=0.30 * delay_scale,
        ),
        AssetSpec(
            f"{node_name}:audio-pack",
            size_kb=512,
            load_seconds=0.34 * delay_scale,
        ),
        AssetSpec(
            f"{node_name}:ui-fonts",
            size_kb=48,
            load_seconds=0.15 * delay_scale,
        ),
    ]


class AssetManager:
    def __init__(
        self,
        specs: list[AssetSpec] | None = None,
        *,
        max_workers: int = 4,
        name: str = "assets",
        logger: logging.Logger | None = None,
        on_complete: Callable[["AssetManager"], None] | None = None,
        on_progress: Callable[[str, str, int, int], None] | None = None,
    ) -> None:
        self.specs = specs or default_asset_specs()
        self.max_workers = max(1, max_workers)
        self.name = name
        self.logger = logger or logging.getLogger(f"neonrush.{name}")
        self._on_complete = on_complete
        self._on_progress = on_progress

        self._lock = threading.RLock()
        self._status: dict[str, str] = {spec.name: "pending" for spec in self.specs}
        self._assets: dict[str, Any] = {}
        self._error: str | None = None
        self._started = False
        self._cancelled = False
        self._ready = threading.Event()
        self._started_at: float | None = None
        self._finished_at: float | None = None
        self._coordinator: threading.Thread | None = None

    @property
    def ready(self) -> bool:
        return self._ready.is_set() and self._error is None

    @property
    def error(self) -> str | None:
        with self._lock:
            return self._error

    @property
    def elapsed(self) -> float:
        with self._lock:
            if self._started_at is None:
                return 0.0
            end = self._finished_at or time.monotonic()
            return end - self._started_at

    def progress(self) -> tuple[int, int]:
        with self._lock:
            done = sum(1 for status in self._status.values() if status == "ready")
            return done, len(self._status)

    def status_snapshot(self) -> dict[str, str]:
        with self._lock:
            return dict(self._status)

    @property
    def assets(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._assets)

    def start(self) -> None:
        """Lanza la carga en background. Regresa de inmediato."""
        with self._lock:
            if self._started:
                return
            self._started = True
            self._started_at = time.monotonic()
        self._coordinator = threading.Thread(
            target=self._run,
            name=f"asset-coordinator-{self.name}",
            daemon=True,
        )
        self._coordinator.start()

    def wait(self, timeout: float | None = None) -> bool:
        """Espera la finalización. Solo debe usarse desde hilos de carga."""
        if not self._ready.wait(timeout):
            return False
        return self.error is None

    def join(self, timeout: float | None = None) -> None:
        if self._coordinator is not None:
            self._coordinator.join(timeout)

    def cancel(self) -> None:
        with self._lock:
            self._cancelled = True
        if self._coordinator is not None:
            self._coordinator.join(timeout=1.0)

    def _run(self) -> None:
        try:
            with ThreadPoolExecutor(
                max_workers=self.max_workers,
                thread_name_prefix=f"asset-{self.name}",
            ) as executor:
                futures: dict[Future[Any], AssetSpec] = {
                    executor.submit(self._load_one, spec): spec
                    for spec in self.specs
                }
                for future in as_completed(futures):
                    spec = futures[future]
                    try:
                        future.result()
                    except Exception as exc:  # noqa: BLE001 - se reporta al nodo
                        with self._lock:
                            self._status[spec.name] = "failed"
                            self._error = f"{spec.name}: {exc}"
                        self.logger.error("Asset %s falló: %s", spec.name, exc)
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                self._error = str(exc)
            self.logger.exception("Fallo del coordinador de assets")
        finally:
            with self._lock:
                self._finished_at = time.monotonic()
                cancelled = self._cancelled
                if cancelled and self._error is None:
                    self._error = "carga cancelada"
            self._ready.set()
            done, total = self.progress()
            if self._error is None:
                self.logger.info(
                    "Assets %s listos (%d/%d) en %.2fs",
                    self.name,
                    done,
                    total,
                    self.elapsed,
                )
            else:
                self.logger.warning(
                    "Assets %s incompletos (%d/%d): %s",
                    self.name,
                    done,
                    total,
                    self._error,
                )
            if self._on_complete is not None and not self._cancelled:
                try:
                    self._on_complete(self)
                except Exception:  # noqa: BLE001
                    self.logger.exception("Callback on_complete falló")

    def _load_one(self, spec: AssetSpec) -> None:
        if self._cancelled:
            return
        with self._lock:
            self._status[spec.name] = "loading"
        self._notify_progress(spec.name)


        started = time.monotonic()
        try:
            if spec.loader is not None:
                payload = spec.loader()
            elif spec.path:
                payload = Path(spec.path).read_bytes()
            else:
                time.sleep(max(0.0, spec.load_seconds))
                payload = {
                    "asset": spec.name,
                    "size_kb": spec.size_kb,
                    "loaded_by": threading.current_thread().name,
                }
            if self._cancelled:
                return
            if spec.loader is None and spec.path is None:
                minimum = spec.load_seconds
                remaining = minimum - (time.monotonic() - started)
                if remaining > 0:
                    time.sleep(remaining)
        except Exception:
            with self._lock:
                self._status[spec.name] = "failed"
            raise

        with self._lock:
            self._assets[spec.name] = payload
            self._status[spec.name] = "ready"
        self._notify_progress(spec.name)

    def _notify_progress(self, name: str) -> None:
        if self._on_progress is None:
            return
        done, total = self.progress()
        with self._lock:
            status = self._status.get(name, "pending")
        try:
            self._on_progress(name, status, done, total)
        except Exception:  # noqa: BLE001
            self.logger.debug("Callback on_progress falló", exc_info=True)
