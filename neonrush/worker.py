"""Nodo Worker: carga assets en background, se une a la sala y renderiza.

Responsabilidades:
  * HELLO / READY / INPUT por TCP.
  * Carga asíncrona de sus propios recursos mientras el hilo principal sigue
    conectado y receptivo.
  * Renderizado local de los snapshots autoritativos del Master.
  * En modo headless o sin teclado, un piloto automático envía controles.
"""

from __future__ import annotations

import logging
import math
import socket
import threading
import time
from typing import Any

from .ai import autopilot_control
from .asset_manager import AssetManager, default_asset_specs
from .config import (
    CONNECT_TIMEOUT,
    DEFAULT_CLIENT_HOST,
    DEFAULT_PORT,
    DEFAULT_ROOM,
    PROTOCOL_VERSION,
    RENDER_FPS,
    SNAPSHOT_HISTORY,
    SOCKET_TIMEOUT,
    START_COUNTDOWN_SECONDS,
    PhysicsConfig,
)
from .interpolation import SnapshotBuffer
from .protocol import (
    ChannelTimeout,
    ConnectionClosed,
    JsonChannel,
    Msg,
    ProtocolError,
    make_message,
)
from .render import create_renderer
from .track import Track


class WorkerClient:
    def __init__(
        self,
        host: str = DEFAULT_CLIENT_HOST,
        port: int = DEFAULT_PORT,
        room: str = DEFAULT_ROOM,
        name: str = "Worker",
        *,
        render: str = "auto",
        autopilot: bool = False,
        duration: float | None = None,
        asset_delay: float = 1.0,
        physics_config: PhysicsConfig | None = None,
        color: str | None = None,
        split_view: bool = False,
        display_surface: Any | None = None,
        interactive_tutorial: bool = False,
        logger: logging.Logger | None = None,
    ) -> None:
        self.host = host
        self.port = port
        self.room = room
        self.name = name
        self.render_kind = render
        self.force_autopilot = autopilot
        self.duration = duration
        self.logger = logger or logging.getLogger(f"neonrush.worker.{name}")

        self.player_id: int | None = None
        self.color = color or "#00e5ff"
        self.physics_config = physics_config
        self.split_view = split_view
        self.display_surface = display_surface
        self.interactive_tutorial = interactive_tutorial
        self.channel: JsonChannel | None = None
        self.renderer = None
        self.track = Track.oval()
        self.results: list[dict[str, Any]] | None = None
        self.error: str | None = None

        self._lock = threading.RLock()
        self._snapshot: dict[str, Any] | None = None
        self._buffer = SnapshotBuffer(history=SNAPSHOT_HISTORY)
        self._welcome: dict[str, Any] | None = None
        self._lobby_status: dict[str, Any] = {}
        self._welcome_event = threading.Event()
        self._assets_ready = False
        self._ready_sent = False
        self._receiver: threading.Thread | None = None
        self._connection_lost = threading.Event()
        self._stop = threading.Event()
        self.start_event = threading.Event()
        self.finish_event = threading.Event()
        self._input_seq = 0
        self._network_rtt_ms: float | None = None
        self._last_ping_at = 0.0
        self._race_start_at: float | None = None
        self._countdown_go_until = 0.0

        self.assets = AssetManager(
            default_asset_specs(asset_delay, name),
            name=f"worker-assets-{name}",
            logger=self.logger,
            on_complete=self._on_assets_ready,
        )

    @property
    def stopping(self) -> bool:
        return self._stop.is_set()

    def request_stop(self) -> None:
        self._stop.set()

    @property
    def network_rtt_ms(self) -> float | None:
        with self._lock:
            return self._network_rtt_ms

    def run(self) -> bool:
        self.assets.start()
        try:
            self._connect()
            with self._lock:
                welcome = dict(self._welcome or {})
            self.track = Track.from_dict(welcome.get("track", {}))
            self.renderer = create_renderer(
                self.render_kind,
                self.track,
                title=f"NEON RUSH | {self.name}",
                logger=self.logger,
                screen=self.display_surface,
                interactive_tutorial=self.interactive_tutorial,
            )
            if not self.renderer.supports_keyboard:
                self.force_autopilot = True

            self._receiver = threading.Thread(
                target=self._receive_loop,
                name=f"worker-rx-{self.name}",
                daemon=True,
            )
            self._receiver.start()
            self._maybe_send_ready()
            self._main_loop()
            return self.error is None
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)
            self.logger.error("Worker '%s' falló: %s", self.name, exc)
            return False
        finally:
            self._stop.set()
            self._buffer.clear()
            self.assets.cancel()
            if self.channel is not None:
                try:
                    self.channel.send(
                        make_message(Msg.BYE, player_id=self.player_id)
                    )
                except (ConnectionClosed, OSError):
                    pass
                self.channel.close()
            if self.renderer is not None:
                self.renderer.close()

    # ------------------------------------------------------------------
    # Conexión y recepción
    # ------------------------------------------------------------------
    def _connect(self) -> None:
        deadline = time.monotonic() + CONNECT_TIMEOUT
        sock: socket.socket | None = None
        while not self._stop.is_set():
            try:
                sock = socket.create_connection((self.host, self.port), timeout=3.0)
                break
            except OSError as exc:
                if time.monotonic() >= deadline:
                    raise RuntimeError(
                        f"No se pudo conectar a {self.host}:{self.port}: {exc}"
                    ) from exc
                self.logger.info(
                    "Master no disponible aún (%s); reintentando...", exc
                )
                self._stop.wait(0.5)
        if sock is None:
            raise RuntimeError("Conexión cancelada")
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.channel = JsonChannel(sock)
        self.channel.send(
            make_message(
                Msg.HELLO,
                protocol=PROTOCOL_VERSION,
                room=self.room,
                name=self.name,
                color=self.color,
                physics=(
                    self.physics_config.to_dict()
                    if self.physics_config is not None
                    else None
                ),
            )
        )

        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            try:
                message = self.channel.recv(timeout=0.5)
            except ChannelTimeout:
                continue
            kind = message.get("type")
            if kind == Msg.WELCOME.value:
                with self._lock:
                    self._welcome = message
                    self.player_id = int(message.get("player_id", 0))
                    self.color = str(message.get("color", self.color))
                self._welcome_event.set()
                self.logger.info(
                    "Bienvenido a la sala '%s' como P%d '%s'.",
                    message.get("room", self.room),
                    self.player_id,
                    message.get("name", self.name),
                )
                return
            if kind == Msg.ERROR.value:
                raise RuntimeError(str(message.get("reason", "rechazado")))
        raise RuntimeError("Timeout esperando WELCOME del Master")

    def _receive_loop(self) -> None:
        channel = self.channel
        if channel is None:
            return
        try:
            while not self._stop.is_set():
                try:
                    message = channel.recv(timeout=SOCKET_TIMEOUT)
                except ChannelTimeout:
                    continue
                self._handle_message(message)
        except (ConnectionClosed, OSError):
            pass
        except ProtocolError as exc:
            self.error = f"protocolo: {exc}"
            self.logger.error("Protocolo inválido: %s", exc)
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)
            self.logger.exception("Error en el hilo receptor")
        finally:
            self._connection_lost.set()

    def _handle_message(self, message: dict[str, Any]) -> None:
        kind = message.get("type")
        if kind == Msg.SNAPSHOT.value:
            with self._lock:
                self._snapshot = message
            self._buffer.push(message)
        elif kind == Msg.START.value:
            countdown = message.get("countdown", START_COUNTDOWN_SECONDS)
            if isinstance(countdown, bool) or not isinstance(countdown, (int, float)):
                countdown = START_COUNTDOWN_SECONDS
            countdown = max(0.0, min(10.0, float(countdown)))
            self._race_start_at = time.monotonic() + countdown
            self._countdown_go_until = self._race_start_at + 0.45
            self.logger.info(
                "START recibido: cuenta regresiva de %.1fs, %d vueltas.",
                countdown,
                int(message.get("laps", 0)),
            )
            self.start_event.set()
        elif kind == Msg.FINISH.value:
            with self._lock:
                self.results = list(message.get("results", []))
            winner = self.results[0] if self.results else None
            if winner is not None:
                self.logger.info(
                    "FINISH: ganador %s en %ss.",
                    winner.get("name"),
                    winner.get("finish_time"),
                )
            self.finish_event.set()
        elif kind == Msg.ROOM_STATUS.value:
            with self._lock:
                self._lobby_status = dict(message)
            self.logger.info(
                "Lobby: %s/%s nodos, %s listos.",
                message.get("connected"),
                message.get("expected"),
                message.get("ready"),
            )
        elif kind == Msg.ERROR.value:
            self.error = str(message.get("reason", "error del Master"))
            self.logger.error("Master reporta: %s", self.error)
            self._stop.set()
        elif kind == Msg.PONG.value:
            raw_sent_at = message.get("sent_at")
            if isinstance(raw_sent_at, bool) or not isinstance(
                raw_sent_at, (int, float)
            ):
                self.logger.warning("PONG recibido sin timestamp válido.")
                return
            sent_at = float(raw_sent_at)
            if not math.isfinite(sent_at):
                self.logger.warning("PONG recibido con timestamp no finito.")
                return
            rtt_ms = max(0.0, (time.monotonic() - sent_at) * 1000.0)
            with self._lock:
                self._network_rtt_ms = rtt_ms
        else:
            self.logger.debug("Mensaje no manejado: %s", kind)

    # ------------------------------------------------------------------
    # Assets y controles
    # ------------------------------------------------------------------
    def _on_assets_ready(self, manager: AssetManager) -> None:
        with self._lock:
            self._assets_ready = manager.ready
        if not manager.ready:
            self.error = f"assets: {manager.error}"
            self.logger.error("No se pudieron cargar assets: %s", manager.error)
            self._stop.set()
            return
        self.logger.info("Assets del Worker listos; enviando READY.")
        self._maybe_send_ready()

    def _maybe_send_ready(self) -> None:
        should_send = False
        done = total = 0
        with self._lock:
            if (
                self._assets_ready
                and self.channel is not None
                and self.player_id is not None
                and not self._ready_sent
                and not self._stop.is_set()
            ):
                self._ready_sent = True
                should_send = True
                done, total = self.assets.progress()
        if should_send and self.channel is not None:
            try:
                self.channel.send(
                    make_message(
                        Msg.READY,
                        player_id=self.player_id,
                        done=done,
                        total=total,
                    )
                )
            except (ConnectionClosed, OSError) as exc:
                self.error = str(exc)
                self._stop.set()

    def _main_loop(self) -> None:
        started_at: float | None = None
        last_input = 0.0
        interval = 1.0 / 30.0

        while not self._stop.is_set():
            if self.renderer is not None and self.renderer.closed:
                break
            now = time.monotonic()
            self._send_ping(now)

            if not self.start_event.is_set():
                self._draw_lobby(now)
                if self.renderer is not None and self.renderer.closed:
                    break
                if self._connection_lost.is_set():
                    self.logger.warning("Conexión con el Master finalizada.")
                    break
                time.sleep(1.0 / RENDER_FPS)
                continue

            if self._race_start_at is not None and now < self._race_start_at:
                latest = self._buffer.latest()
                if latest is not None and self.renderer is not None:
                    self.renderer.draw(latest, self._focus_ids(latest))
                    draw_countdown = getattr(self.renderer, "draw_countdown", None)
                    if callable(draw_countdown):
                        draw_countdown(str(max(1, math.ceil(self._race_start_at - now))))
                time.sleep(1.0 / RENDER_FPS)
                continue

            if started_at is None:
                started_at = now
                self.logger.info(
                    "Carrera iniciada; render interpolado desde snapshots a 30 Hz."
                )
            if (
                self.duration is not None
                and now - started_at >= self.duration
            ):
                self.logger.info("Duración de demo alcanzada; cerrando Worker.")
                break

            latest = self._buffer.latest()
            if latest is not None and self.renderer is not None:
                if now - last_input >= interval:
                    self._send_control(latest)
                    last_input = now
                snapshot = self._buffer.sample(now) or latest
                rtt_ms = self.network_rtt_ms
                if rtt_ms is not None:
                    snapshot = dict(snapshot)
                    snapshot["network_rtt_ms"] = rtt_ms
                self.renderer.draw(snapshot, self._focus_ids(snapshot))
                if now < self._countdown_go_until:
                    draw_countdown = getattr(self.renderer, "draw_countdown", None)
                    if callable(draw_countdown):
                        draw_countdown("GO")

            if self.finish_event.is_set():
                break
            if self._connection_lost.is_set() and not self.finish_event.is_set():
                self.logger.warning("Conexión con el Master finalizada.")
                break
            time.sleep(1.0 / RENDER_FPS)

        if self.results:
            self._log_results()

    def _send_ping(self, now: float) -> None:
        channel = self.channel
        if channel is None or now - self._last_ping_at < 1.0:
            return
        self._last_ping_at = now
        try:
            channel.send(make_message(Msg.PING, sent_at=now))
        except (ConnectionClosed, OSError) as exc:
            self.error = str(exc)
            self._stop.set()

    def _focus_ids(self, snapshot: dict[str, Any]) -> list[int]:
        if self.split_view:
            ids = sorted(
                int(vehicle["id"])
                for vehicle in snapshot.get("vehicles", [])
                if vehicle.get("connected", True)
            )
            if ids:
                return ids[:2]
        return [self.player_id] if self.player_id is not None else []

    def _draw_lobby(self, now: float) -> None:
        if self.renderer is None:
            return
        latest = self._buffer.latest()
        with self._lock:
            lobby = dict(self._lobby_status)
            assets_ready = self._assets_ready
        if not assets_ready:
            done, total = self.assets.progress()
            progress = done / total if total else 0.0
            self.renderer.draw_lobby(
                "CARGANDO ASSETS",
                progress,
                f"{done}/{total} recursos del Worker",
            )
            return
        if latest is None:
            dots = "." * (int(now * 3) % 4)
            self.renderer.draw_lobby(
                f"SINCRONIZANDO{dots}",
                None,
                "Esperando el primer snapshot autoritativo",
            )
            return
        connected = int(lobby.get("connected", 0))
        expected = int(lobby.get("expected", 0))
        ready = int(lobby.get("ready", 0))
        self.renderer.draw_lobby(
            "ESPERANDO JUGADORES",
            None,
            f"{connected}/{expected} nodos conectados · {ready} listos",
        )

    def _send_control(self, snapshot: dict[str, Any]) -> None:
        channel = self.channel
        if channel is None or self.player_id is None:
            return
        control = None
        if self.renderer is not None and self.renderer.supports_keyboard:
            polled = self.renderer.poll_inputs(snapshot)
            if polled and not self.force_autopilot:
                control = polled[0]

        if control is None:
            vehicles = snapshot.get("vehicles", [])
            own = next(
                (
                    vehicle
                    for vehicle in vehicles
                    if int(vehicle.get("id", -1)) == self.player_id
                ),
                None,
            )
            if own is not None:
                control = autopilot_control(own, self.track)

        if control is None:
            return
        self._input_seq += 1
        try:
            channel.send(
                make_message(
                    Msg.INPUT,
                    seq=self._input_seq,
                    input=control.to_dict(),
                )
            )
        except (ConnectionClosed, OSError) as exc:
            self.error = str(exc)
            self._stop.set()

    def _log_results(self) -> None:
        assert self.results is not None
        for result in self.results:
            self.logger.info(
                "P%d %-12s %s tiempo=%s mejor=%s",
                result.get("placement", 0),
                result.get("name", "?"),
                "FIN" if result.get("finished") else "DNF",
                result.get("finish_time"),
                result.get("best_lap"),
            )
