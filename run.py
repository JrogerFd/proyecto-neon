#!/usr/bin/env python3
"""Punto de entrada de NEON RUSH.

Subcomandos:
  play    abre la aplicación OASIS completa (título, tutorial, garaje, carrera).
  master  crea la sala y administra el clúster (autoritativo).
  worker  se une a una sala, carga assets y renderiza.
  local   2 jugadores en split-screen dentro de un solo proceso.
  demo    Master + Workers headless en un solo comando (prueba end-to-end).
  mpi-cluster  Master TCP en rank 0 y ranks MPI dedicados al cómputo.

Sin subcomando se abre la aplicación OASIS (equivale a ``play``).
"""

from __future__ import annotations

import argparse
import importlib
import logging
import socket
import sys
import threading
import time

from neonrush.config import (
    DEFAULT_CLIENT_HOST,
    DEFAULT_PORT,
    DEFAULT_ROOM,
)
from neonrush.local import LocalGame
from neonrush.master import MasterNode
from neonrush.worker import WorkerClient

LOG = logging.getLogger("neonrush")


def free_port(host: str = "127.0.0.1") -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def run_demo(
    players: int,
    laps: int,
    asset_delay: float,
    timeout: float,
    logger: logging.Logger,
) -> bool:
    port = free_port()
    logger.info(
        "DEMO: Master en 127.0.0.1:%d con %d Worker(s), %d vueltas.",
        port,
        players,
        laps,
    )
    master = MasterNode(
        host="127.0.0.1",
        port=port,
        room="DEMO",
        expected_players=players,
        laps=laps,
        asset_delay=asset_delay,
        auto_shutdown=False,
        logger=logger.getChild("master"),
    )
    master.start_background()
    time.sleep(0.15)

    workers: list[WorkerClient] = []
    threads: list[threading.Thread] = []
    for index in range(players):
        worker = WorkerClient(
            host="127.0.0.1",
            port=port,
            room="DEMO",
            name=f"NEON-{index + 1}",
            render="none",
            autopilot=True,
            duration=timeout,
            asset_delay=asset_delay,
            logger=logger.getChild(f"worker{index + 1}"),
        )
        thread = threading.Thread(
            target=worker.run,
            name=f"demo-worker-{index + 1}",
            daemon=True,
        )
        workers.append(worker)
        threads.append(thread)
        thread.start()

    finished = master.wait_finished(timeout)
    if not finished:
        logger.error("DEMO: timeout esperando FINISH del Master.")
    else:
        results = master.finish_results or []
        logger.info("DEMO: resultados finales")
        for result in results:
            logger.info(
                "  P%d %-10s %s tiempo=%s mejor=%s",
                result["placement"],
                result["name"],
                "FIN" if result["finished"] else "DNF",
                result["finish_time"],
                result["best_lap"],
            )

    for worker in workers:
        worker.request_stop()
    master.stop()
    for thread in threads:
        thread.join(timeout=3.0)

    ok = finished and all(worker.error is None for worker in workers)
    logger.info("DEMO: %s", "OK" if ok else "CON ERRORES")
    return ok


def run_mpi_cluster(args: argparse.Namespace) -> int:
    try:
        mpi4py = importlib.import_module("mpi4py")
        mpi4py.rc.thread_level = "multiple"
        MPI = importlib.import_module("mpi4py.MPI")
    except ImportError:
        LOG.error(
            "El clúster MPI requiere mpi4py y una implementación OpenMPI instalada."
        )
        return 1

    provided = MPI.Query_thread()
    if provided < MPI.THREAD_MULTIPLE:
        LOG.error(
            "MPI solo ofrece thread level %d; se requiere THREAD_MULTIPLE (%d).",
            provided,
            MPI.THREAD_MULTIPLE,
        )
        return 1

    communicator = MPI.COMM_WORLD
    if communicator.Get_size() < 3:
        LOG.error("mpi-cluster requiere rank 0 y al menos dos ranks de cómputo.")
        return 1

    from neonrush.mpi_cluster import MpiComputePool, run_compute_worker

    if communicator.Get_rank() != 0:
        run_compute_worker(communicator)
        return 0

    pool = MpiComputePool(communicator)
    node: MasterNode | None = None
    try:
        track = pool.generate_track(args.track_style, args.seed)
        node = MasterNode(
            host=args.host,
            port=args.port,
            room=args.room,
            expected_players=args.players,
            laps=args.laps,
            asset_delay=args.asset_delay,
            auto_shutdown=False,
            compute_pool=pool,
            ai_opponents=args.ai_opponents,
            track=track,
        )
        node.bind()
        LOG.info(
            "Master MPI listo en %s:%d; %d rank(s) de cómputo activos.",
            args.host,
            node.bound_port,
            communicator.Get_size() - 1,
        )
        node.serve_forever()
    except KeyboardInterrupt:
        LOG.info("Interrupción recibida; cerrando Master y ranks MPI.")
    except Exception:
        LOG.exception("Falló el nodo coordinador MPI.")
        return 1
    finally:
        if node is not None:
            node.stop()
        pool.close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="neon-rush",
        description="Simulador de carreras distribuido Master-Worker.",
    )
    sub = parser.add_subparsers(dest="command", required=False)

    play = sub.add_parser("play", help="Abrir la aplicación OASIS completa")
    play.add_argument(
        "--mode",
        choices=["multiplayer", "short", "championship", "normal"],
        default=None,
        help="Modo inicial (por defecto, el último usado en el perfil)",
    )
    play.add_argument(
        "--asset-delay",
        type=float,
        default=0.8,
        help="Escala la carga virtual de la pantalla de carga",
    )
    play.add_argument("--skip-tutorial", action="store_true")
    play.add_argument(
        "--autostart",
        action="store_true",
        help="Saltar menú y garaje; cargar directamente el modo elegido",
    )
    play.add_argument("--no-audio", action="store_true")

    master = sub.add_parser("master", help="Crear sala y administrar el clúster")
    master.add_argument("--host", default="0.0.0.0")
    master.add_argument("--port", type=int, default=DEFAULT_PORT)
    master.add_argument("--room", default=DEFAULT_ROOM)
    master.add_argument("--players", type=int, default=2)
    master.add_argument("--laps", type=int, default=3)
    master.add_argument(
        "--asset-delay",
        type=float,
        default=1.0,
        help="Escala la latencia simulada de carga de assets",
    )
    master.add_argument(
        "--stay-alive",
        action="store_true",
        help="No cerrar el Master automáticamente al terminar la carrera",
    )
    master.add_argument("--shutdown-delay", type=float, default=2.0)

    worker = sub.add_parser("worker", help="Unirse a una sala activa")
    worker.add_argument("--host", default=DEFAULT_CLIENT_HOST)
    worker.add_argument("--port", type=int, default=DEFAULT_PORT)
    worker.add_argument("--room", default=DEFAULT_ROOM)
    worker.add_argument("--name", default="Worker")
    worker.add_argument(
        "--render", choices=["auto", "pygame", "console", "none"], default="auto"
    )
    worker.add_argument(
        "--autopilot",
        action="store_true",
        help="El Worker pilota solo (útil para demos headless)",
    )
    worker.add_argument("--duration", type=float, default=None)
    worker.add_argument("--asset-delay", type=float, default=1.0)

    local = sub.add_parser("local", help="2 jugadores en split-screen local")
    local.add_argument("--laps", type=int, default=3)
    local.add_argument(
        "--render", choices=["auto", "pygame", "console", "none"], default="auto"
    )
    local.add_argument("--autopilot", action="store_true")
    local.add_argument("--duration", type=float, default=None)
    local.add_argument("--asset-delay", type=float, default=1.0)

    demo = sub.add_parser("demo", help="Master + Workers headless end-to-end")
    demo.add_argument("--players", type=int, default=2)
    demo.add_argument("--laps", type=int, default=2)
    demo.add_argument("--asset-delay", type=float, default=0.05)
    demo.add_argument("--timeout", type=float, default=90.0)

    mpi_cluster = sub.add_parser(
        "mpi-cluster",
        help="Master TCP con Workers MPI dedicados al cómputo",
    )
    mpi_cluster.add_argument("--host", default="0.0.0.0")
    mpi_cluster.add_argument("--port", type=int, default=DEFAULT_PORT)
    mpi_cluster.add_argument("--room", default=DEFAULT_ROOM)
    mpi_cluster.add_argument("--players", type=int, default=1)
    mpi_cluster.add_argument("--ai-opponents", type=int, default=1)
    mpi_cluster.add_argument("--laps", type=int, default=3)
    mpi_cluster.add_argument(
        "--track-style",
        choices=["neon", "synth", "code", "void"],
        default="neon",
    )
    mpi_cluster.add_argument("--seed", type=int, default=None)
    mpi_cluster.add_argument("--asset-delay", type=float, default=0.4)

    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)-24s %(message)s",
        datefmt="%H:%M:%S",
    )
    args = build_parser().parse_args(argv)

    if args.command == "mpi-cluster":
        return run_mpi_cluster(args)

    if args.command in (None, "play"):
        try:
            from neonrush.app import run_neon_app
        except ImportError as exc:
            LOG.error(
                "La aplicación OASIS requiere Pygame. Activá el venv o instalá "
                "requirements-render.txt (%s).",
                exc,
            )
            return 1

        try:
            return run_neon_app(
                asset_delay=getattr(args, "asset_delay", 0.8),
                enable_audio=not getattr(args, "no_audio", False),
                skip_tutorial=getattr(args, "skip_tutorial", False),
                mode_id=getattr(args, "mode", None),
                autostart=getattr(args, "autostart", False),
            )
        except KeyboardInterrupt:
            LOG.info("Interrupción recibida; cerrando la aplicación OASIS.")
            return 0
        except RuntimeError as exc:
            LOG.error("%s", exc)
            return 1

    if args.command == "master":
        node = MasterNode(
            host=args.host,
            port=args.port,
            room=args.room,
            expected_players=args.players,
            laps=args.laps,
            asset_delay=args.asset_delay,
            auto_shutdown=not args.stay_alive,
            shutdown_delay=args.shutdown_delay,
        )
        try:
            node.bind()
            node.serve_forever()
        except KeyboardInterrupt:
            LOG.info("Interrupción recibida; cerrando Master.")
            node.stop()
        return 0

    if args.command == "worker":
        worker = WorkerClient(
            host=args.host,
            port=args.port,
            room=args.room,
            name=args.name,
            render=args.render,
            autopilot=args.autopilot,
            duration=args.duration,
            asset_delay=args.asset_delay,
        )
        try:
            return 0 if worker.run() else 1
        except KeyboardInterrupt:
            worker.request_stop()
            LOG.info("Interrupción recibida; cerrando Worker.")
            return 0

    if args.command == "local":
        game = LocalGame(
            laps=args.laps,
            render=args.render,
            autopilot=args.autopilot,
            duration=args.duration,
            asset_delay=args.asset_delay,
        )
        try:
            return 0 if game.run() else 1
        except KeyboardInterrupt:
            LOG.info("Interrupción recibida; cerrando modo local.")
            return 0

    if args.command == "demo":
        logger = logging.getLogger("neonrush.demo")
        return 0 if run_demo(
            args.players,
            args.laps,
            args.asset_delay,
            args.timeout,
            logger,
        ) else 1

    return 2


if __name__ == "__main__":
    sys.exit(main())
