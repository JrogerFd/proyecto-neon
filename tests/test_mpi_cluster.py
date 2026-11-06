import unittest

from neonrush.config import RaceConfig
from neonrush.mpi_cluster import MpiComputePool, _execute_request
from neonrush.physics import VehicleInput
from neonrush.track import Track
from neonrush.world import RaceWorld, make_player_specs


class _InlineCommunicator:
    def __init__(self) -> None:
        self.responses = {}

    def Get_rank(self) -> int:
        return 0

    def Get_size(self) -> int:
        return 3

    def send(self, message, dest: int, tag: int) -> None:
        sequence, request = message
        if request["operation"] == "stop":
            response = {"result": {}}
        else:
            response = {"result": _execute_request(request)}
        self.responses[dest] = (sequence, response)

    def recv(self, source: int, tag: int):
        return self.responses.pop(source)


class MpiComputePoolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.pool = MpiComputePool(_InlineCommunicator())

    def tearDown(self) -> None:
        self.pool.close()

    def test_track_generation_runs_on_worker_ranks(self):
        track = self.pool.generate_track("synth", seed=17)
        self.assertEqual(track, Track.procedural("synth", seed=17))

    def test_world_delegates_vehicle_physics(self):
        track = Track.oval()
        world = RaceWorld(
            track,
            make_player_specs(["P1", "P2"]),
            RaceConfig(laps=1),
            compute_pool=self.pool,
        )
        world.set_input(1, VehicleInput(throttle=1.0))
        world.step(1.0 / 60.0)
        snapshot = world.snapshot()
        self.assertGreater(snapshot["vehicles"][0]["speed"], 0.0)
        self.assertEqual(snapshot["tick"], 1)

    def test_ai_controls_are_returned_by_worker_ranks(self):
        controls = self.pool.autopilot_controls(
            [{"id": 8, "x": 0.0, "y": 0.0, "heading": 0.0, "speed": 0.0}],
            Track.oval(),
        )
        self.assertIn(8, controls)
        self.assertIsInstance(controls[8], VehicleInput)


if __name__ == "__main__":
    unittest.main()
