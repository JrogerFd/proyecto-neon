"""MPI ranks dedicated to physics, AI controls, and procedural track generation."""

from __future__ import annotations

import threading
from typing import Any

from .physics import PhysicsEngine, VehicleInput, VehicleState
from .track import Track

_TASK_TAG = 41


class MpiComputePool:
    """Rank-zero dispatcher for the worker ranks in ``COMM_WORLD``."""

    def __init__(self, communicator: Any) -> None:
        self._comm = communicator
        self._workers = tuple(range(1, communicator.Get_size()))
        if communicator.Get_rank() != 0:
            raise ValueError("MpiComputePool solo se crea en el rank 0")
        if not self._workers:
            raise ValueError("MPI requiere al menos un rank worker")
        self._sequence = 0
        self._lock = threading.Lock()
        self._closed = False

    def generate_track(self, style: str, seed: int | None = None) -> Track:
        styles = ("neon", "synth", "code", "void")
        requests: dict[int, dict[str, Any]] = {
            rank: {"operation": "tracks", "styles": []} for rank in self._workers
        }
        for index, candidate in enumerate(styles):
            rank = self._workers[index % len(self._workers)]
            requests[rank]["styles"].append((candidate, seed))
        responses = self._dispatch(requests)
        tracks = {
            candidate: track
            for response in responses.values()
            for candidate, track in response.items()
        }
        try:
            return tracks[style]
        except KeyError as exc:
            raise ValueError(f"Estilo de pista MPI desconocido: {style}") from exc

    def autopilot_controls(
        self, vehicles: list[dict[str, Any]], track: Track
    ) -> dict[int, VehicleInput]:
        requests: dict[int, dict[str, Any]] = {
            rank: {"operation": "autopilot", "items": []}
            for rank in self._workers
        }
        for index, vehicle in enumerate(vehicles):
            rank = self._workers[index % len(self._workers)]
            requests[rank]["items"].append((vehicle, track))
        responses = self._dispatch(requests)
        return {
            player_id: control
            for response in responses.values()
            for player_id, control in response.items()
        }

    def step_vehicles(
        self,
        vehicles: dict[int, VehicleState],
        engines: dict[int, PhysicsEngine],
        controls: dict[int, VehicleInput],
        dt: float,
        track: Track,
        race_time: float,
    ) -> None:
        requests: dict[int, dict[str, Any]] = {
            rank: {"operation": "physics", "items": []}
            for rank in self._workers
        }
        for index, player_id in enumerate(sorted(vehicles)):
            engine = engines.get(player_id)
            if engine is None:
                continue
            rank = self._workers[index % len(self._workers)]
            control = controls.get(player_id, VehicleInput.neutral())
            if not vehicles[player_id].connected:
                control = VehicleInput.neutral()
            requests[rank]["items"].append(
                (
                    vehicles[player_id],
                    engine.config,
                    control,
                    dt,
                    track,
                    race_time,
                )
            )
        responses = self._dispatch(requests)
        for response in responses.values():
            vehicles.update(response)

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            sequence = self._next_sequence()
            for rank in self._workers:
                self._comm.send((sequence, {"operation": "stop"}), dest=rank, tag=_TASK_TAG)
            responses = {
                rank: self._comm.recv(source=rank, tag=_TASK_TAG)
                for rank in self._workers
            }
            self._validate_responses(sequence, responses)

    def _dispatch(
        self, requests: dict[int, dict[str, Any]]
    ) -> dict[int, dict[Any, Any]]:
        with self._lock:
            if self._closed:
                raise RuntimeError("El pool MPI está cerrado")
            sequence = self._next_sequence()
            for rank, request in requests.items():
                self._comm.send((sequence, request), dest=rank, tag=_TASK_TAG)
            responses = {
                rank: self._comm.recv(source=rank, tag=_TASK_TAG)
                for rank in self._workers
            }
            self._validate_responses(sequence, responses)
            return {
                rank: response["result"]
                for rank, (_, response) in responses.items()
            }

    def _next_sequence(self) -> int:
        self._sequence += 1
        return self._sequence

    @staticmethod
    def _validate_responses(
        expected: int, responses: dict[int, tuple[int, dict[str, Any]]]
    ) -> None:
        errors: list[str] = []
        for rank, (received, response) in responses.items():
            if received != expected:
                errors.append(
                    f"rank {rank}: secuencia esperada {expected}, recibida {received}"
                )
            error = response.get("error")
            if error:
                errors.append(f"rank {rank}: {error}")
        if errors:
            raise RuntimeError("Falló una operación MPI (" + "; ".join(errors) + ")")


def run_compute_worker(communicator: Any) -> None:
    """Serve work items until rank zero sends an explicit stop message."""
    while True:
        sequence, request = communicator.recv(source=0, tag=_TASK_TAG)
        operation = request.get("operation")
        if operation == "stop":
            communicator.send(
                (sequence, {"result": {}}), dest=0, tag=_TASK_TAG
            )
            return

        try:
            response = {"result": _execute_request(request)}
        except Exception as exc:
            response = {"error": f"{type(exc).__name__}: {exc}"}
        communicator.send((sequence, response), dest=0, tag=_TASK_TAG)


def _execute_request(request: dict[str, Any]) -> dict[Any, Any]:
    from .ai import autopilot_control

    operation = request.get("operation")
    if operation == "physics":
        result: dict[Any, Any] = {}
        for state, config, control, dt, track, race_time in request["items"]:
            engine = PhysicsEngine(config)
            engine.step(state, control, dt, track, race_time)
            result[state.player_id] = state
        return result
    if operation == "autopilot":
        return {
            int(vehicle["id"]): autopilot_control(vehicle, track)
            for vehicle, track in request["items"]
        }
    if operation == "tracks":
        return {
            style: Track.procedural(style, seed)
            for style, seed in request["styles"]
        }
    raise ValueError(f"Operación MPI desconocida: {operation}")
