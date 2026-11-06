import importlib.util
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")

HAS_PYGAME = importlib.util.find_spec("pygame") is not None


@unittest.skipUnless(HAS_PYGAME, "pygame no está instalado")
class OasisAppSmokeTests(unittest.TestCase):
    def test_garage_layout_and_live_customization(self):
        from neonrush.app import NeonApp

        with tempfile.TemporaryDirectory() as folder:
            profile_path = Path(folder) / "profile.json"
            with mock.patch.dict(
                os.environ, {"NEONRUSH_PROFILE": str(profile_path)}
            ):
                app = NeonApp(
                    asset_delay=0.01,
                    enable_audio=False,
                    skip_tutorial=True,
                )
                try:
                    app._set_state("garage")
                    rows = app._garage_row_rects()
                    self.assertEqual(len(rows), 7)
                    for index, row in enumerate(rows):
                        self.assertTrue(
                            all(not row.colliderect(other) for other in rows[index + 1 :])
                        )
                        self.assertFalse(row.colliderect(app._garage_back_rect()))
                        self.assertFalse(row.colliderect(app._garage_ready_rect()))

                    original_paint = app.car_color
                    app.garage_row = 3
                    app._cycle_garage(1)
                    self.assertNotEqual(app.car_color, original_paint)
                    self.assertEqual(app.profile.car_color, app.car_color)

                    app.garage_row = 4
                    app._cycle_garage(1)
                    self.assertEqual(app.profile.outfit_color, app.outfit_color)

                    app.garage_row = 5
                    app._cycle_garage(1)
                    self.assertEqual(app.track_style, "synth")
                    self.assertEqual(app.profile.track_style, "synth")
                    app.garage_row = 6
                    app._cycle_garage(1)
                    self.assertEqual(app.rim_style, "turbine")
                    self.assertEqual(app.profile.rim_style, "turbine")
                    app._draw()
                finally:
                    app.close()

    def test_screens_and_loading_transition(self):
        from neonrush.app import NeonApp

        with tempfile.TemporaryDirectory() as folder:
            profile_path = Path(folder) / "profile.json"
            with mock.patch.dict(
                os.environ, {"NEONRUSH_PROFILE": str(profile_path)}
            ):
                app = NeonApp(
                    asset_delay=0.01,
                    enable_audio=False,
                    skip_tutorial=True,
                )
                try:
                    for state in (
                        "title",
                        "tutorial",
                        "menu",
                        "championship_map",
                        "shop",
                        "garage",
                        "loading",
                        "results",
                    ):
                        app._set_state(state)
                        app._draw()
                    app._set_state("title")
                    app._enter_oasis()
                    self.assertEqual(app.state, "transition")
                    self.assertEqual(app._camera_target, 1.0)
                    app._update_camera(0.1)
                    self.assertGreater(app._camera_blend, 0.0)
                    self.assertLess(app._camera_blend, 1.0)
                    app._draw()
                    app._finish_transition()
                    self.assertEqual(app.state, "menu")
                    app._start_loading(app.mode)
                    app._begin_race = lambda: app._set_state("results")
                    deadline = time.monotonic() + 3.0
                    while (
                        app.state == "loading" and time.monotonic() < deadline
                    ):
                        app._update_loading()
                        time.sleep(0.01)
                    self.assertEqual(app.state, "results")
                finally:
                    app.close()

    def test_hub_progression_shop_and_hex_paint_editing(self):
        import pygame

        from neonrush.app import NeonApp
        from neonrush.app import SHOP_ITEMS

        with tempfile.TemporaryDirectory() as folder:
            profile_path = Path(folder) / "profile.json"
            with mock.patch.dict(
                os.environ, {"NEONRUSH_PROFILE": str(profile_path)}
            ):
                app = NeonApp(
                    asset_delay=0.01,
                    enable_audio=False,
                    skip_tutorial=True,
                )
                try:
                    app.profile.trophies = 0
                    app._set_state("championship_map")
                    app._select_championship_level(1)
                    self.assertEqual(app.state, "championship_map")
                    self.assertIn("3 trofeos", app.error)

                    app.profile.trophies = 3
                    app._select_championship_level(1)
                    self.assertEqual(app.state, "garage")
                    self.assertEqual(app._selected_championship_track, "cyber_desert")
                    self.assertEqual(app.track_style, "cyber_desert")

                    app.profile.coins = 150
                    app._set_state("shop")
                    app._activate_shop_item(0)
                    self.assertEqual(app.car_color, SHOP_ITEMS[0][2])
                    self.assertEqual(app.profile.coins, 30)

                    app._set_state("garage")
                    app.garage_row = 3
                    app._start_hex_edit()
                    app._handle_event(
                        pygame.event.Event(pygame.TEXTINPUT, text="12Gabcd")
                    )
                    app._handle_event(
                        pygame.event.Event(pygame.KEYDOWN, key=pygame.K_RETURN)
                    )
                    self.assertFalse(app.hex_editing)
                    self.assertEqual(app.car_color, "#12abcd")
                    self.assertEqual(app.profile.car_color, "#12abcd")
                    app._set_state("menu")
                    app._activate_main_menu(4)
                    self.assertEqual(app.state, "challenges")
                    app._draw()
                finally:
                    app.close()

    def test_distributed_preflight_runs_during_loading_and_is_cleaned_up(self):
        from neonrush.app import NeonApp

        with tempfile.TemporaryDirectory() as folder:
            profile_path = Path(folder) / "profile.json"
            with mock.patch.dict(
                os.environ, {"NEONRUSH_PROFILE": str(profile_path)}
            ):
                app = NeonApp(
                    asset_delay=0.01,
                    enable_audio=False,
                    skip_tutorial=True,
                    mode_id="multiplayer",
                )
                try:
                    app._start_loading(app.mode)
                    future = app._network_future
                    self.assertIsNotNone(future)
                    session = future.result(timeout=10.0)
                    self.assertTrue(session[1]._welcome_event.is_set())
                    app._cancel_loading()
                    self.assertIsNone(app._network_future)
                    self.assertFalse(session[2].is_alive())
                finally:
                    app.close()

    def test_embedded_renderer_reuses_the_application_surface(self):
        import pygame

        from neonrush.render.pygame_renderer import PygameRenderer
        from neonrush.track import Track

        pygame.init()
        surface = pygame.display.set_mode((1280, 720))
        with mock.patch.object(
            pygame.display,
            "set_mode",
            side_effect=AssertionError("embedded render must not recreate display"),
        ):
            renderer = PygameRenderer(Track.oval(), screen=surface)
        try:
            self.assertIs(renderer.screen, surface)
            with mock.patch.object(pygame, "quit") as quit_pygame:
                renderer.close()
                quit_pygame.assert_not_called()
        finally:
            pygame.quit()


@unittest.skipUnless(HAS_PYGAME, "pygame no está instalado")
class PygameRendererSmokeTests(unittest.TestCase):
    def test_live_tutorial_advances_without_pausing_the_race(self):
        from neonrush.render.pygame_renderer import PygameRenderer
        from neonrush.track import Track
        from neonrush.world import RaceWorld, make_player_specs

        track = Track.oval()
        snapshot = RaceWorld(track, make_player_specs(["P1"])).snapshot()
        vehicle = snapshot["vehicles"][0]
        renderer = PygameRenderer(track, interactive_tutorial=True)
        try:
            vehicle["throttle"] = 1.0
            renderer.draw(snapshot, [1])
            self.assertTrue(renderer._live_tutorial_completed[0])

            vehicle["steer"] = 0.5
            renderer.draw(snapshot, [1])
            self.assertTrue(renderer._live_tutorial_completed[1])

            vehicle["off_track"] = False
            renderer.draw(snapshot, [1])
            self.assertTrue(renderer._live_tutorial_completed[2])

            vehicle["turbo_active"] = True
            renderer.draw(snapshot, [1])
            self.assertFalse(renderer._live_tutorial_active)
        finally:
            renderer.close()

    def test_renderer_uses_one_fixed_top_down_camera(self):
        import pygame

        from neonrush.render.pygame_renderer import PygameRenderer
        from neonrush.track import Track
        from neonrush.world import RaceWorld, make_player_specs

        track = Track.oval()
        snapshot = RaceWorld(track, make_player_specs(["P1"])).snapshot()
        renderer = PygameRenderer(track)
        try:
            renderer.draw(snapshot, [1])
            pygame.event.post(
                pygame.event.Event(pygame.KEYDOWN, key=pygame.K_c)
            )
            renderer.poll_inputs(None)
            self.assertEqual(renderer.camera_mode, "TOP-DOWN")
            renderer.draw(snapshot, [1])
        finally:
            renderer.close()

    def test_lobby_split_screen_and_single_view(self):
        from neonrush.config import RaceConfig
        from neonrush.render.pygame_renderer import PygameRenderer
        from neonrush.track import Track
        from neonrush.world import RaceWorld, make_player_specs

        track = Track.oval()
        world = RaceWorld(
            track, make_player_specs(["P1", "P2"]), RaceConfig(laps=2)
        )
        renderer = PygameRenderer(track, "NEON RUSH | TEST")
        try:
            renderer.draw_lobby("CARGANDO ASSETS", 0.5, "P1 2/4 · P2 2/4")
            for _ in range(4):
                world.step(1.0 / 60.0)
            snapshot = world.snapshot()
            renderer.draw(snapshot, [1, 2])
            renderer.draw(snapshot, [1])
        finally:
            renderer.close()
if __name__ == "__main__":
    unittest.main()
