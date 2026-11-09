import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAMPIONSHIP_TRACKS,
  CHAMPIONSHIP_POINTS,
  CHALLENGES,
  DAILY_MISSION_POOL,
  ProgressionManager,
  createProgressionState,
  getChallengeView,
  getDailyMissionView,
  loadProgressionState,
  recordChampionshipRace,
  recordProgressionEvent,
  startChampionship,
  validateProgressionState
} from '../src/game/Progression.js';
import {
  grantWalletReward,
  loadNeonWallet,
  NEON_WALLET_KEY,
  NEON_WALLET_VERSION
} from '../src/storage/NeonWallet.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

function event(type, eventId, data = {}, trackId = 'neon-city') {
  return {
    eventId,
    raceId: 'race-test',
    type,
    trackId,
    data
  };
}

test('only verified, unique progression events advance challenge counters', () => {
  let state = createProgressionState(Date.parse('2026-11-06T12:00:00Z'));
  const invalid = recordProgressionEvent(state, {
    ...event('speed_sample', 'bad'),
    type: 'teleport'
  });
  assert.equal(invalid.accepted, false);
  const incompleteRace = recordProgressionEvent(
    state,
    event('race_finished', 'forged-finish', {
      completed: false,
      position: 1,
      elapsedTime: 20,
      collisions: 0
    })
  );
  assert.equal(incompleteRace.accepted, false);
  const invalidTrack = recordProgressionEvent(
    state,
    { ...event('speed_sample', 'wrong-track', { speedKmh: 220 }), trackId: 'made-up' }
  );
  assert.equal(invalidTrack.accepted, false);

  const first = recordProgressionEvent(
    state,
    event('speed_sample', 'speed-1', { speedKmh: 172 }),
    Date.parse('2026-11-06T12:00:00Z')
  );
  state = first.state;
  assert.equal(state.challengeProgress['speed-180'], 172);
  const duplicate = recordProgressionEvent(
    state,
    event('speed_sample', 'speed-1', { speedKmh: 220 }),
    Date.parse('2026-11-06T12:00:01Z')
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.challengeProgress['speed-180'], 172);

  const completed = recordProgressionEvent(
    state,
    event('speed_sample', 'speed-2', { speedKmh: 183 }),
    Date.parse('2026-11-06T12:00:02Z')
  );
  assert.equal(completed.state.challengeProgress['speed-180'], 183);
  assert.ok(getChallengeView(completed.state)
    .find(({ id }) => id === 'speed-180').complete);
});

test('UTC daily missions rotate and reset progress at midnight', () => {
  const beforeMidnight = Date.parse('2026-11-06T23:59:59Z');
  let state = createProgressionState(beforeMidnight);
  const mission = getDailyMissionView(state, beforeMidnight)[0];
  const triggerType = mission.goal.type;
  const triggerData = mission.goal.condition === 'win'
    ? { position: 1, elapsedTime: 30, collisions: 0 }
    : triggerType === 'race_finished'
      ? { completed: true, position: 2, collisions: 0, elapsedTime: 30 }
      : { seconds: 1, count: 1 };
  for (let count = 0; count < mission.target; count += 1) {
    const update = recordProgressionEvent(
      state,
      event(triggerType, `daily-${count}`, triggerData),
      beforeMidnight
    );
    state = update.state;
  }
  assert.equal(getDailyMissionView(state, beforeMidnight)[0].complete, true);
  const nextDay = validateProgressionState(
    state,
    Date.parse('2026-11-07T00:00:01Z')
  );
  assert.equal(nextDay.dailyDate, '2026-11-07');
  assert.equal(nextDay.dailyMissions[0].progress, 0);
});

test('lap records improve only on faster valid lap events', () => {
  const timestamp = Date.parse('2026-11-06T12:00:00Z');
  let state = createProgressionState(timestamp);
  let result = recordProgressionEvent(
    state,
    event('lap_completed', 'lap-1', { lap: 1, lapTime: 62 }),
    timestamp
  );
  assert.equal(result.recordImproved, true);
  state = result.state;
  result = recordProgressionEvent(
    state,
    event('lap_completed', 'lap-2', { lap: 2, lapTime: 64 }),
    timestamp + 1
  );
  assert.equal(result.recordImproved, false);
  assert.equal(result.state.records['neon-city'], 62);
  result = recordProgressionEvent(
    result.state,
    event('lap_completed', 'lap-3', { lap: 3, lapTime: 58 }),
    timestamp + 2
  );
  assert.equal(result.recordImproved, true);
  assert.equal(result.state.challengeProgress['record-improved'], 1);
});

test('reward grants unlock once and persist idempotency beside the wallet ledger', () => {
  const first = grantWalletReward(undefined, {
    rewardId: 'challenge:speed-180',
    amount: 100,
    unlocks: ['neon-lime'],
    timestamp: 10
  });
  assert.equal(first.wallet.balance, 100);
  assert.ok(first.wallet.inventory.includes('neon-lime'));
  const repeated = grantWalletReward(first.wallet, {
    rewardId: 'challenge:speed-180',
    amount: 100,
    unlocks: ['neon-lime'],
    timestamp: 11
  });
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.wallet.balance, 100);
  assert.equal(repeated.wallet.history.length, 1);
  assert.equal(first.wallet.version, NEON_WALLET_VERSION);
});

test('progression manager claims completed challenge rewards exactly once across reloads', () => {
  const storage = createStorage();
  let wallet = loadNeonWallet(storage);
  const saveWallet = (next) => {
    storage.setItem(NEON_WALLET_KEY, JSON.stringify(next));
    wallet = next;
    return true;
  };
  const now = () => Date.parse('2026-11-06T12:00:00Z');
  let manager = new ProgressionManager({ storage, wallet, saveWallet, now });
  manager.recordEvent(event(
    'speed_sample',
    'race-test:speed',
    { speedKmh: 185 }
  ));
  assert.equal(wallet.balance, CHALLENGES.find(
    ({ id }) => id === 'speed-180'
  ).reward);
  assert.ok(wallet.inventory.includes('neon-lime'));

  manager = new ProgressionManager({
    storage,
    wallet: loadNeonWallet(storage),
    saveWallet,
    now
  });
  assert.equal(manager.wallet.balance, wallet.balance);
  assert.equal(manager.wallet.history.length, 1);
  assert.equal(manager.state.challengeClaimed['speed-180'], true);
});

test('completed daily missions credit Neon Coins once and survive reloads', () => {
  const storage = createStorage();
  let wallet = loadNeonWallet(storage);
  const saveWallet = (next) => {
    storage.setItem(NEON_WALLET_KEY, JSON.stringify(next));
    wallet = next;
    return true;
  };
  const now = () => Date.parse('2026-11-06T12:00:00Z');
  let manager = new ProgressionManager({ storage, wallet, saveWallet, now });
  const missionState = manager.state.dailyMissions[0];
  const mission = DAILY_MISSION_POOL.find(({ id }) =>
    id === missionState.id
  );
  const data = {
    count: 1,
    seconds: 1,
    completed: true,
    collisions: 0,
    position: 1,
    elapsedTime: 30
  };
  const trackId = mission.goal.condition === 'plasma'
    ? 'plasma-circuit'
    : 'neon-city';
  for (let index = 0; index < mission.target; index += 1) {
    manager.recordEvent(event(
      mission.goal.type,
      `daily-reward-${index}`,
      data,
      trackId
    ));
  }
  assert.ok(wallet.balance >= mission.reward);
  assert.ok(wallet.history.some(({ description }) =>
    description.includes(mission.name)
  ));
  assert.ok(wallet.processedRewards.includes(
    `daily:2026-11-06:${mission.id}`
  ));
  const balance = wallet.balance;
  manager = new ProgressionManager({
    storage,
    wallet: loadNeonWallet(storage),
    saveWallet,
    now
  });
  assert.equal(manager.wallet.balance, balance);
  assert.equal(manager.state.dailyMissions[0].claimed, true);
});

test('championship records only its ordered real races and awards defined points', () => {
  const timestamp = Date.parse('2026-11-06T12:00:00Z');
  let state = createProgressionState(timestamp);
  state = startChampionship(state, timestamp, 'cup-test').state;
  const orders = [
    ['player', 'nova', 'blaze', 'volt'],
    ['nova', 'player', 'volt', 'blaze'],
    ['blaze', 'nova', 'player', 'volt']
  ];
  for (let index = 0; index < CHAMPIONSHIP_TRACKS.length; index += 1) {
    const trackId = CHAMPIONSHIP_TRACKS[index];
    const participants = orders[index].map((id, rank) => ({
      id,
      name: id === 'player' ? 'TÚ' : id.toUpperCase(),
      position: rank + 1,
      finishTime: 50 + rank
    }));
    const saved = recordChampionshipRace(state, {
      raceId: `cup-race-${index}`,
      championshipId: 'cup-test',
      trackId,
      completed: true,
      participants
    }, timestamp);
    assert.equal(saved.accepted, true);
    state = saved.state;
    if (index === 0) {
      const duplicate = recordChampionshipRace(state, {
        raceId: 'cup-race-0',
        championshipId: 'cup-test',
        trackId,
        completed: true,
        participants
      }, timestamp);
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.championship.races.length, 1);
    }
  }
  assert.equal(state.championship.status, 'completed');
  assert.equal(state.championship.standings.find(
    ({ id }) => id === 'player'
  ).points, CHAMPIONSHIP_POINTS[1] + CHAMPIONSHIP_POINTS[2] +
    CHAMPIONSHIP_POINTS[3]);
  assert.equal(state.championship.championIds[0], 'nova');
  assert.equal(state.championship.playerPosition, 2);
  assert.equal(state.championship.reward, 700);
  assert.equal(state.championship.standings.find(
    ({ id }) => id === 'volt'
  ).points, CHAMPIONSHIP_POINTS[4] + CHAMPIONSHIP_POINTS[3] +
    CHAMPIONSHIP_POINTS[4]);
});

test('championship abandons score zero, consume the expected round, and cannot be replayed', () => {
  const timestamp = Date.parse('2026-11-06T12:00:00Z');
  let state = startChampionship(
    createProgressionState(timestamp),
    timestamp,
    'cup-dnf'
  ).state;
  const dnf = recordChampionshipRace(state, {
    raceId: 'dnf-1',
    championshipId: 'cup-dnf',
    trackId: 'neon-city',
    abandoned: true
  }, timestamp);
  assert.equal(dnf.accepted, true);
  state = dnf.state;
  assert.equal(state.championship.roundIndex, 1);
  assert.equal(state.championship.races[0].status, 'dnf');
  const stale = recordChampionshipRace(state, {
    raceId: 'late-race',
    championshipId: 'cup-dnf',
    trackId: 'neon-city',
    completed: true,
    participants: []
  }, timestamp);
  assert.equal(stale.accepted, false);
  assert.equal(CHAMPIONSHIP_POINTS[5] ?? 0, 0);
});

test('ordinary race abandonment is accepted without requiring a championship', () => {
  const timestamp = Date.parse('2026-11-06T12:00:00Z');
  const result = recordProgressionEvent(
    createProgressionState(timestamp),
    event('race_abandoned', 'race-quit', { elapsedTime: 12.5 }),
    timestamp
  );
  assert.equal(result.accepted, true);
  assert.equal(result.state.eventLog[0].type, 'race_abandoned');
});

test('completed Neon Cup awards its coins and unlock once across reloads', () => {
  const storage = createStorage();
  let wallet = loadNeonWallet(storage);
  const saveWallet = (next) => {
    storage.setItem(NEON_WALLET_KEY, JSON.stringify(next));
    wallet = next;
    return true;
  };
  const now = () => Date.parse('2026-11-06T12:00:00Z');
  const manager = new ProgressionManager({ storage, wallet, saveWallet, now });
  manager.beginChampionship('cup-reward-test');
  const order = ['player', 'nova', 'blaze', 'volt'];
  for (const [index, trackId] of CHAMPIONSHIP_TRACKS.entries()) {
    const result = manager.recordCupRace({
      raceId: `cup-reward-${index}`,
      championshipId: 'cup-reward-test',
      trackId,
      completed: true,
      participants: order.map((id, rank) => ({
        id,
        name: id === 'player' ? 'TÚ' : id.toUpperCase(),
        position: rank + 1,
        finishTime: 50 + rank,
        finished: true
      }))
    });
    assert.equal(result.accepted, true);
  }
  assert.equal(wallet.balance, 1000);
  assert.ok(wallet.inventory.includes('vehicle-nova-hyper'));
  assert.equal(wallet.processedRewards.filter(
    (id) => id === 'championship:cup-reward-test'
  ).length, 1);
  const restored = new ProgressionManager({
    storage,
    wallet: loadNeonWallet(storage),
    saveWallet,
    now
  });
  assert.equal(restored.wallet.balance, 1000);
  assert.equal(restored.state.championship.rewardClaimed, true);
});

test('stored progression migrates by UTC day without losing the previous championship', () => {
  const storage = createStorage();
  const timestamp = Date.parse('2026-11-06T12:00:00Z');
  const current = createProgressionState(timestamp);
  storage.setItem('neon-rush-progression', JSON.stringify(current));
  const restored = loadProgressionState(storage, timestamp);
  assert.deepEqual(restored.dailyMissions, current.dailyMissions);
  assert.equal(restored.championship.status, 'not_started');
  assert.equal(validateProgressionState({
    version: 999
  }, timestamp).version, 1);
});

test('malformed stored championship data cannot break the progression view', () => {
  const timestamp = Date.parse('2026-11-06T12:00:00Z');
  const state = validateProgressionState({
    version: 1,
    dailyDate: '2026-11-06',
    championship: {
      id: 'cup-malformed',
      status: 'completed',
      championIds: ['__proto__', 'player'],
      standings: [{ id: '__proto__', name: '<img src=x>', position: 1 }],
      races: [{ raceId: 'race', trackId: 'unknown', participants: [] }]
    },
    championshipHistory: [{
      championIds: ['constructor'],
      standings: [{ id: 'constructor', name: '<script>' }]
    }]
  }, timestamp);
  assert.deepEqual(state.championship.championIds, ['player']);
  assert.deepEqual(state.championship.standings, []);
  assert.deepEqual(state.championship.races, []);
  assert.deepEqual(state.championshipHistory[0].standings, []);
});
