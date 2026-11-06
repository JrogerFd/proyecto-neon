import math
import json
import os
import socket
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

from neonrush.ai import autopilot_control
from neonrush.asset_manager import AssetManager, AssetSpec
from neonrush.config import PhysicsConfig, RaceConfig
from neonrush.content import (
    MODES_BY_ID,
    Profile,
    build_track,
    get_loadout,
    make_race_players,
    rival_loadout,
)
from neonrush.interpolation import SnapshotBuffer
from neonrush.physics import PhysicsEngine, VehicleInput
from neonrush.protocol import ChannelTimeout, ConnectionClosed, JsonChannel, Msg, make_message
from neonrush.session import SimulationLoop
from neonrush.track import Track
from neonrush.world import RaceWorld, make_player_specs
from neonrush.worker import WorkerClient


class TrackTests(unittest.TestCase):
    def test_progress_roundtrip(self):
        track = Track.oval()
        for progress in (0.0, 0.1, 0.25, 0.5, 0.75, 0.99):
            x, y = track.point_at(progress)
            found, offset = track.progress_and_offset(x, y)
            self.assertAlmostEqual(found, progress, places=5)
            self.assertAlmostEqual(offset, 0.0, places=4)

    def test_start_grid_stays_near_track(self):
        track = Track.oval()
        for slot in range(4):
            x, y, heading, progress = track.start_pose(slot)
            _, offset = track.progress_and_offset(x, y)
            self.assertLess(offset, track.width * 0.5)
            self.assertIsInstance(heading, float)
            self.assertGreaterEqual(progress, 0.0)


    def test_procedural_track_is_deterministic(self):
        first = Track.procedural("synth")
        second = Track.procedural("synth")
        self.assertEqual(first, second)
        self.assertEqual(first.style, "synth")
        self.assertNotEqual(first.name, Track.oval().name)
        self.assertNotEqual(first, Track.procedural("void"))

    def test_track_is_flat_static_and_round_trips(self):
        track = Track.procedural("void", seed=731)
        restored = Track.from_dict(track.to_dict())
        self.assertEqual(restored, track)
        for removed_feature in (
            "height_at", "grade_at", "bank_at", "ramp_at", "ramp_centers",
            "obstacles_at", "branches", "boost_zones",
        ):
            self.assertFalse(hasattr(track, removed_feature))

    def test_styles_share_the_same_fixed_racing_line(self):
        baseline = Track.procedural("neon_city")
        for style in ("cyber_desert", "plasma_circuit", "jungle", "synth", "code", "void"):
            track = Track.procedural(style, seed=9821)
            for progress in (0.0, 0.1, 0.25, 0.5, 0.75, 0.99):
                self.assertEqual(track.point_at(progress), baseline.point_at(progress))

    def test_fixed_racing_line_has_no_self_intersections(self):
        track = Track.oval()
        points = [track.point_at(index / 192) for index in range(192)]

        def orientation(a, b, c):
            return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

        for first in range(len(points)):
            a, b = points[first], points[(first + 1) % len(points)]
            for second in range(first + 2, len(points)):
                if first == 0 and second == len(points) - 1:
                    continue
                c, d = points[second], points[(second + 1) % len(points)]
                crossing = (
                    orientation(a, b, c) * orientation(a, b, d) < 0
                    and orientation(c, d, a) * orientation(c, d, b) < 0
                )
                self.assertFalse(crossing, f"segments {first} and {second} cross")

    def test_championship_tracks_are_fixed_broad_closed_circuits(self):
        for style in ("jungle", "canyon", "cyberpunk"):
            track = Track.procedural(style)
            self.assertEqual(track.width, 168.0)
            self.assertEqual(track, Track.procedural(style))
            self.assertEqual(track.point_at(0.0), track.point_at(1.0))
            for progress in (0.0, 0.1, 0.25, 0.5, 0.75, 0.99):
                x, y = track.point_at(progress)
                found, offset = track.progress_and_offset(
                    x, y, reference_progress=progress
                )
                self.assertAlmostEqual(found, progress, places=3)
                self.assertLess(offset, 0.1)

    def test_warped_track_projection_roundtrips(self):
        track = Track.procedural("synth", seed=17)
        for progress in (0.0, 0.1, 0.25, 0.5, 0.75, 0.99):
            x, y = track.point_at(progress)
            found, offset = track.progress_and_offset(x, y)
            self.assertAlmostEqual(found, progress, places=4)
            self.assertLess(offset, 0.1)

    def test_track_serialization_roundtrip(self):
        track = Track.procedural("code", seed=1234)
        restored = Track.from_dict(track.to_dict())
        self.assertEqual(track, restored)
        self.assertEqual(restored.style, "code")


class ContentTests(unittest.TestCase):
    def test_loadout_changes_physics(self):
        fast = get_loadout("vyper", "wraith", "overdrive")
        precise = get_loadout("nova", "chronos", "apex")
        self.assertGreater(fast.physics().max_speed, 0.0)
        self.assertNotEqual(fast.physics().max_speed, precise.physics().max_speed)
        self.assertNotEqual(fast.physics().turn_rate, precise.physics().turn_rate)

    def test_physics_serialization_roundtrip(self):
        original = get_loadout("kilo", "ronin", "ghost").physics()
        restored = PhysicsConfig.from_dict(original.to_dict())
        self.assertEqual(original, restored)

    def test_race_players_include_ai_rival(self):
        loadout = get_loadout()
        for mode_id in ("short", "championship", "normal"):
            players = make_race_players(loadout, MODES_BY_ID[mode_id])
            self.assertEqual(len(players), 2)
            self.assertEqual(players[1].player_id, 2)
            self.assertNotEqual(players[0].physics, players[1].physics)
        multiplayer = make_race_players(loadout, MODES_BY_ID["multiplayer"])
        self.assertEqual(len(multiplayer), 1)

    def test_rival_loadout_is_different(self):
        loadout = get_loadout()
        rival = rival_loadout(loadout)
        self.assertNotEqual(loadout.character.id, rival.character.id)
        self.assertNotEqual(loadout.vehicle.id, rival.vehicle.id)
        self.assertNotEqual(loadout.power.id, rival.power.id)

    def test_build_track_uses_character_style(self):
        loadout = get_loadout("vyper")
        track = build_track(loadout, seed=9)
        self.assertEqual(track.style, loadout.character.style)
        self.assertEqual(build_track(loadout, style="void").style, "void")

    def test_profile_roundtrip_and_results(self):
        previous = os.environ.get("NEONRUSH_PROFILE")
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "profile.json"
            os.environ["NEONRUSH_PROFILE"] = str(path)
            try:
                profile = Profile.load(path)
                self.assertFalse(profile.tutorial_seen)

                profile.tutorial_seen = True
                profile.apply_loadout(get_loadout("nova", "chronos", "pulse"))
                profile.car_color = "#ff2e88"
                profile.outfit_color = "#00ffa3"
                profile.track_style = "synth"
                profile.save(path)
                loaded = Profile.load(path)
                self.assertTrue(loaded.tutorial_seen)
                self.assertEqual(loaded.character_id, "nova")
                self.assertEqual(loaded.vehicle_id, "chronos")
                self.assertEqual(loaded.power_id, "pulse")
                self.assertEqual(loaded.car_color, "#ff2e88")
                self.assertEqual(loaded.outfit_color, "#00ffa3")
                self.assertEqual(loaded.track_style, "synth")

                mode = MODES_BY_ID["championship"]
                loaded.daily_missions = {
                    "date": datetime.now(timezone.utc).date().isoformat(),
                    "missions": [],
                    "processed_event_ids": [],
                }
                result = [
                    {
                        "id": 1,
                        "placement": 1,
                        "finished": True,
                        "best_lap": 12.5,
                        "laps_completed": 3,
                    }
                ]
                self.assertTrue(
                    loaded.record_result(
                        result,
                        mode,
                        result_id="race-test-1",
                        track_key="neon_city",
                    )
                )
                self.assertFalse(
                    loaded.record_result(
                        result,
                        mode,
                        result_id="race-test-1",
                        track_key="neon_city",
                    )
                )
                self.assertEqual(loaded.races, 1)
                self.assertEqual(loaded.wins, 1)
                self.assertEqual(loaded.points, 15)
                self.assertEqual(loaded.trophies, 1)
                self.assertEqual(loaded.coins, 600)
                self.assertEqual(loaded.total_coins_earned, 600)
                self.assertEqual(loaded.diamonds, 0)
                self.assertEqual(loaded.level, 2)
                self.assertEqual(loaded.best_lap, 12.5)
                self.assertEqual(Profile.load(path).points, 15)
                self.assertTrue(
                    loaded.purchase_cosmetic("paint_jade", price=120, currency="coins")
                )
                self.assertEqual(loaded.coins, 480)
                self.assertFalse(
                    loaded.purchase_cosmetic("suit_oracle", price=2, currency="diamonds")
                )
                self.assertFalse(
                    loaded.purchase_cosmetic("paint_jade", price=120, currency="coins")
                )
                self.assertFalse(
                    loaded.purchase_cosmetic("paint_solar", price=1, currency="coins")
                )
                self.assertEqual(loaded.coins, 480)
                self.assertIn("paint_jade", Profile.load(path).owned_cosmetics)
            finally:
                if previous is None:
                    os.environ.pop("NEONRUSH_PROFILE", None)
                else:
                    os.environ["NEONRUSH_PROFILE"] = previous

    def test_daily_missions_are_stable_for_the_utc_day(self):
        profile = Profile()
        first_day = datetime(2026, 11, 6, 8, tzinfo=timezone.utc)
        first = profile.ensure_daily_missions(first_day)
        repeated = profile.ensure_daily_missions(first_day.replace(hour=21))
        self.assertEqual(first, repeated)
        self.assertEqual(len(first["missions"]), 3)
        next_day = profile.ensure_daily_missions(datetime(2026, 11, 7, tzinfo=timezone.utc))
        self.assertNotEqual(first["date"], next_day["date"])
        self.assertTrue(all(item["progress"] == 0 for item in next_day["missions"]))

    def test_daily_mission_rewards_and_race_rewards_are_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "profile.json"
            previous = os.environ.get("NEONRUSH_PROFILE")
            if previous is None:
                self.addCleanup(os.environ.pop, "NEONRUSH_PROFILE", None)
            else:
                self.addCleanup(os.environ.__setitem__, "NEONRUSH_PROFILE", previous)
            os.environ["NEONRUSH_PROFILE"] = str(path)
            profile = Profile()
            today = datetime.now(timezone.utc).date().isoformat()
            profile.daily_missions = {
                "date": today,
                "processed_event_ids": [],
                "missions": [
                    {"id": "finish_race", "target": 1, "progress": 0, "reward": 50, "status": "active"},
                    {"id": "clean_race", "target": 1, "progress": 0, "reward": 80, "status": "active"},
                    {"id": "win_race", "target": 1, "progress": 0, "reward": 75, "status": "active"},
                ],
            }
            result = [{
                "id": 1,
                "placement": 1,
                "finished": True,
                "best_lap": 30.0,
                "finish_time": 90.0,
                "laps_completed": 3,
                "collisions": 0,
                "jumps_completed": 0,
            }]
            self.assertTrue(profile.record_result(
                result, MODES_BY_ID["short"], result_id="daily-result-1",
                track_key="neon_city",
            ))
            self.assertFalse(profile.record_result(
                result, MODES_BY_ID["short"], result_id="daily-result-1",
                track_key="neon_city",
            ))
            self.assertEqual(profile.coins, 805)
            self.assertEqual(profile.total_coins_earned, 805)
            self.assertEqual(profile.statistics["challenges_completed"], 3)
            self.assertEqual(profile.statistics["jumps_completed"], 0)
            self.assertEqual(profile.level, 3)
            self.assertEqual(profile.transactions[-1]["currency"], "NC")
            profile.save(path)
            self.assertEqual(Profile.load(path).coins, 805)

    def test_neon_cup_uses_actual_results_and_awards_once(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / "profile.json"
        previous = os.environ.get("NEONRUSH_PROFILE")
        if previous is None:
            self.addCleanup(os.environ.pop, "NEONRUSH_PROFILE", None)
        else:
            self.addCleanup(os.environ.__setitem__, "NEONRUSH_PROFILE", previous)
        os.environ["NEONRUSH_PROFILE"] = str(path)
        profile = Profile()
        profile.daily_missions = {
            "date": datetime.now(timezone.utc).date().isoformat(),
            "processed_event_ids": [],
            "missions": [],
        }
        mode = MODES_BY_ID["championship"]
        for index, track_key in enumerate(("neon_city", "cyber_desert", "plasma_circuit")):
            profile.record_result(
                [
                    {"id": 1, "name": "PILOTO", "placement": 1, "finished": True},
                    {"id": 2, "name": "RIVAL IA", "placement": 2, "finished": True},
                ],
                mode,
                result_id=f"cup-race-{index}",
                track_key=track_key,
            )
        self.assertEqual(profile.championship["status"], "completed")
        self.assertEqual(profile.championship["standings"]["1"]["points"], 45)
        self.assertEqual(profile.championship["standings"]["2"]["points"], 36)
        self.assertEqual(profile.championship["champion"], "PILOTO")
        self.assertEqual(profile.coins, 2800)
        self.assertEqual(profile.statistics["championships_won"], 1)

    def test_abandoned_race_does_not_award_coins_or_win_xp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / "profile.json"
        previous = os.environ.get("NEONRUSH_PROFILE")
        if previous is None:
            self.addCleanup(os.environ.pop, "NEONRUSH_PROFILE", None)
        else:
            self.addCleanup(os.environ.__setitem__, "NEONRUSH_PROFILE", previous)
        os.environ["NEONRUSH_PROFILE"] = str(path)
        profile = Profile()
        profile.daily_missions = {
            "date": datetime.now(timezone.utc).date().isoformat(),
            "processed_event_ids": [],
            "missions": [],
        }
        profile.record_result(
            [{"id": 1, "placement": 1, "finished": False, "collisions": 2}],
            MODES_BY_ID["short"],
            result_id="abandoned-race",
        )
        self.assertEqual(profile.coins, 0)
        self.assertEqual(profile.wins, 0)
        self.assertEqual(profile.experience, 0)
        self.assertEqual(profile.statistics["abandoned_races"], 1)
        self.assertEqual(profile.statistics["collisions"], 2)

    def test_neon_coin_payouts_match_final_placement(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / "profile.json"
        previous = os.environ.get("NEONRUSH_PROFILE")
        if previous is None:
            self.addCleanup(os.environ.pop, "NEONRUSH_PROFILE", None)
        else:
            self.addCleanup(os.environ.__setitem__, "NEONRUSH_PROFILE", previous)
        os.environ["NEONRUSH_PROFILE"] = str(path)
        profile = Profile()
        profile.daily_missions = {
            "date": datetime.now(timezone.utc).date().isoformat(),
            "processed_event_ids": [],
            "missions": [],
        }
        expected = (600, 400, 300, 200)
        for placement, total in enumerate(expected, start=1):
            before = profile.coins
            profile.record_result(
                [{
                    "id": 1,
                    "placement": placement,
                    "finished": True,
                    "laps_completed": 1,
                }],
                MODES_BY_ID["short"],
                result_id=f"payout-{placement}",
            )
            self.assertEqual(profile.coins - before, total)

    def test_profile_migration_sanitizes_corrupt_optional_fields(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "profile.json"
            path.write_text(json.dumps({
                "coins": -40,
                "wins": "invalid",
                "tutorial_seen": "false",
                "owned_cosmetics": "not-a-list",
                "statistics": [],
                "daily_missions": {
                    "date": "2026-11-06",
                    "missions": [{"id": "clean_race"}],
                },
                "championship": {"standings": {"1": ["invalid"]}},
            }), encoding="utf-8")
            profile = Profile.load(path)
            self.assertEqual(profile.schema_version, 2)
            self.assertEqual(profile.coins, 0)
            self.assertEqual(profile.wins, 0)
            self.assertFalse(profile.tutorial_seen)
            self.assertEqual(profile.owned_cosmetics, [])
            self.assertEqual(profile.statistics, {})
            self.assertEqual(profile.daily_missions["missions"][0]["target"], 1)
            self.assertEqual(profile.championship["standings"], {})


class PhysicsAndWorldTests(unittest.TestCase):
    def test_autopilot_completes_each_fixed_flat_circuit(self):
        for style in ("neon_city", "cyber_desert", "plasma_circuit"):
            with self.subTest(track=style):
                track = Track.procedural(style)
                world = RaceWorld(
                    track,
                    make_player_specs(["AI"]),
                    RaceConfig(laps=1),
                )
                dt = 1.0 / 120.0
                for _ in range(120 * 180):
                    for vehicle in world.snapshot()["vehicles"]:
                        world.set_input(
                            vehicle["id"], autopilot_control(vehicle, track)
                        )
                    world.step(dt)
                    if world.all_finished():
                        break
                result = world.results()[0]
                self.assertTrue(result["finished"])
                self.assertEqual(result["laps_completed"], 1)
                self.assertEqual(result["jumps_completed"], 0)

    def test_autopilot_completes_laps(self):
        track = Track.oval()
        config = RaceConfig(laps=2)
        world = RaceWorld(track, make_player_specs(["AI"]), config)
        dt = 1.0 / 120.0
        for _ in range(120 * 60):
            snapshot = world.snapshot()
            for vehicle in snapshot["vehicles"]:
                world.set_input(
                    vehicle["id"], autopilot_control(vehicle, track)
                )
            world.step(dt)
            if world.all_finished():
                break
        snapshot = world.snapshot()
        self.assertTrue(snapshot["vehicles"][0]["finished"])
        self.assertEqual(snapshot["vehicles"][0]["lap"], 2)
        self.assertIsNotNone(snapshot["vehicles"][0]["best_lap"])
        self.assertTrue(
            all(
                isinstance(value, float)
                for value in snapshot["vehicles"][0]["sector_times"]
            )
        )

    def test_concurrent_inputs_and_snapshots(self):
        track = Track.oval()
        world = RaceWorld(
            track, make_player_specs(["A", "B"]), RaceConfig(laps=20)
        )
        stop = threading.Event()
        errors: list[BaseException] = []

        def stepper():
            try:
                while not stop.is_set():
                    world.step(1.0 / 120.0)
                    time.sleep(0.0005)
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)

        def writer(player_id: int):
            try:
                while not stop.is_set():
                    world.set_input(
                        player_id, VehicleInput(throttle=1.0, steer=0.1)
                    )
                    snapshot = world.snapshot()
                    if len(snapshot["vehicles"]) != 2:
                        raise AssertionError("snapshot inconsistente")
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [
            threading.Thread(target=stepper),
            threading.Thread(target=writer, args=(1,)),
            threading.Thread(target=writer, args=(2,)),
        ]
        for thread in threads:
            thread.start()
        time.sleep(0.35)
        stop.set()
        for thread in threads:
            thread.join(timeout=2.0)

        self.assertEqual(errors, [])
        for vehicle in world.snapshot()["vehicles"]:
            self.assertIsInstance(vehicle["x"], float)
            self.assertIsInstance(vehicle["y"], float)


class ArcadeMechanicsTests(unittest.TestCase):
    def test_controls_preserve_arcade_actions_over_wire_format(self):
        control = VehicleInput(throttle=0.8, steer=-0.4, turbo=True, use_power=True)
        restored = VehicleInput.from_dict(control.to_dict())
        self.assertTrue(restored.turbo)
        self.assertTrue(restored.use_power)
        self.assertEqual(restored.throttle, 0.8)
        self.assertEqual(restored.steer, -0.4)

    def test_physics_substeps_hold_vehicle_inside_track_at_high_speed(self):
        track = Track.procedural("jungle")
        x, y, heading, progress = track.start_pose(0)
        vehicle = RaceWorld(track, make_player_specs(["P1"]))._vehicles[1]
        vehicle.x, vehicle.y = x, y
        vehicle.heading = heading
        vehicle.progress = progress
        vehicle.speed = 700.0
        vehicle.turbo_charge = 100.0

        PhysicsEngine().step(
            vehicle,
            VehicleInput(throttle=1.0, steer=0.8, turbo=True),
            1.0 / 30.0,
            track,
            1.0 / 30.0,
        )

        found_progress, offset = track.progress_and_offset(vehicle.x, vehicle.y)
        self.assertAlmostEqual(vehicle.progress, found_progress, places=5)
        self.assertLessEqual(offset, track.width * 0.5 - 30.0 + 0.1)

    def test_physics_rejects_non_positive_delta(self):
        track = Track.oval()
        vehicle = RaceWorld(track, make_player_specs(["P1"]))._vehicles[1]
        with self.assertRaises(ValueError):
            PhysicsEngine().step(vehicle, VehicleInput.neutral(), -0.01, track, 0.0)

    def test_turbo_drift_charges_without_boost_zones(self):
        track = Track.oval()
        world = RaceWorld(track, make_player_specs(["P1"]))
        vehicle = world._vehicles[1]
        engine = PhysicsEngine()

        vehicle.progress = 0.35
        vehicle.x, vehicle.y = track.point_at(vehicle.progress)
        vehicle.heading = track.heading_at(vehicle.progress)
        vehicle.speed = 100.0
        vehicle.turbo_charge = 100.0
        engine.step(
            vehicle,
            VehicleInput(throttle=1.0, turbo=True),
            1.0 / 60.0,
            track,
            0.1,
        )
        self.assertTrue(vehicle.turbo_active)
        self.assertLess(vehicle.turbo_charge, 100.0)

        vehicle.progress = 0.35
        vehicle.x, vehicle.y = track.point_at(vehicle.progress)
        vehicle.heading = track.heading_at(vehicle.progress)
        vehicle.speed = 100.0
        vehicle.turbo_charge = 20.0
        engine.step(
            vehicle,
            VehicleInput(throttle=1.0, steer=0.8),
            1.0 / 60.0,
            track,
            0.2,
        )
        self.assertTrue(vehicle.drifting)
        self.assertGreater(vehicle.turbo_charge, 20.0)


    def test_vehicle_cannot_leave_the_driveable_track_width(self):
        track = Track.oval()
        world = RaceWorld(track, make_player_specs(["P1"]))
        vehicle = world._vehicles[1]
        progress = 0.25
        x, y = track.point_at(progress)
        heading = track.heading_at(progress)
        vehicle.progress = progress
        vehicle.heading = heading
        vehicle.x = x - math.sin(heading) * 100.0
        vehicle.y = y + math.cos(heading) * 100.0
        PhysicsEngine().step(vehicle, VehicleInput(), 1.0 / 60.0, track, 0.1)
        _, offset = track.progress_and_offset(vehicle.x, vehicle.y)
        safe_limit = track.width * 0.5 - PhysicsEngine().config.vehicle_half_width
        self.assertLessEqual(offset, safe_limit + 0.1)
        self.assertTrue(vehicle.off_track)

    def test_collision_clamps_vehicle_to_flat_track_edges(self):
        track = Track.procedural("neon_city")
        world = RaceWorld(track, make_player_specs(["P1"]))
        vehicle = world._vehicles[1]
        progress = 0.25
        x, y = track.point_at(progress)
        heading = track.heading_at(progress)
        vehicle.x = x - math.sin(heading) * track.width
        vehicle.y = y + math.cos(heading) * track.width
        vehicle.progress = progress
        vehicle.speed = 300.0
        world.step(0.0)
        _, offset = track.progress_and_offset(
            vehicle.x, vehicle.y, reference_progress=progress
        )
        self.assertLessEqual(
            offset,
            track.width * 0.5 - PhysicsEngine().config.vehicle_half_width + 0.1,
        )
        self.assertTrue(vehicle.off_track)
        self.assertNotIn("obstacles", world.snapshot())

    def test_powerups_are_deterministic_collectible_and_activatable(self):
        track = Track.procedural("synth", seed=77)
        world = RaceWorld(track, make_player_specs(["P1"]))
        mirror = RaceWorld(track, make_player_specs(["P1"]))
        self.assertEqual(
            [(item.progress, item.offset, item.power) for item in world._powerups],
            [(item.progress, item.offset, item.power) for item in mirror._powerups],
        )
        pickup = world._powerups[0]
        pickup.power = "shield"
        vehicle = world._vehicles[1]
        x, y = track.point_at(pickup.progress)
        heading = track.heading_at(pickup.progress)
        vehicle.x = x - math.sin(heading) * pickup.offset
        vehicle.y = y + math.cos(heading) * pickup.offset
        vehicle.progress = pickup.progress
        world.step(0.0)
        self.assertEqual(world.snapshot()["vehicles"][0]["power_up"], "shield")
        self.assertEqual(len(world.snapshot()["powerups"]), 9)

        world.set_input(1, VehicleInput(use_power=True))
        world.step(0.0)
        self.assertTrue(world.snapshot()["vehicles"][0]["shield"])
        self.assertFalse(world._inputs[1].use_power)

    def test_missile_hits_the_nearest_unshielded_rival_ahead(self):
        track = Track.oval()
        world = RaceWorld(track, make_player_specs(["P1", "P2"]))
        world._powerups.clear()
        attacker, target = world._vehicles[1], world._vehicles[2]
        attacker.progress = 0.20
        attacker.x, attacker.y = track.point_at(attacker.progress)
        attacker.power_up = "missile"
        target.progress = 0.24
        target.x, target.y = track.point_at(target.progress)
        target.speed = 200.0
        world.set_input(1, VehicleInput(use_power=True))
        world.step(0.0)
        self.assertAlmostEqual(target.speed, 110.0)
        self.assertTrue(world.snapshot()["vehicles"][1]["missile_hit"])

    def test_warp_keeps_its_speed_bonus_for_the_effect_duration(self):
        track = Track.oval()
        world = RaceWorld(track, make_player_specs(["P1"]))
        world._powerups.clear()
        vehicle = world._vehicles[1]
        vehicle.progress = 0.3
        vehicle.x, vehicle.y = track.point_at(vehicle.progress)
        vehicle.heading = track.heading_at(vehicle.progress)
        vehicle.speed = 500.0
        vehicle.power_up = "warp"
        world.set_input(1, VehicleInput(use_power=True))
        world.step(0.0)
        self.assertGreater(vehicle.speed, world._physics[1].config.max_speed)

        world.set_input(1, VehicleInput())
        world.step(1.0 / 60.0)
        self.assertGreater(vehicle.speed, world._physics[1].config.max_speed)


class InterpolationTests(unittest.TestCase):
    @staticmethod
    def snapshot(race_time: float, x: float, heading: float = 0.0) -> dict:
        return {
            "race_time": race_time,
            "vehicles": [
                {
                    "id": 1,
                    "x": x,
                    "y": 0.0,
                    "heading": heading,
                    "speed": x,
                    "steer": 0.0,
                    "throttle": 0.0,
                    "brake": 0.0,
                    "progress": 0.0,
                }
            ],
        }

    def test_interpolates_between_snapshots(self):
        buffer = SnapshotBuffer(history=8, delay=0.05, max_extrapolation=0.05)
        buffer.push(self.snapshot(0.0, 0.0), received_at=0.0)
        buffer.push(self.snapshot(0.1, 100.0), received_at=0.1)
        sampled = buffer.sample(now=0.13)
        self.assertIsNotNone(sampled)
        self.assertAlmostEqual(sampled["vehicles"][0]["x"], 80.0, places=4)
        self.assertAlmostEqual(sampled["race_time"], 0.08, places=4)

    def test_extrapolation_is_capped(self):
        buffer = SnapshotBuffer(history=8, delay=0.0, max_extrapolation=0.085)
        buffer.push(self.snapshot(0.0, 0.0), received_at=0.0)
        buffer.push(self.snapshot(0.1, 100.0), received_at=0.1)
        sampled = buffer.sample(now=0.6)
        self.assertAlmostEqual(sampled["vehicles"][0]["x"], 185.0, places=4)

    def test_heading_interpolation_takes_short_angle(self):
        buffer = SnapshotBuffer(history=8, delay=0.0, max_extrapolation=0.05)
        buffer.push(self.snapshot(0.0, 0.0, heading=3.10), received_at=0.0)
        buffer.push(self.snapshot(0.1, 0.0, heading=-3.10), received_at=0.1)
        sampled = buffer.sample(now=0.05)
        heading = sampled["vehicles"][0]["heading"]
        self.assertGreater(abs(heading), 3.10)

    def test_latest_and_clear(self):
        buffer = SnapshotBuffer(history=8)
        self.assertIsNone(buffer.latest())
        buffer.push(self.snapshot(0.0, 1.0), received_at=0.0)
        buffer.push(self.snapshot(0.1, 2.0), received_at=0.1)
        self.assertEqual(buffer.latest()["vehicles"][0]["x"], 2.0)
        self.assertEqual(len(buffer), 2)
        buffer.clear()
        self.assertEqual(len(buffer), 0)


class AssetManagerTests(unittest.TestCase):
    def test_async_loading_and_progress(self):
        specs = [
            AssetSpec("a", load_seconds=0.05),
            AssetSpec("b", load_seconds=0.06),
            AssetSpec("c", load_seconds=0.04),
        ]
        manager = AssetManager(specs, max_workers=3, name="test")
        started = time.perf_counter()
        manager.start()
        self.assertLess(time.perf_counter() - started, 0.05)
        self.assertTrue(manager.wait(timeout=3.0))
        self.assertEqual(manager.progress(), (3, 3))
        self.assertEqual(set(manager.status_snapshot().values()), {"ready"})
        self.assertEqual(len(manager.assets), 3)

    def test_loader_exception_is_reported(self):
        def boom():
            raise RuntimeError("boom")

        manager = AssetManager(
            [AssetSpec("broken", loader=boom)], name="test-fail"
        )
        manager.start()
        self.assertFalse(manager.wait(timeout=2.0))
        self.assertIn("broken", manager.error or "")


class StartBarrierTests(unittest.TestCase):
    def test_physics_waits_for_start_event(self):
        track = Track.oval()
        world = RaceWorld(track, make_player_specs(["A"]), RaceConfig(laps=3))
        start = threading.Event()
        stop = threading.Event()
        snapshots = []
        sim = SimulationLoop(
            world,
            start_event=start,
            stop_event=stop,
            on_snapshot=snapshots.append,
        )
        sim.start()
        time.sleep(0.2)
        self.assertEqual(world.tick, 0)
        self.assertEqual(snapshots, [])

        start.set()
        time.sleep(0.25)
        self.assertGreater(world.tick, 0)
        self.assertGreaterEqual(len(snapshots), 1)

        stop.set()
        sim.join(timeout=2.0)
        self.assertFalse(sim.is_alive())

    def test_simulation_errors_reach_error_callback(self):
        world = RaceWorld(Track.oval(), make_player_specs(["A"]))
        errors: list[Exception] = []
        start = threading.Event()
        start.set()

        def fail_tick(world):
            self.assertEqual(world.status, "waiting")
            raise RuntimeError("compute failed")

        sim = SimulationLoop(
            world,
            start_event=start,
            on_tick=fail_tick,
            on_error=errors.append,
        )
        sim.start()
        sim.join(timeout=2.0)
        self.assertFalse(sim.is_alive())
        self.assertEqual(len(errors), 1)
        self.assertEqual(str(errors[0]), "compute failed")
        self.assertIs(sim.error, errors[0])


class ProtocolTests(unittest.TestCase):
    def test_channel_roundtrip_and_fragmentation(self):
        left, right = socket.socketpair()
        channel = JsonChannel(right)
        try:
            left.sendall(b'{"type":"PI')
            with self.assertRaises(ChannelTimeout):
                channel.recv(timeout=0.05)
            left.sendall(b'NG","value":7}\n')
            message = channel.recv(timeout=1.0)
            self.assertEqual(message, {"type": "PING", "value": 7})
        finally:
            channel.close()
            left.close()

    def test_channel_detects_eof(self):
        left, right = socket.socketpair()
        channel = JsonChannel(right)
        left.close()
        with self.assertRaises(ConnectionClosed):
            channel.recv(timeout=0.2)
        channel.close()

    def test_make_message(self):
        message = make_message(Msg.READY, done=4, total=4)
        self.assertEqual(message["type"], "READY")
        self.assertEqual(message["done"], 4)


class NetworkTelemetryTests(unittest.TestCase):
    def test_worker_updates_rtt_from_pong_timestamp(self):
        worker = WorkerClient()
        worker._handle_message(
            {"type": Msg.PONG.value, "sent_at": time.monotonic() - 0.02}
        )
        rtt_ms = worker.network_rtt_ms
        self.assertIsNotNone(rtt_ms)
        if rtt_ms is not None:
            self.assertGreater(rtt_ms, 0.0)


if __name__ == "__main__":
    unittest.main()
