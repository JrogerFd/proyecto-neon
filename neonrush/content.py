"""Contenido del OASIS: personajes, vehículos, poderes y modos de juego.

Este módulo es puro (sin Pygame ni red). La UI selecciona un ``Loadout`` y el
núcleo lo traduce a ``PhysicsConfig`` y ``PlayerSpec`` para que la simulación
siga siendo determinista y desacoplada del render.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import random
import tempfile
from datetime import datetime, timezone
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any

from .config import PhysicsConfig
from .track import Track
from .world import PlayerSpec

LOGGER = logging.getLogger("neonrush.profile")
PROFILE_SCHEMA_VERSION = 2
COSMETIC_CATALOG: dict[str, tuple[int, str]] = {
    "paint_jade": (120, "coins"),
    "paint_solar": (200, "coins"),
    "suit_oracle": (450, "coins"),
}
PLACEMENT_REWARDS = {1: 500, 2: 300, 3: 200, 4: 100}
CHAMPIONSHIP_TRACK_ORDER = ("neon_city", "cyber_desert", "plasma_circuit")
CHAMPIONSHIP_POINTS = {1: 15, 2: 12, 3: 10, 4: 8}
DAILY_MISSION_TEMPLATES = (
    ("finish_race", "Termina una carrera", 1, 50, "race.finished"),
    ("clean_race", "Termina una carrera sin colisiones", 1, 80, "race.finished"),
    ("win_race", "Gana una carrera", 1, 75, "race.finished"),
    ("valid_lap", "Completa una vuelta válida", 1, 45, "race.finished"),
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def experience_for_next_level(level: int) -> int:
    return 100 + max(0, level - 1) * 50


def _safe_count(value: Any, default: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    if isinstance(value, float) and not math.isfinite(value):
        return default
    return max(0, int(value))


@dataclass(frozen=True)
class Character:
    id: str
    name: str
    title: str
    color: str
    accent: str
    style: str
    description: str
    speed_mult: float = 1.0
    accel_mult: float = 1.0
    grip_mult: float = 1.0
    offtrack_mult: float = 1.0


@dataclass(frozen=True)
class Vehicle:
    id: str
    name: str
    class_name: str
    color: str
    description: str
    max_speed: float
    engine_accel: float
    turn_rate: float
    brake_decel: float


@dataclass(frozen=True)
class Power:
    id: str
    name: str
    glyph: str
    description: str
    speed_mult: float = 1.0
    accel_mult: float = 1.0
    grip_mult: float = 1.0
    brake_mult: float = 1.0
    offtrack_mult: float = 1.0


@dataclass(frozen=True)
class GameMode:
    id: str
    name: str
    subtitle: str
    description: str
    laps: int
    players: int
    distributed: bool
    championship: bool
    badge: str
    accent: str


@dataclass(frozen=True)
class Loadout:
    character: Character
    vehicle: Vehicle
    power: Power

    @property
    def color(self) -> str:
        return self.character.color

    @property
    def accent(self) -> str:
        return self.character.accent

    def physics(self, base: PhysicsConfig | None = None) -> PhysicsConfig:
        base = base or PhysicsConfig()
        return PhysicsConfig(
            max_speed=_clamp(
                base.max_speed
                * (self.vehicle.max_speed / 520.0)
                * self.character.speed_mult
                * self.power.speed_mult,
                320.0,
                680.0,
            ),
            reverse_speed=base.reverse_speed,
            engine_accel=_clamp(
                base.engine_accel
                * (self.vehicle.engine_accel / 320.0)
                * self.character.accel_mult
                * self.power.accel_mult,
                180.0,
                480.0,
            ),
            brake_decel=_clamp(
                base.brake_decel
                * (self.vehicle.brake_decel / 620.0)
                * self.power.brake_mult,
                420.0,
                820.0,
            ),
            drag=base.drag,
            rolling_resistance=base.rolling_resistance,
            off_track_drag=_clamp(
                base.off_track_drag
                * self.character.offtrack_mult
                * self.power.offtrack_mult,
                0.6,
                3.0,
            ),
            turn_rate=_clamp(
                base.turn_rate
                * (self.vehicle.turn_rate / 2.5)
                * self.character.grip_mult
                * self.power.grip_mult,
                1.6,
                4.2,
            ),
            min_turn_speed=base.min_turn_speed,
            wall_restitution=_clamp(base.wall_restitution + 0.05, 0.2, 0.8),
        )


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


CHARACTERS: tuple[Character, ...] = (
    Character(
        "aura",
        "AURA",
        "Piloto del núcleo",
        "#00e5ff",
        "#9d6bff",
        "neon",
        "Equilibrio perfecto entre velocidad y precisión. La favorita del OASIS.",
        1.0,
        1.0,
        1.06,
        0.9,
    ),
    Character(
        "vyper",
        "VYPER",
        "Fantasma del synth",
        "#ff2e88",
        "#ffb300",
        "synth",
        "Domina las rectas con un motor overclockeado, pero castiga cada error.",
        1.09,
        1.05,
        0.91,
        1.15,
    ),
    Character(
        "kilo",
        "KILO",
        "Hacker de pista",
        "#b6ff00",
        "#00ffa3",
        "code",
        "Especialista en aceleración y recuperación fuera de la línea holográfica.",
        0.98,
        1.14,
        1.0,
        0.68,
    ),
    Character(
        "nova",
        "NOVA",
        "Reina del vacío",
        "#ffb300",
        "#ff5c33",
        "void",
        "Piloto de precisión extrema: curva antes, acelera antes, nunca duda.",
        1.03,
        0.97,
        1.2,
        0.82,
    ),
)

VEHICLES: tuple[Vehicle, ...] = (
    Vehicle(
        "spectre",
        "SPECTRE GT",
        "Hiperdeportivo",
        "#00e5ff",
        "Chasis equilibrado con tracción total y firma luminosa de espectro.",
        540.0,
        330.0,
        2.6,
        640.0,
    ),
    Vehicle(
        "ronin",
        "RONIN X",
        "Drift",
        "#ff2e88",
        "Eje corto y dirección quirúrgica para encadenar curvas imposibles.",
        500.0,
        310.0,
        3.15,
        620.0,
    ),
    Vehicle(
        "wraith",
        "WRAITH 88",
        "Prototipo",
        "#9d6bff",
        "Velocidad punta brutal con un tren delantero que exige manos firmes.",
        565.0,
        290.0,
        2.35,
        610.0,
    ),
    Vehicle(
        "chronos",
        "CHRONOS",
        "Eléctrico",
        "#00ffa3",
        "Par instantáneo y frenada regenerativa para salir disparado de cada vértice.",
        515.0,
        355.0,
        2.75,
        680.0,
    ),
)

POWERS: tuple[Power, ...] = (
    Power(
        "overdrive",
        "OVERDRIVE",
        ">>",
        "Sobrecarga el motor: +8% velocidad punta y +10% aceleración.",
        speed_mult=1.08,
        accel_mult=1.1,
    ),
    Power(
        "apex",
        "APEX",
        "◇",
        "Asistente de trazada: +22% de respuesta de dirección.",
        grip_mult=1.22,
    ),
    Power(
        "ghost",
        "GHOST",
        "≋",
        "Fase de emergencia: reduce 45% la pérdida de velocidad fuera de pista.",
        offtrack_mult=0.55,
    ),
    Power(
        "pulse",
        "PULSE",
        "⚡",
        "Pulso cinético: +16% aceleración y +12% frenada.",
        accel_mult=1.16,
        brake_mult=1.12,
    ),
)

MODES: tuple[GameMode, ...] = (
    GameMode(
        "multiplayer",
        "MULTIJUGADOR",
        "Master-Worker · red TCP",
        "Sala autoritativa con preflight, snapshots y split-screen para dos pilotos.",
        2,
        2,
        True,
        False,
        "MASTER / WORKER",
        "#ff2e88",
    ),
    GameMode(
        "short",
        "CARRERA CORTA",
        "Sprint de una vuelta",
        "Entra, acelera y cruza la meta. Ideal para aprender la trazada.",
        1,
        1,
        False,
        False,
        "1 VUELTA",
        "#00e5ff",
    ),
    GameMode(
        "championship",
        "CAMPEONATO",
        "Gran premio del OASIS",
        "Tres vueltas a máxima intensidad. Los puntos se guardan en tu perfil.",
        3,
        1,
        False,
        True,
        "3 VUELTAS",
        "#ffb300",
    ),
    GameMode(
        "normal",
        "CARRERA NORMAL",
        "Duelo clásico",
        "Dos vueltas contra un rival controlado por la IA del OASIS.",
        2,
        1,
        False,
        False,
        "2 VUELTAS",
        "#b6ff00",
    ),
)

CHARACTERS_BY_ID = {item.id: item for item in CHARACTERS}
VEHICLES_BY_ID = {item.id: item for item in VEHICLES}
POWERS_BY_ID = {item.id: item for item in POWERS}
MODES_BY_ID = {item.id: item for item in MODES}

STYLE_GEOMETRY: dict[str, tuple[float, float, float]] = {
    "neon": (420.0, 230.0, 58.0),
    "synth": (470.0, 192.0, 62.0),
    "code": (390.0, 252.0, 52.0),
    "void": (442.0, 212.0, 66.0),
}


def get_loadout(
    character_id: str = "aura",
    vehicle_id: str = "spectre",
    power_id: str = "overdrive",
) -> Loadout:
    return Loadout(
        CHARACTERS_BY_ID.get(character_id, CHARACTERS[0]),
        VEHICLES_BY_ID.get(vehicle_id, VEHICLES[0]),
        POWERS_BY_ID.get(power_id, POWERS[0]),
    )


def rival_loadout(loadout: Loadout) -> Loadout:
    character = next(
        (item for item in CHARACTERS if item.id != loadout.character.id),
        CHARACTERS[1],
    )
    vehicle = next(
        (item for item in VEHICLES if item.id != loadout.vehicle.id),
        VEHICLES[2],
    )
    power = next(
        (item for item in POWERS if item.id != loadout.power.id),
        POWERS[1],
    )
    return Loadout(character, vehicle, power)


def build_track(
    loadout: Loadout,
    *,
    seed: int | None = None,
    style: str | None = None,
) -> Track:
    return Track.procedural(style or loadout.character.style, seed=seed)


def make_race_players(
    loadout: Loadout,
    mode: GameMode,
    rival: Loadout | None = None,
    *,
    player_color: str | None = None,
) -> list[PlayerSpec]:
    rival = rival or rival_loadout(loadout)
    players = [
        PlayerSpec(
            player_id=1,
            name=f"P1 {loadout.character.name}",
            color=player_color or loadout.color,
            physics=loadout.physics(),
        )
    ]
    if not mode.distributed:
        players.append(
            PlayerSpec(
                player_id=2,
                name=f"P2 {rival.character.name}",
                color=rival.color,
                physics=rival.physics(),
            )
        )
    return players


def default_profile_path() -> Path:
    override = os.environ.get("NEONRUSH_PROFILE")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".neonrush" / "profile.json"


@dataclass
class Profile:
    schema_version: int = PROFILE_SCHEMA_VERSION
    alias: str = "PILOTO"
    created_at: str = field(default_factory=_utc_now)
    tutorial_seen: bool = False
    character_id: str = "aura"
    vehicle_id: str = "spectre"
    power_id: str = "overdrive"
    car_color: str | None = None
    outfit_color: str | None = None
    track_style: str | None = None
    rim_style: str = "aero"
    last_mode: str = "normal"
    points: int = 0
    races: int = 0
    wins: int = 0
    trophies: int = 0
    coins: int = 0
    diamonds: int = 0
    owned_cosmetics: list[str] = field(default_factory=list)
    best_lap: float | None = None
    experience: int = 0
    level: int = 1
    total_coins_earned: int = 0
    total_coins_spent: int = 0
    processed_result_ids: list[str] = field(default_factory=list)
    transactions: list[dict[str, Any]] = field(default_factory=list)
    statistics: dict[str, int | float] = field(default_factory=dict)
    records: dict[str, dict[str, Any]] = field(default_factory=dict)
    daily_missions: dict[str, Any] = field(default_factory=dict)
    championship: dict[str, Any] = field(default_factory=dict)
    processed_challenge_events: list[str] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path | None = None) -> "Profile":
        path = path or default_profile_path()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return cls()
        except (OSError, ValueError):
            LOGGER.warning("Could not read NEON RUSH profile at %s; using defaults", path, exc_info=True)
            return cls()
        if not isinstance(data, dict):
            LOGGER.warning("Ignoring invalid NEON RUSH profile root: %s", path)
            return cls()
        allowed = {field.name for field in fields(cls)}
        values = {key: value for key, value in data.items() if key in allowed}
        for key in (
            "schema_version", "points", "races", "wins", "trophies",
            "coins", "diamonds", "experience", "level",
            "total_coins_earned", "total_coins_spent",
        ):
            default = cls.__dataclass_fields__[key].default
            values[key] = _safe_count(values.get(key, default), default)
        values["level"] = max(1, values["level"])
        for key in ("tutorial_seen",):
            values[key] = values.get(key, False) if isinstance(values.get(key, False), bool) else False
        for key in (
            "character_id", "vehicle_id", "power_id", "rim_style", "last_mode",
            "alias", "created_at",
        ):
            if not isinstance(values.get(key), str):
                values.pop(key, None)
        for key in ("car_color", "outfit_color", "track_style"):
            if values.get(key) is not None and not isinstance(values[key], str):
                values[key] = None
        if values.get("best_lap") is not None and (
            not isinstance(values["best_lap"], (int, float))
            or isinstance(values["best_lap"], bool)
            or not math.isfinite(values["best_lap"])
            or values["best_lap"] <= 0
        ):
            values["best_lap"] = None
        owned_cosmetics = values.get("owned_cosmetics", [])
        values["owned_cosmetics"] = (
            sorted(set(item for item in owned_cosmetics if isinstance(item, str)))
            if isinstance(owned_cosmetics, list)
            else []
        )
        for key in ("processed_result_ids", "processed_challenge_events"):
            raw = values.get(key, [])
            values[key] = list(dict.fromkeys(item for item in raw if isinstance(item, str))) if isinstance(raw, list) else []
        for key in ("transactions",):
            raw = values.get(key, [])
            values[key] = [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []
        raw_statistics = values.get("statistics", {})
        values["statistics"] = {
            key: value
            for key, value in raw_statistics.items()
            if isinstance(key, str)
            and isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
        } if isinstance(raw_statistics, dict) else {}
        raw_records = values.get("records", {})
        values["records"] = {
            key: value for key, value in raw_records.items()
            if isinstance(key, str) and isinstance(value, dict)
        } if isinstance(raw_records, dict) else {}
        raw_daily = values.get("daily_missions", {})
        if (
            isinstance(raw_daily, dict)
            and isinstance(raw_daily.get("date"), str)
            and isinstance(raw_daily.get("missions"), list)
        ):
            sanitized_missions = []
            for mission in raw_daily["missions"]:
                if not isinstance(mission, dict) or not isinstance(mission.get("id"), str):
                    continue
                target = max(1, _safe_count(mission.get("target"), 1))
                progress = min(target, _safe_count(mission.get("progress"), 0))
                status = mission.get("status")
                if status not in ("active", "completed", "expired"):
                    status = "completed" if progress >= target else "active"
                sanitized_missions.append({
                    "id": mission["id"],
                    "description": mission.get("description") if isinstance(mission.get("description"), str) else mission["id"],
                    "target": target,
                    "progress": progress,
                    "reward": _safe_count(mission.get("reward"), 0),
                    "event": mission.get("event") if isinstance(mission.get("event"), str) else "race.finished",
                    "status": status,
                })
            raw_daily["missions"] = sanitized_missions
            event_ids = raw_daily.get("processed_event_ids", [])
            raw_daily["processed_event_ids"] = (
                [item for item in event_ids if isinstance(item, str)]
                if isinstance(event_ids, list) else []
            )
            values["daily_missions"] = raw_daily
        else:
            values["daily_missions"] = {}
        raw_cup = values.get("championship", {})
        if isinstance(raw_cup, dict):
            raw_tracks = raw_cup.get("tracks", {})
            raw_standings = raw_cup.get("standings", {})
            raw_cup["tracks"] = {
                key: value for key, value in raw_tracks.items()
                if isinstance(key, str) and isinstance(value, dict)
            } if isinstance(raw_tracks, dict) else {}
            raw_cup["standings"] = {
                key: {
                    "name": value.get("name") if isinstance(value.get("name"), str) else key,
                    "points": _safe_count(value.get("points"), 0),
                }
                for key, value in raw_standings.items()
                if isinstance(key, str) and isinstance(value, dict)
            } if isinstance(raw_standings, dict) else {}
            values["championship"] = raw_cup
        else:
            values["championship"] = {}
        values["schema_version"] = PROFILE_SCHEMA_VERSION
        return cls(**values)

    def save(self, path: Path | None = None) -> None:
        path = path or default_profile_path()
        temporary_path: Path | None = None
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                "w",
                encoding="utf-8",
                dir=path.parent,
                prefix=f".{path.name}.",
                suffix=".tmp",
                delete=False,
            ) as file:
                temporary_path = Path(file.name)
                json.dump(asdict(self), file, indent=2, ensure_ascii=False)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary_path, path)
        except OSError:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
            LOGGER.exception("Could not persist NEON RUSH profile at %s", path)
            raise

    @property
    def mode(self) -> GameMode:
        return MODES_BY_ID.get(self.last_mode, MODES_BY_ID["normal"])

    def loadout(self) -> Loadout:
        return get_loadout(self.character_id, self.vehicle_id, self.power_id)

    def apply_loadout(self, loadout: Loadout) -> None:
        self.character_id = loadout.character.id
        self.vehicle_id = loadout.vehicle.id
        self.power_id = loadout.power.id

    def record_result(
        self,
        results: list[dict[str, Any]],
        mode: GameMode,
        *,
        result_id: str | None = None,
        track_key: str | None = None,
        vehicle_id: str | None = None,
    ) -> bool:
        if not results:
            return False
        if result_id is None:
            canonical = json.dumps(
                {"results": results, "mode": mode.id},
                sort_keys=True,
                separators=(",", ":"),
                default=str,
            )
            result_id = "legacy:" + hashlib.sha256(canonical.encode()).hexdigest()
        if result_id in self.processed_result_ids:
            return False
        own = next((item for item in results if item.get("id") == 1), results[0])
        before = asdict(self)
        self.races += 1
        raw_placement = own.get("placement")
        placement = (
            raw_placement
            if isinstance(raw_placement, int) and not isinstance(raw_placement, bool)
            else None
        )
        finished = bool(own.get("finished"))
        earned = (
            PLACEMENT_REWARDS.get(placement, 0)
            if finished and placement is not None
            else 0
        )
        if finished:
            earned += 100
        if finished and placement == 1:
            self.wins += 1
            self.points += 15 if mode.championship else 10
            self.trophies += 1
        elif mode.championship and finished and placement is not None:
            self.points += CHAMPIONSHIP_POINTS.get(placement, 0)
        else:
            self.points += 5 if placement == 2 else 2 if placement in (3, 4) else 0
        if finished:
            self.coins += earned
            self.total_coins_earned += earned
            self._append_transaction(
                f"race:{result_id}:reward",
                earned,
                "Carrera completada",
                result_id,
            )
            self._add_experience(100 + (50 if placement == 1 else 0))
        lap = own.get("best_lap")
        if finished and isinstance(lap, (int, float)) and lap > 0:
            self.best_lap = lap if self.best_lap is None else min(self.best_lap, lap)
        self._record_statistics(own, finished)
        self._record_track_result(
            own,
            result_id,
            track_key or self.track_style or "unknown",
            vehicle_id or self.vehicle_id,
            mode,
        )
        self._advance_daily_missions(own, result_id)
        if mode.championship:
            self._record_championship(results, result_id, track_key or self.track_style or "unknown")
        self.processed_result_ids.append(result_id)
        self.last_mode = mode.id
        try:
            self.save()
        except OSError:
            self.__dict__.update(before)
            raise
        return True

    @staticmethod
    def _experience_required(level: int) -> int:
        return sum(experience_for_next_level(value) for value in range(1, level))

    @property
    def experience_into_level(self) -> int:
        return self.experience - self._experience_required(self.level)

    @property
    def experience_to_next_level(self) -> int:
        return experience_for_next_level(self.level)

    def _append_transaction(
        self, transaction_id: str, amount: int, reason: str, reference: str
    ) -> None:
        self.transactions.append({
            "transaction_id": transaction_id,
            "currency": "NC",
            "amount": amount,
            "reason": reason,
            "reference": reference,
            "created_at": _utc_now(),
        })

    def _record_statistics(self, own: dict[str, Any], finished: bool) -> None:
        stats = self.statistics
        stats["races"] = int(stats.get("races", 0)) + 1
        stats["collisions"] = int(stats.get("collisions", 0)) + max(
            0, int(own.get("collisions", 0))
        )
        stats["jumps_completed"] = int(stats.get("jumps_completed", 0)) + max(
            0, int(own.get("jumps_completed", 0))
        )
        if isinstance(own.get("distance"), (int, float)):
            stats["distance"] = float(stats.get("distance", 0.0)) + max(
                0.0, float(own["distance"])
            )
        race_time = own.get("race_time")
        if isinstance(race_time, (int, float)):
            stats["time_played_seconds"] = float(
                stats.get("time_played_seconds", 0.0)
            ) + max(0.0, float(race_time))
        if finished:
            stats["finished_races"] = int(stats.get("finished_races", 0)) + 1
            placement = own.get("placement")
            if placement == 1:
                stats["victories"] = int(stats.get("victories", 0)) + 1
            elif isinstance(placement, int):
                stats["losses"] = int(stats.get("losses", 0)) + 1
            if placement in (1, 2, 3):
                stats["podiums"] = int(stats.get("podiums", 0)) + 1
            if isinstance(own.get("laps_completed"), int):
                stats["valid_laps"] = int(stats.get("valid_laps", 0)) + max(
                    0, own["laps_completed"]
                )
            if isinstance(own.get("finish_time"), (int, float)):
                stats["time_played_seconds"] = max(
                    float(stats.get("time_played_seconds", 0.0)),
                    max(0.0, float(own["finish_time"])),
                )
        else:
            stats["abandoned_races"] = int(stats.get("abandoned_races", 0)) + 1

    def _record_track_result(
        self,
        own: dict[str, Any],
        result_id: str,
        track_key: str,
        vehicle_id: str,
        mode: GameMode,
    ) -> None:
        if not own.get("finished"):
            return
        record = self.records.setdefault(track_key, {"geometry_version": 1})
        record["last_result_id"] = result_id
        record["date"] = _utc_now()
        record["vehicle_id"] = vehicle_id
        record["mode"] = mode.id
        lap = own.get("best_lap")
        if isinstance(lap, (int, float)) and lap > 0:
            old_lap = record.get("best_lap")
            if not isinstance(old_lap, (int, float)) or lap < old_lap:
                record["best_lap"] = float(lap)
        finish_time = own.get("finish_time")
        if isinstance(finish_time, (int, float)) and finish_time > 0:
            old_time = record.get("best_race_time")
            if not isinstance(old_time, (int, float)) or finish_time < old_time:
                record["best_race_time"] = float(finish_time)
        placement = own.get("placement")
        if isinstance(placement, int):
            old_position = record.get("best_position")
            if not isinstance(old_position, int) or placement < old_position:
                record["best_position"] = placement

    def _add_experience(self, amount: int) -> None:
        self.experience += max(0, amount)
        while self.experience >= self._experience_required(self.level + 1):
            self.level += 1

    def ensure_daily_missions(self, now: datetime | None = None) -> dict[str, Any]:
        """Create a stable UTC-day mission set; local clock edits are not server-proof."""
        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        day = now.astimezone(timezone.utc).date()
        if self.daily_missions.get("date") == day.isoformat():
            for mission in self.daily_missions.get("missions", []):
                if mission.get("id") == "complete_jump":
                    mission.update(
                        id="win_race",
                        description="Gana una carrera",
                        reward=75,
                        status="active",
                        progress=0,
                    )
            return self.daily_missions
        start = day.toordinal() % len(DAILY_MISSION_TEMPLATES)
        selected = [
            DAILY_MISSION_TEMPLATES[(start + index) % len(DAILY_MISSION_TEMPLATES)]
            for index in range(3)
        ]
        next_day = datetime.combine(
            day.fromordinal(day.toordinal() + 1),
            datetime.min.time(),
            tzinfo=timezone.utc,
        )
        self.daily_missions = {
            "date": day.isoformat(),
            "expires_at": next_day.isoformat(),
            "processed_event_ids": [],
            "missions": [
                {
                    "id": mission_id,
                    "description": description,
                    "target": target,
                    "progress": 0,
                    "reward": reward,
                    "event": event,
                    "status": "active",
                }
                for mission_id, description, target, reward, event in selected
            ],
        }
        return self.daily_missions

    def _advance_daily_missions(
        self, own: dict[str, Any], result_id: str
    ) -> None:
        missions = self.ensure_daily_missions()
        event_id = f"{result_id}:race.finished"
        processed = missions.setdefault("processed_event_ids", [])
        if event_id in processed:
            return
        processed.append(event_id)
        finished = bool(own.get("finished"))
        earned_missions = 0
        for mission in missions["missions"]:
            if mission.get("status") != "active":
                continue
            mission_id = mission.get("id")
            completed = finished and (
                mission_id == "finish_race"
                or mission_id == "clean_race" and int(own.get("collisions", 0)) == 0
                or mission_id == "win_race" and int(own.get("placement", 0)) == 1
                or mission_id == "valid_lap" and int(own.get("laps_completed", 0)) > 0
            )
            if not completed:
                continue
            mission["progress"] = mission["target"]
            mission["status"] = "completed"
            earned_missions += 1
            reward = int(mission["reward"])
            self.coins += reward
            self.total_coins_earned += reward
            self._append_transaction(
                f"mission:{missions['date']}:{mission_id}",
                reward,
                f"Misión diaria: {mission.get('description', mission_id)}",
                event_id,
            )
            self._add_experience(40)
        if earned_missions:
            self.statistics["challenges_completed"] = int(
                self.statistics.get("challenges_completed", 0)
            ) + earned_missions

    def _record_championship(
        self,
        results: list[dict[str, Any]],
        result_id: str,
        track_key: str,
    ) -> None:
        if track_key not in CHAMPIONSHIP_TRACK_ORDER:
            return
        cup = self.championship
        if cup.get("status") == "completed" or not cup.get("cycle_id"):
            cup = {
                "cycle_id": result_id,
                "status": "in_progress",
                "tracks": {},
                "standings": {},
            }
            self.championship = cup
        tracks = cup.setdefault("tracks", {})
        if track_key in tracks:
            return
        standings = cup.setdefault("standings", {})
        participants: dict[str, str] = {}
        round_points: dict[str, int] = {}
        for result in results:
            participant_id = str(result.get("id"))
            participants[participant_id] = str(result.get("name", participant_id))
            raw_placement = result.get("placement")
            points = (
                CHAMPIONSHIP_POINTS.get(raw_placement, 0)
                if result.get("finished")
                and isinstance(raw_placement, int)
                and not isinstance(raw_placement, bool)
                else 0
            )
            round_points[participant_id] = points
            standing = standings.setdefault(
                participant_id,
                {"name": participants[participant_id], "points": 0},
            )
            standing["points"] += points
        tracks[track_key] = {
            "result_id": result_id,
            "participants": participants,
            "points": round_points,
        }
        cup["completed_races"] = len(tracks)
        if all(track in tracks for track in CHAMPIONSHIP_TRACK_ORDER):
            ranked = sorted(
                standings.items(),
                key=lambda item: (-int(item[1]["points"]), item[0]),
            )
            first_points = int(ranked[0][1]["points"])
            tied = len(ranked) > 1 and int(ranked[1][1]["points"]) == first_points
            cup["status"] = "completed"
            cup["champion_id"] = None if tied else ranked[0][0]
            cup["champion"] = "EMPATE" if tied else ranked[0][1]["name"]
            if not tied and ranked[0][0] == "1":
                reward_id = f"championship:{cup['cycle_id']}:reward"
                self.coins += 1000
                self.total_coins_earned += 1000
                self._append_transaction(
                    reward_id,
                    1000,
                    "Campeón de NEON CUP",
                    str(cup["cycle_id"]),
                )
                self._add_experience(300)
                self.statistics["championships_won"] = int(
                    self.statistics.get("championships_won", 0)
                ) + 1

    def purchase_cosmetic(
        self, cosmetic_id: str, *, price: int = 0, currency: str = "coins"
    ) -> bool:
        """Charge once for an item and persist its ownership."""
        owned = set(self.owned_cosmetics)
        if cosmetic_id in owned:
            return False
        catalog_price = COSMETIC_CATALOG.get(cosmetic_id)
        if (
            catalog_price is None
            or catalog_price != (price, currency)
            or not isinstance(price, int)
            or isinstance(price, bool)
            or price < 0
            or currency != "coins"
        ):
            return False
        balance = self.coins
        if balance < price:
            return False
        before = asdict(self)
        self.coins = balance - price
        self.total_coins_spent += price
        owned.add(cosmetic_id)
        self.owned_cosmetics = sorted(owned)
        self._append_transaction(
            f"purchase:{cosmetic_id}",
            -price,
            f"Compra {cosmetic_id}",
            cosmetic_id,
        )
        try:
            self.save()
        except OSError:
            self.__dict__.update(before)
            raise
        return True


def random_style_seed(style: str) -> int:
    return random.Random(f"neonrush:{style}").randrange(1 << 30)
