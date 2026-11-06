"""Nodo Master: sala de juego, registro de Workers y barrera de inicio.

Cada conexión TCP tiene:
  * un hilo receptor que interpreta HELLO/READY/INPUT,
  * un hilo emisor con cola propia para que un cliente lento nunca bloquee al
    hilo de simulación.

El Master es autoritativo: solo él ejecuta físicas. Los Workers envían sus
intenciones de control y reciben snapshots del estado.
"""

from __future__ import annotations

import logging
import queue
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .asset_manager import AssetManager, default_asset_specs
from .config import (
    DEFAULT_HOST,
    DEFAULT_PORT,
    DEFAULT_ROOM,
    PROTOCOL_VERSION,
    SERVER_BACKLOG,
    START_COUNTDOWN_SECONDS,
    SNAPSHOT_QUEUE_SIZE,
    SOCKET_TIMEOUT,
    PLAYER_COLORS,
    PhysicsConfig,
    RaceConfig,
)
from .protocol import (
    ChannelTimeout,
    ConnectionClosed,
    JsonChannel,
    Msg,
    ProtocolError,
    make_message,
)
from .session import SimulationLoop
from .track import Track
from .world import ComputePool, PlayerSpec, RaceWorld
from .physics import VehicleInput


class ClientConnection:
    """Conexión de un Worker con emisor y receptor desacoplados."""

    def __init__(
        self,
        master: "MasterNode",
        sock: socket.socket,
        address: tuple[str, int],
    ) -> None:
        self.master = master
        self.address = address
        self.channel = JsonChannel(sock)
        self.player_id: int | None = None
        self.name: str | None = None
        self.color: str | None = None
        self.physics: PhysicsConfig | None = None
        self.ready = False
        self.accepted = False
        self._queue: queue.Queue[dict[str, Any] | None] = queue.Queue(
            maxsize=SNAPSHOT_QUEUE_SIZE
        )
        self._closed = threading.Event()
        self._close_lock = threading.Lock()
        self._sender = threading.Thread(
            target=self._sender_loop,
            name=f"tx-{address[0]}:{address[1]}",
            daemon=True,
        )

    def run(self) -> None:
        self._sender.start()
        try:
            hello = self.channel.recv(timeout=10.0)
            accepted = self.master.handle_hello(self, hello)
            if not accepted:
                time.sleep(0.15)
                return
            while not self._closed.is_set() and not self.master.stopping:
                try:
                    message = self.channel.recv(timeout=SOCKET_TIMEOUT)
                except ChannelTimeout:
                    continue
                self.master.handle_message(self, message)
        except ChannelTimeout:
            self.master.logger.warning("Timeout esperando HELLO de %s", self.address)
        except (ConnectionClosed, OSError):
            pass
        except ProtocolError as exc:
            self.master.logger.warning("Protocolo inválido %s: %s", self.address, exc)
        except Exception:  # noqa: BLE001
            self.master.logger.exception("Error atendiendo a %s", self.address)
        finally:
            self.master.on_disconnect(self)
            self.close()

    def enqueue(self, message: dict[str, Any], *, droppable: bool = False) -> None:
        if self._closed.is_set():
            return
        try:
            self._queue.put_nowait(message)
        except queue.Full:
            if droppable:
                return
            try:
                self._queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self._queue.put_nowait(message)
            except queue.Full:
                self.close()

    def reject(self, reason: str) -> None:
        try:
            self.channel.send(
                make_message(Msg.ERROR, reason=reason, fatal=True, code="rejected")
            )
        except (ConnectionClosed, OSError):
            pass

    def _sender_loop(self) -> None:
        while not self._closed.is_set():
            try:
                message = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            if message is None:
                break
            try:
                self.channel.send(message)
            except (ConnectionClosed, OSError):
                break
        self.close()

    def close(self) -> None:
        with self._close_lock:
            if self._closed.is_set():
                return
            self._closed.set()
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass
        self.channel.close()


class MasterNode:
    def __init__(
        self,
        host: str = DEFAULT_HOST,
        port: int = DEFAULT_PORT,
        room: str = DEFAULT_ROOM,
        expected_players: int = 2,
        *,
        track: Track | None = None,
        laps: int = 3,
        asset_delay: float = 1.0,
        auto_shutdown: bool = True,
        shutdown_delay: float = 2.0,
        compute_pool: ComputePool | None = None,
        ai_opponents: int = 0,
        logger: logging.Logger | None = None,
    ) -> None:
        self.host = host
        self.port = port
        self.room = room.strip() or DEFAULT_ROOM
        self.expected_players = max(1, expected_players)
        self.auto_shutdown = auto_shutdown
        self.shutdown_delay = shutdown_delay
        self.compute_pool = compute_pool
        self.ai_opponents = max(0, ai_opponents)
        if self.ai_opponents and self.compute_pool is None:
            raise ValueError("Los rivales IA del Master requieren un pool de cómputo")
        self.logger = logger or logging.getLogger("neonrush.master")
        self.bound_port = port
        self.race_config = RaceConfig(laps=laps)
        self.track = track or Track.oval()

        self._clients: dict[int, ClientConnection] = {}
        self._clients_lock = threading.RLock()
        self._next_player_id = 1
        self._server_sock: socket.socket | None = None
        self._accept_thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lifecycle_lock = threading.Lock()
        self._closing = False
        self._started = False
        self._assets_ready = False
        self._world: RaceWorld | None = None
        self._sim: SimulationLoop | None = None
        self._shutdown_timer: threading.Timer | None = None
        self._finish_results: list[dict[str, Any]] | None = None
        self._ai_player_ids: set[int] = set()

        self.race_finished = threading.Event()
        self.done = threading.Event()
        self.assets = AssetManager(
            default_asset_specs(asset_delay, "master"),
            name="master-assets",
            logger=self.logger,
            on_complete=self._on_assets_ready,
        )

    @property
    def stopping(self) -> bool:
        return self._stop.is_set()

    @property
    def started(self) -> bool:
        with self._clients_lock:
            return self._started

    @property
    def finish_results(self) -> list[dict[str, Any]] | None:
        return self._finish_results

    def bind(self) -> int:
        if self._server_sock is not None:
            return self.bound_port
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((self.host, self.port))
        sock.listen(SERVER_BACKLOG)
        sock.settimeout(SOCKET_TIMEOUT)
        self._server_sock = sock
        self.bound_port = sock.getsockname()[1]
        self.logger.info(
            "Sala '%s' creada en %s:%d | esperando %d Worker(s) | %d vueltas",
            self.room,
            self.host,
            self.bound_port,
            self.expected_players,
            self.race_config.laps,
        )
        return self.bound_port

    def serve_forever(self) -> None:
        if self._server_sock is None:
            self.bind()
        self.assets.start()
        self.logger.info("Master aceptando conexiones. Assets cargando en background.")
        try:
            while not self._stop.is_set():
                sock = self._server_sock
                if sock is None:
                    break
                try:
                    conn, address = sock.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break
                conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                client = ClientConnection(self, conn, address)
                thread = threading.Thread(
                    target=client.run,
                    name=f"rx-{address[0]}:{address[1]}",
                    daemon=True,
                )
                thread.start()
                self.logger.info("Conexión entrante de %s:%d", *address)
        finally:
            self.stop()

    def start_background(self) -> int:
        port = self.bind()
        self._accept_thread = threading.Thread(
            target=self.serve_forever,
            name="neonrush-master",
            daemon=True,
        )
        self._accept_thread.start()
        return port

    def stop(self) -> None:
        with self._lifecycle_lock:
            if self._closing:
                return
            self._closing = True
        self._stop.set()
        server = self._server_sock
        if server is not None:
            try:
                server.close()
            except OSError:
                pass
        with self._clients_lock:
            clients = list(self._clients.values())
            self._clients.clear()
        for client in clients:
            client.close()
        sim = self._sim
        if sim is not None:
            sim.request_stop()
            sim.join(timeout=1.5)
        self.assets.cancel()
        self.done.set()
        self.logger.info("Master detenido.")

    def wait_finished(self, timeout: float | None = None) -> bool:
        return self.race_finished.wait(timeout)

    # ------------------------------------------------------------------
    # Handlers de mensajes (se ejecutan en hilos receptores)
    # ------------------------------------------------------------------
    def handle_hello(self, client: ClientConnection, message: dict[str, Any]) -> bool:
        if message.get("type") != Msg.HELLO.value:
            client.reject("Se esperaba HELLO como primer mensaje.")
            return False
        if int(message.get("protocol", 0)) != PROTOCOL_VERSION:
            client.reject(
                f"Versión de protocolo incompatible (se requiere {PROTOCOL_VERSION})."
            )
            return False
        requested_room = str(message.get("room", DEFAULT_ROOM)).strip()
        if requested_room.casefold() != self.room.casefold():
            client.reject(
                f"Sala '{requested_room}' no encontrada. Sala activa: '{self.room}'."
            )
            return False

        name = str(message.get("name", "")).strip()[:24]
        if not name:
            name = f"Worker-{client.address[1] % 1000:03d}"

        with self._clients_lock:
            if self._stop.is_set():
                client.reject("El Master se está apagando.")
                return False
            if self._started:
                client.reject("La carrera ya comenzó; no se admiten más nodos.")
                return False
            if len(self._clients) >= self.expected_players:
                client.reject("La sala está completa.")
                return False
            player_id = self._next_player_id
            self._next_player_id += 1
            client.player_id = player_id
            client.name = name
            requested_color = str(message.get("color", "")).strip()
            if (
                len(requested_color) == 7
                and requested_color.startswith("#")
                and all(char in "0123456789abcdefABCDEF" for char in requested_color[1:])
            ):
                client.color = requested_color
            else:
                client.color = PLAYER_COLORS[
                    (player_id - 1) % len(PLAYER_COLORS)
                ]
            raw_physics = message.get("physics")
            client.physics = PhysicsConfig.from_dict(
                raw_physics if isinstance(raw_physics, dict) else None
            )
            client.accepted = True
            self._clients[player_id] = client
            connected = len(self._clients)
            color = client.color

        self.logger.info(
            "Worker '%s' unido como jugador %d (%d/%d)",
            name,
            player_id,
            connected,
            self.expected_players,
        )
        client.enqueue(
            make_message(
                Msg.WELCOME,
                protocol=PROTOCOL_VERSION,
                room=self.room,
                player_id=player_id,
                name=name,
                color=color,
                tick_rate=self.race_config.tick_rate,
                snapshot_rate=self.race_config.snapshot_rate,
                laps=self.race_config.laps,
                max_race_seconds=self.race_config.max_race_seconds,
                expected_players=self.expected_players,
                track=self.track.to_dict(),
            )
        )
        self._broadcast_room_status()
        self._maybe_start()
        return True

    def handle_message(
        self, client: ClientConnection, message: dict[str, Any]
    ) -> None:
        kind = message.get("type")
        if kind == Msg.READY.value:
            self._handle_ready(client, message)
        elif kind == Msg.INPUT.value:
            self._handle_input(client, message)
        elif kind == Msg.PING.value:
            client.enqueue(make_message(Msg.PONG, sent_at=message.get("sent_at")))
        elif kind == Msg.BYE.value:
            client.close()
        else:
            self.logger.debug(
                "Mensaje ignorado de %s: %s", client.name or client.address, kind
            )

    def _handle_ready(
        self, client: ClientConnection, message: dict[str, Any]
    ) -> None:
        if client.player_id is None:
            return
        with self._clients_lock:
            if self._started or client.ready:
                return
            client.ready = True
            done = sum(1 for c in self._clients.values() if c.ready)
            total = len(self._clients)
        self.logger.info(
            "READY de '%s' (%d/%d assets propios, %d/%d nodos listos)",
            client.name,
            int(message.get("done", 0)),
            int(message.get("total", 0)),
            done,
            total,
        )
        self._broadcast_room_status()
        self._maybe_start()

    def _handle_input(
        self, client: ClientConnection, message: dict[str, Any]
    ) -> None:
        if client.player_id is None or not self._started:
            return
        world = self._world
        if world is None:
            return
        raw = message.get("input", {})
        if not isinstance(raw, dict):
            return
        world.set_input(client.player_id, VehicleInput.from_dict(raw))

    # ------------------------------------------------------------------
    # Arranque sincronizado y difusión
    # ------------------------------------------------------------------
    def _on_assets_ready(self, manager: AssetManager) -> None:
        self._assets_ready = manager.ready
        if not self._assets_ready:
            self.logger.error("El Master no pudo cargar sus assets: %s", manager.error)
            return
        self.logger.info("Assets del Master al 100%. Evaluando barrera de inicio.")
        self._maybe_start()

    def _maybe_start(self) -> None:
        with self._clients_lock:
            if (
                self._started
                or self._stop.is_set()
                or not self._assets_ready
                or len(self._clients) != self.expected_players
                or any(not client.ready for client in self._clients.values())
            ):
                return
            players: list[PlayerSpec] = []
            for player_id in sorted(self._clients):
                client = self._clients[player_id]
                players.append(
                    PlayerSpec(
                        player_id=player_id,
                        name=client.name or f"P{player_id}",
                        color=client.color
                        or PLAYER_COLORS[
                            (player_id - 1) % len(PLAYER_COLORS)
                        ],
                        physics=client.physics,
                    )
                )
            for index in range(self.ai_opponents):
                player_id = len(players) + 1
                players.append(
                    PlayerSpec(
                        player_id=player_id,
                        name=f"OASIS-{index + 1:02d}",
                        color=PLAYER_COLORS[(player_id - 1) % len(PLAYER_COLORS)],
                    )
                )
                self._ai_player_ids.add(player_id)
            clients = list(self._clients.values())
            self._started = True

        self.logger.info(
            "PREFLIGHT: validando %d nodo(s) con ThreadPoolExecutor + Barrier...",
            len(clients),
        )
        barrier = threading.Barrier(len(clients) + 1, timeout=5.0)

        def verify(client: ClientConnection) -> str | None:
            try:
                if client.player_id is None:
                    return "cliente sin player_id"
                if not client.ready:
                    return f"{client.name or client.address}: assets no listos"
                if not client.name:
                    return f"P{client.player_id}: nombre vacío"
                return None
            finally:
                try:
                    barrier.wait(timeout=5.0)
                except threading.BrokenBarrierError:
                    pass

        errors: list[str] = []
        started = time.monotonic()
        try:
            with ThreadPoolExecutor(
                max_workers=max(1, len(clients)),
                thread_name_prefix="master-preflight",
            ) as pool:
                futures = [pool.submit(verify, client) for client in clients]
                try:
                    barrier.wait(timeout=5.0)
                except threading.BrokenBarrierError:
                    errors.append("barrera de preflight abortada")
                for future in futures:
                    error = future.result(timeout=3.0)
                    if error is not None:
                        errors.append(error)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"preflight: {exc}")

        if errors:
            self.logger.error(
                "PREFLIGHT FALLÓ (%s); se cancela la largada.", "; ".join(errors)
            )
            threading.Thread(
                target=self.stop,
                name="master-preflight-abort",
                daemon=True,
            ).start()
            return

        if self._stop.is_set():
            return
        self.logger.info(
            "PREFLIGHT OK en %.2fs: %d/%d nodos verificados en paralelo.",
            time.monotonic() - started,
            len(clients),
            self.expected_players,
        )

        world = RaceWorld(
            self.track,
            players,
            self.race_config,
            compute_pool=self.compute_pool,
        )
        with self._clients_lock:
            self._world = world

        self.logger.info(
            "BARRERA DE INICIO LIBERADA: %d/%d nodos y assets del Master al 100%%.",
            len(clients),
            self.expected_players,
        )
        self._broadcast_snapshot(world.snapshot())
        start_message = make_message(
            Msg.START,
            race_id=f"{self.room}-{int(time.time())}",
            tick_rate=self.race_config.tick_rate,
            snapshot_rate=self.race_config.snapshot_rate,
            laps=self.race_config.laps,
            countdown=START_COUNTDOWN_SECONDS,
            track=self.track.to_dict(),
            players=[player.name for player in players],
        )
        for client in clients:
            client.enqueue(start_message)

        start_event = threading.Event()
        on_tick = None
        if self._ai_player_ids:
            compute_pool = self.compute_pool
            if compute_pool is None:
                raise RuntimeError("No hay pool de cómputo para los rivales IA")

            def update_ai(race_world: RaceWorld) -> None:
                snapshot = race_world.snapshot()
                ai_vehicles = [
                    vehicle
                    for vehicle in snapshot["vehicles"]
                    if int(vehicle["id"]) in self._ai_player_ids
                ]
                controls = compute_pool.autopilot_controls(ai_vehicles, self.track)
                for player_id, control in controls.items():
                    race_world.set_input(player_id, control)

            on_tick = update_ai
        sim = SimulationLoop(
            world,
            self.race_config,
            start_event=start_event,
            stop_event=self._stop,
            on_tick=on_tick,
            on_snapshot=self._broadcast_snapshot,
            on_finish=self._on_finish,
            on_error=self._on_simulation_error,
            logger=self.logger,
        )
        self._sim = sim
        sim.start()

        def release_start() -> None:
            if not self._stop.wait(START_COUNTDOWN_SECONDS):
                start_event.set()

        threading.Thread(
            target=release_start,
            name="master-start-countdown",
            daemon=True,
        ).start()

    def _on_finish(self, results: list[dict[str, Any]]) -> None:
        self._finish_results = results
        message = make_message(
            Msg.FINISH,
            race_time=round(self._world.race_time, 3) if self._world else 0.0,
            results=results,
        )
        self._broadcast(message)
        for result in results:
            self.logger.info(
                "P%d %-12s %s  mejor vuelta=%s",
                result["placement"],
                result["name"],
                "FIN" if result["finished"] else "DNF",
                result["best_lap"] if result["best_lap"] is not None else "-",
            )
        self.race_finished.set()
        if self.auto_shutdown:
            self._shutdown_timer = threading.Timer(self.shutdown_delay, self.stop)
            self._shutdown_timer.daemon = True
            self._shutdown_timer.start()

    def _on_simulation_error(self, error: Exception) -> None:
        self._broadcast(
            make_message(
                Msg.ERROR,
                reason=f"Falló la simulación autoritativa: {error}",
                fatal=True,
                code="simulation_failed",
            )
        )
        self.race_finished.set()
        threading.Thread(
            target=self.stop,
            name="master-simulation-failure",
            daemon=True,
        ).start()

    def _broadcast(self, message: dict[str, Any]) -> None:
        with self._clients_lock:
            clients = list(self._clients.values())
        for client in clients:
            client.enqueue(message)

    def _broadcast_snapshot(self, snapshot: dict[str, Any]) -> None:
        message = {"type": Msg.SNAPSHOT.value, **snapshot}
        with self._clients_lock:
            clients = list(self._clients.values())
        for client in clients:
            client.enqueue(message, droppable=True)

    def _broadcast_room_status(self) -> None:
        with self._clients_lock:
            clients = list(self._clients.values())
            connected = len(clients)
            ready = sum(1 for client in clients if client.ready)
            started = self._started
        self._broadcast(
            make_message(
                Msg.ROOM_STATUS,
                room=self.room,
                connected=connected,
                ready=ready,
                expected=self.expected_players,
                assets_ready=self._assets_ready,
                started=started,
                players=sorted(
                    client.name or "?" for client in clients
                ),
            )
        )

    def on_disconnect(self, client: ClientConnection) -> None:
        player_id = client.player_id
        if player_id is None:
            return
        with self._clients_lock:
            removed = self._clients.pop(player_id, None)
            started = self._started
            world = self._world
            remaining = len(self._clients)
        if removed is None:
            return
        self.logger.warning(
            "Worker '%s' (jugador %d) desconectado; quedan %d.",
            removed.name,
            player_id,
            remaining,
        )
        if started and world is not None:
            world.mark_disconnected(player_id)
            if remaining == 0:
                self.logger.warning("No quedan Workers: cerrando la sala.")
                self.stop()
        else:
            self._broadcast_room_status()
