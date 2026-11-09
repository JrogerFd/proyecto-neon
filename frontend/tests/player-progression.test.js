import assert from 'node:assert/strict';
import test from 'node:test';
import {
  levelForExperience,
  loadPlayerProgression,
  PlayerProgressionManager,
  PLAYER_PROGRESSION_KEY,
  PLAYER_PROGRESSION_VERSION,
  validatePlayerProgression,
  XP_REWARDS
} from '../src/storage/PlayerProgression.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values
  };
}

function event(type, eventId, data, trackId = 'neon-city') {
  return {
    eventId,
    raceId: 'race-1',
    type,
    trackId,
    data: { vehicleId: 'neon-starter', ...data }
  };
}

test('experience levels use cumulative thresholds and report progress', () => {
  assert.deepEqual(levelForExperience(399), {
    level: 1,
    currentXp: 399,
    requiredXp: 400,
    totalXp: 399,
    progress: 99
  });
  assert.equal(levelForExperience(400).level, 2);
  assert.equal(levelForExperience(400).currentXp, 0);
  assert.equal(levelForExperience(950).level, 3);
  assert.equal(levelForExperience(-5).totalXp, 0);
});

test('race events persist profile statistics and unique race XP', () => {
  const storage = createStorage();
  const manager = new PlayerProgressionManager({
    storage,
    now: () => Date.parse('2026-11-06T12:00:00Z')
  });
  assert.equal(manager.recordEvent(event('race_started', 'race-1:1', {
    laps: 3,
    rivalCount: 3
  })), true);
  assert.equal(manager.recordEvent(event('lap_completed', 'race-1:2', {
    lap: 1,
    lapTime: 50.25
  })), true);
  assert.equal(manager.recordEvent(event('lap_completed', 'race-1:2', {
    lap: 1,
    lapTime: 50.25
  })), false);
  assert.equal(manager.profile.xp, 0);
  assert.equal(manager.recordEvent(event('race_finished', 'race-1:3', {
    completed: true,
    position: 1,
    elapsedTime: 151.2,
    collisions: 2,
    distanceMeters: 3240
  })), true);
  assert.equal(manager.profile.xp, XP_REWARDS.raceCompleted +
    XP_REWARDS.raceWon);
  assert.equal(manager.profile.stats.races, 1);
  assert.equal(manager.profile.stats.finishedRaces, 1);
  assert.equal(manager.profile.stats.wins, 1);
  assert.equal(manager.profile.stats.podiums, 1);
  assert.equal(manager.profile.stats.laps, 1);
  assert.equal(manager.profile.stats.distanceMeters, 3240);
  assert.equal(manager.profile.records['neon-city'].bestLap, 50.25);
  assert.equal(manager.profile.records['neon-city'].bestRace, 151.2);
  assert.equal(manager.profile.vehicleUses['neon-starter'], 1);

  const reloaded = loadPlayerProgression(storage);
  assert.equal(reloaded.xp, manager.profile.xp);
  assert.equal(reloaded.stats.finishedRaces, 1);
  assert.equal(reloaded.records['neon-city'].bestLap, 50.25);
  assert.equal(JSON.parse(
    storage.values.get(PLAYER_PROGRESSION_KEY)
  ).version, PLAYER_PROGRESSION_VERSION);
});

test('verified record, challenge, mission, and cup rewards are idempotent', () => {
  const manager = new PlayerProgressionManager({
    storage: createStorage(),
    now: () => Date.parse('2026-11-06T12:00:00Z')
  });
  assert.equal(manager.grantExperience('record:race-1:1', 20, 'Récord'), true);
  assert.equal(manager.grantExperience('record:race-1:1', 20, 'Récord'), false);
  assert.equal(
    manager.recordMilestone('challenge:speed-180', 'challenge', 40, 'Velocidad'),
    true
  );
  assert.equal(
    manager.recordMilestone('challenge:speed-180', 'challenge', 40, 'Velocidad'),
    false
  );
  assert.equal(
    manager.recordMilestone('daily:2026-11-06:race', 'mission', 25, 'Carrera'),
    true
  );
  assert.equal(
    manager.recordMilestone('championship:cup-1', 'championship', 300, 'Copa'),
    true
  );
  assert.equal(manager.profile.stats.challengesCompleted, 1);
  assert.equal(manager.profile.stats.championshipsWon, 1);
  assert.equal(manager.profile.xp, 385);
});

test('profile validation clamps invalid stats and preserves supported records', () => {
  const profile = validatePlayerProgression({
    alias: '  NEON PILOT  ',
    xp: -20,
    stats: { races: -3, unknown: 50 },
    records: {
      'neon-city': { bestLap: 42, topSpeedKmh: 200 },
      unknown: { bestLap: 1 }
    },
    rewardIds: ['one', 'one']
  }, 1000);
  assert.equal(profile.alias, 'NEON PILOT');
  assert.equal(profile.xp, 0);
  assert.equal(profile.stats.races, 0);
  assert.equal(Object.hasOwn(profile.stats, 'unknown'), false);
  assert.equal(profile.records['neon-city'].bestLap, 42);
  assert.equal(Object.hasOwn(profile.records, 'unknown'), false);
  assert.deepEqual(profile.rewardIds, ['one']);
});
