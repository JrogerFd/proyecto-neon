import { TRACKS } from '../game/TrackCatalog.js';
import { VEHICLES } from '../game/VehicleCatalog.js';

export const PLAYER_PROGRESSION_KEY = 'neon-rush-player-progression';
export const PLAYER_PROGRESSION_VERSION = 1;
export const XP_REWARDS = Object.freeze({
  raceCompleted: 100,
  raceWon: 50,
  podium: 25,
  recordImproved: 20,
  challengeCompleted: 40,
  missionCompleted: 25,
  championshipWon: 300
});
export const XP_LEVEL_BASE = 400;
export const XP_LEVEL_STEP = 150;

const TRACK_IDS = new Set(TRACKS.map(({ id }) => id));
const VEHICLE_IDS = new Set(VEHICLES.map(({ id }) => id));
const EVENT_TYPES = new Set([
  'race_started',
  'race_finished',
  'race_abandoned',
  'lap_completed',
  'collision',
  'overtake',
  'jump_landed',
  'obstacle_avoided',
  'checkpoint',
  'sector_completed',
  'record_improved',
  'speed_sample',
  'nitro_second',
  'on_track_second'
]);
const COUNT_KEYS = [
  'races',
  'finishedRaces',
  'wins',
  'podiums',
  'defeats',
  'laps',
  'collisions',
  'overtakes',
  'jumps',
  'obstaclesAvoided',
  'nitroSeconds',
  'onTrackSeconds',
  'challengesCompleted',
  'championshipsWon'
];
const MAX_EVENT_IDS = 5000;
const MAX_HISTORY = 100;

function createDefaultProfile(now = Date.now()) {
  return {
    version: PLAYER_PROGRESSION_VERSION,
    alias: 'PILOTO',
    createdAt: now,
    xp: 0,
    stats: Object.fromEntries([
      ...COUNT_KEYS.map((key) => [key, 0]),
      ['distanceMeters', 0],
      ['timePlayedSeconds', 0]
    ]),
    records: {},
    vehicleUses: {},
    eventIds: [],
    rewardIds: [],
    history: []
  };
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeRecord(record) {
  const candidate = record && typeof record === 'object' ? record : {};
  return {
    bestLap: positiveNumberOrNull(candidate.bestLap),
    bestRace: positiveNumberOrNull(candidate.bestRace),
    bestPosition: Number.isInteger(candidate.bestPosition) &&
      candidate.bestPosition > 0
      ? candidate.bestPosition
      : null,
    topSpeedKmh: positiveNumberOrNull(candidate.topSpeedKmh),
    date: typeof candidate.date === 'string'
      ? candidate.date.slice(0, 30)
      : null,
    vehicleId: VEHICLE_IDS.has(candidate.vehicleId)
      ? candidate.vehicleId
      : null
  };
}

export function levelForExperience(totalExperience) {
  let remaining = Math.max(
    0,
    Math.floor(nonNegativeNumber(totalExperience))
  );
  let level = 1;
  let requiredXp = XP_LEVEL_BASE;
  while (remaining >= requiredXp) {
    remaining -= requiredXp;
    level += 1;
    requiredXp = XP_LEVEL_BASE + (level - 1) * XP_LEVEL_STEP;
  }
  return {
    level,
    currentXp: remaining,
    requiredXp,
    totalXp: Math.max(0, Math.floor(nonNegativeNumber(totalExperience))),
    progress: Math.min(100, Math.floor(remaining / requiredXp * 100))
  };
}

export function validatePlayerProgression(input, now = Date.now()) {
  const defaults = createDefaultProfile(now);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return defaults;
  }

  const profile = {
    ...defaults,
    alias: typeof input.alias === 'string'
      ? input.alias.trim().slice(0, 24) || defaults.alias
      : defaults.alias,
    createdAt: Number.isFinite(Number(input.createdAt)) &&
      Number(input.createdAt) > 0
      ? Number(input.createdAt)
      : now,
    xp: Math.floor(nonNegativeNumber(input.xp))
  };

  for (const key of COUNT_KEYS) {
    profile.stats[key] = Math.floor(nonNegativeNumber(input.stats?.[key]));
  }
  for (const key of ['distanceMeters', 'timePlayedSeconds']) {
    profile.stats[key] = nonNegativeNumber(input.stats?.[key]);
  }

  profile.eventIds = Array.isArray(input.eventIds)
    ? [...new Set(input.eventIds.filter((id) =>
      typeof id === 'string' && id.length > 0 && id.length <= 180
    ))].slice(-MAX_EVENT_IDS)
    : [];
  profile.rewardIds = Array.isArray(input.rewardIds)
    ? [...new Set(input.rewardIds.filter((id) =>
      typeof id === 'string' && id.length > 0 && id.length <= 180
    ))]
    : [];
  profile.vehicleUses = input.vehicleUses &&
    typeof input.vehicleUses === 'object' &&
    !Array.isArray(input.vehicleUses)
    ? Object.fromEntries(Object.entries(input.vehicleUses)
      .filter(([id]) => VEHICLE_IDS.has(id))
      .map(([id, count]) => [
        id,
        Math.floor(nonNegativeNumber(count))
      ]))
    : {};
  profile.records = input.records &&
    typeof input.records === 'object' &&
    !Array.isArray(input.records)
    ? Object.fromEntries(Object.entries(input.records)
      .filter(([trackId]) => TRACK_IDS.has(trackId))
      .map(([trackId, record]) => [trackId, normalizeRecord(record)]))
    : {};
  profile.history = Array.isArray(input.history)
    ? input.history.filter((entry) =>
      entry && typeof entry === 'object' &&
      typeof entry.eventId === 'string' &&
      (EVENT_TYPES.has(entry.type) || entry.type === 'xp')
    ).slice(-MAX_HISTORY).map((entry) => ({
      eventId: entry.eventId.slice(0, 180),
      type: entry.type,
      trackId: TRACK_IDS.has(entry.trackId) ? entry.trackId : null,
      timestamp: Number.isFinite(Number(entry.timestamp))
        ? Number(entry.timestamp)
        : now,
      position: Number.isInteger(entry.position) && entry.position > 0
        ? entry.position
        : null,
      elapsedTime: positiveNumberOrNull(entry.elapsedTime),
      amount: Number.isFinite(Number(entry.amount))
        ? Number(entry.amount)
        : null,
      description: typeof entry.description === 'string'
        ? entry.description.slice(0, 90)
        : null
    }))
    : [];
  return profile;
}

function getStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage;
  } catch (error) {
    console.warn('Player progression storage is unavailable.', error);
    return null;
  }
}

export function loadPlayerProgression(storage, now = Date.now()) {
  const selectedStorage = getStorage(storage);
  if (!selectedStorage) return createDefaultProfile(now);
  try {
    const raw = selectedStorage.getItem(PLAYER_PROGRESSION_KEY);
    if (!raw) return createDefaultProfile(now);
    const parsed = JSON.parse(raw);
    if (parsed.version !== PLAYER_PROGRESSION_VERSION) {
      return createDefaultProfile(now);
    }
    return validatePlayerProgression(parsed, now);
  } catch (error) {
    console.warn('Player progression is invalid; using defaults.', error);
    return createDefaultProfile(now);
  }
}

export function savePlayerProgression(profile, storage) {
  const selectedStorage = getStorage(storage);
  if (!selectedStorage) return false;
  try {
    selectedStorage.setItem(
      PLAYER_PROGRESSION_KEY,
      JSON.stringify(validatePlayerProgression(profile))
    );
    return true;
  } catch (error) {
    console.error('Unable to persist player progression.', error);
    return false;
  }
}

function pushHistory(profile, entry) {
  profile.history.push({
    timestamp: Date.now(),
    position: null,
    elapsedTime: null,
    amount: null,
    description: null,
    trackId: null,
    ...entry
  });
  profile.history = profile.history.slice(-MAX_HISTORY);
}

function addExperience(profile, rewardId, amount, description, timestamp) {
  if (!rewardId || profile.rewardIds.includes(rewardId)) return false;
  const reward = Math.floor(nonNegativeNumber(amount));
  profile.rewardIds.push(rewardId);
  profile.xp += reward;
  pushHistory(profile, {
    eventId: rewardId,
    type: 'xp',
    amount: reward,
    description: String(description ?? '').slice(0, 90),
    timestamp
  });
  return true;
}

function validRaceId(event) {
  return typeof event.raceId === 'string' &&
    event.raceId.length > 0 &&
    event.raceId.length <= 100;
}

function isValidEvent(event) {
  if (!event || !EVENT_TYPES.has(event.type) ||
      typeof event.eventId !== 'string' || !event.eventId ||
      event.eventId.length > 180 ||
      !TRACK_IDS.has(event.trackId) ||
      !validRaceId(event)) return false;
  const data = event.data && typeof event.data === 'object'
    ? event.data
    : null;
  if (!data) return false;
  switch (event.type) {
    case 'race_started':
      return Number.isInteger(data.laps) && data.laps > 0 &&
        Number.isInteger(data.rivalCount) && data.rivalCount >= 0;
    case 'race_finished':
      return data.completed === true &&
        Number.isInteger(data.position) && data.position > 0 &&
        Number.isFinite(data.elapsedTime) && data.elapsedTime > 0 &&
        Number.isInteger(data.collisions) && data.collisions >= 0 &&
        Number.isFinite(data.distanceMeters) && data.distanceMeters >= 0;
    case 'race_abandoned':
      return Number.isFinite(data.elapsedTime) && data.elapsedTime >= 0 &&
        Number.isFinite(data.distanceMeters) && data.distanceMeters >= 0;
    case 'lap_completed':
      return Number.isInteger(data.lap) && data.lap > 0 &&
        Number.isFinite(data.lapTime) && data.lapTime > 0;
    case 'collision':
      return Number.isInteger(data.collisions) && data.collisions > 0;
    case 'overtake':
      return ['nova', 'blaze', 'volt'].includes(data.rivalId);
    case 'jump_landed':
      return Number.isFinite(data.airTime) && data.airTime > 0;
    case 'obstacle_avoided':
      return typeof data.obstacleId === 'string' &&
        typeof data.obstacleType === 'string';
    case 'checkpoint':
      return ['north', 'west', 'south'].includes(data.checkpoint) &&
        Number.isFinite(data.progress) &&
        data.progress >= 0 && data.progress <= 1;
    case 'sector_completed':
      return ['north', 'west', 'south'].includes(data.checkpoint) &&
        Number.isFinite(data.seconds) && data.seconds > 0;
    case 'record_improved':
      return Number.isFinite(data.lapTime) && data.lapTime > 0;
    case 'speed_sample':
      return Number.isFinite(data.speedKmh) && data.speedKmh > 0;
    case 'nitro_second':
    case 'on_track_second':
      return data.seconds === 1;
    default:
      return false;
  }
}

function ensureTrackRecord(profile, trackId) {
  if (!profile.records[trackId]) {
    profile.records[trackId] = normalizeRecord(null);
  }
  return profile.records[trackId];
}

export class PlayerProgressionManager {
  constructor({ storage, now = () => Date.now() } = {}) {
    this.storage = getStorage(storage);
    this.now = now;
    this.profile = loadPlayerProgression(this.storage, now());
  }

  commit(profile) {
    if (!savePlayerProgression(profile, this.storage)) return false;
    this.profile = validatePlayerProgression(profile, this.now());
    return true;
  }

  persist() {
    return this.commit(this.profile);
  }

  grantExperience(rewardId, amount, description = '') {
    if (typeof rewardId !== 'string' || !rewardId ||
        rewardId.length > 180 ||
        this.profile.rewardIds.includes(rewardId)) return false;
    const profile = structuredClone(this.profile);
    const granted = addExperience(
      profile,
      rewardId,
      amount,
      description,
      this.now()
    );
    return granted && this.commit(profile);
  }

  recordEvent(event) {
    if (!isValidEvent(event) ||
        this.profile.eventIds.includes(event.eventId)) return false;
    const profile = structuredClone(this.profile);
    const stats = profile.stats;
    const data = event.data;
    const timestamp = this.now();
    const record = ensureTrackRecord(profile, event.trackId);
    const vehicleId = VEHICLE_IDS.has(data.vehicleId)
      ? data.vehicleId
      : null;
    let reward = null;

    profile.eventIds.push(event.eventId);
    if (profile.eventIds.length > MAX_EVENT_IDS) {
      profile.eventIds.splice(0, profile.eventIds.length - MAX_EVENT_IDS);
    }

    if (event.type === 'race_started') {
      stats.races += 1;
    } else if (event.type === 'race_abandoned') {
      stats.defeats += 1;
      stats.timePlayedSeconds += nonNegativeNumber(data.elapsedTime);
      stats.distanceMeters += Math.min(
        nonNegativeNumber(data.distanceMeters),
        10000000
      );
    } else if (event.type === 'race_finished') {
      const position = data.position;
      const elapsedTime = data.elapsedTime;
      stats.finishedRaces += 1;
      stats.timePlayedSeconds += elapsedTime;
      stats.distanceMeters += Math.min(data.distanceMeters, 10000000);
      if (position === 1) stats.wins += 1;
      if (position <= 3) stats.podiums += 1;
      else stats.defeats += 1;
      if (vehicleId) {
        profile.vehicleUses[vehicleId] =
          (profile.vehicleUses[vehicleId] ?? 0) + 1;
      }
      if (record.bestRace === null || elapsedTime < record.bestRace) {
        record.bestRace = elapsedTime;
        record.date = new Date(timestamp).toISOString();
        record.vehicleId = vehicleId;
      }
      if (record.bestPosition === null || position < record.bestPosition) {
        record.bestPosition = position;
        record.date = new Date(timestamp).toISOString();
        record.vehicleId = vehicleId;
      }
      reward = {
        id: `race:${event.raceId}:finish`,
        amount: XP_REWARDS.raceCompleted +
          (position === 1
            ? XP_REWARDS.raceWon
            : position <= 3 ? XP_REWARDS.podium : 0),
        description: 'Carrera completada'
      };
    } else if (event.type === 'lap_completed') {
      stats.laps += 1;
      if (record.bestLap === null || data.lapTime < record.bestLap) {
        record.bestLap = data.lapTime;
        record.date = new Date(timestamp).toISOString();
        record.vehicleId = vehicleId;
      }
    } else if (event.type === 'collision') {
      stats.collisions += 1;
    } else if (event.type === 'overtake') {
      stats.overtakes += 1;
    } else if (event.type === 'jump_landed') {
      stats.jumps += 1;
    } else if (event.type === 'obstacle_avoided') {
      stats.obstaclesAvoided += 1;
    } else if (event.type === 'nitro_second') {
      stats.nitroSeconds += 1;
    } else if (event.type === 'on_track_second') {
      stats.onTrackSeconds += 1;
    } else if (event.type === 'speed_sample' &&
        data.speedKmh > (record.topSpeedKmh ?? 0)) {
      record.topSpeedKmh = Math.round(data.speedKmh);
    }

    pushHistory(profile, {
      eventId: event.eventId,
      type: event.type,
      trackId: event.trackId,
      timestamp,
      position: event.type === 'race_finished' ? data.position : null,
      elapsedTime: event.type === 'race_finished'
        ? data.elapsedTime
        : event.type === 'lap_completed'
          ? data.lapTime
          : null
    });
    if (reward) {
      addExperience(
        profile,
        reward.id,
        reward.amount,
        reward.description,
        timestamp
      );
    }
    return this.commit(profile);
  }

  setAlias(alias) {
    const profile = structuredClone(this.profile);
    profile.alias = String(alias ?? '').trim().slice(0, 24) || 'PILOTO';
    return this.commit(profile);
  }

  recordMilestone(id, kind, xp, description) {
    if (typeof id !== 'string' || !id || id.length > 180 ||
        this.profile.rewardIds.includes(id)) return false;
    const profile = structuredClone(this.profile);
    if (kind === 'challenge') {
      profile.stats.challengesCompleted += 1;
    } else if (kind === 'championship') {
      profile.stats.championshipsWon += 1;
    }
    if (!addExperience(profile, id, xp, description, this.now())) {
      return false;
    }
    return this.commit(profile);
  }

  get favoriteVehicleId() {
    return Object.entries(this.profile.vehicleUses)
      .sort((first, second) =>
        second[1] - first[1] || first[0].localeCompare(second[0])
      )[0]?.[0] ?? null;
  }
}
