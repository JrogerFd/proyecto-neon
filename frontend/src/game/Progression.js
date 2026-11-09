import {
  grantWalletReward,
  saveNeonWallet
} from '../storage/NeonWallet.js';

export const PROGRESSION_KEY = 'neon-rush-progression';
export const PROGRESSION_VERSION = 1;
export const CHAMPIONSHIP_TRACKS = Object.freeze([
  'neon-city',
  'cyber-desert',
  'plasma-circuit'
]);
export const CHAMPIONSHIP_POINTS = Object.freeze({
  1: 15,
  2: 12,
  3: 10,
  4: 8
});

export const CHALLENGES = Object.freeze([
  { id: 'speed-180', category: 'Velocidad', name: 'Velocidad terminal',
    description: 'Alcanza 180 km/h en cualquier circuito.',
    goal: { type: 'speed_sample', metric: 'speedKmh', target: 180 },
    reward: 100, unlocks: ['neon-lime'] },
  { id: 'nitro-15', category: 'Velocidad', name: 'Sobrecarga',
    description: 'Usa nitro durante 15 segundos acumulados.',
    goal: { type: 'nitro_second', target: 15 },
    reward: 100, unlocks: [] },
  { id: 'sector-3', category: 'Velocidad', name: 'Ritmo perfecto',
    description: 'Completa tres sectores en menos de 20 segundos cada uno.',
    goal: { type: 'sector_completed', maxSeconds: 20, target: 3 },
    reward: 150, unlocks: ['wheel-split'] },
  { id: 'clean-race', category: 'Conducción', name: 'Línea limpia',
    description: 'Termina una carrera sin colisionar.',
    goal: { type: 'race_finished', condition: 'clean', target: 1 },
    reward: 180, unlocks: ['paint-ice'] },
  { id: 'overtakes-5', category: 'Conducción', name: 'Adelantador',
    description: 'Realiza cinco adelantamientos verificados.',
    goal: { type: 'overtake', target: 5 },
    reward: 150, unlocks: [] },
  { id: 'laps-6', category: 'Conducción', name: 'Constancia',
    description: 'Completa seis vueltas válidas.',
    goal: { type: 'lap_completed', target: 6 },
    reward: 150, unlocks: [] },
  { id: 'on-track-120', category: 'Conducción', name: 'Control total',
    description: 'Mantente sobre la pista durante 120 segundos.',
    goal: { type: 'on_track_second', target: 120 },
    reward: 180, unlocks: ['spoiler-small'] },
  { id: 'jumps-2', category: 'Habilidad', name: 'Aterrizaje limpio',
    description: 'Completa dos saltos y aterriza sobre la pista.',
    goal: { type: 'jump_landed', target: 2 },
    reward: 180, unlocks: ['livery-stripe'] },
  { id: 'obstacles-5', category: 'Habilidad', name: 'Imperturbable',
    description: 'Evita cinco obstáculos móviles activos.',
    goal: { type: 'obstacle_avoided', target: 5 },
    reward: 180, unlocks: ['neon-pink'] },
  { id: 'plasma-finish', category: 'Habilidad', name: 'Dominio de Plasma',
    description: 'Finaliza una carrera válida en PLASMA CIRCUIT.',
    goal: { type: 'race_finished', condition: 'plasma', target: 1 },
    reward: 250, unlocks: ['paint-mint'] },
  { id: 'record-improved', category: 'Tiempo', name: 'Nuevo récord',
    description: 'Mejora tu mejor tiempo de vuelta en cualquier circuito.',
    goal: { type: 'record_improved', target: 1 },
    reward: 250, unlocks: ['vehicle-thunder-x'] },
  { id: 'race-under-90', category: 'Tiempo', name: 'A contrarreloj',
    description: 'Finaliza una carrera en menos de 90 segundos.',
    goal: { type: 'race_finished', condition: 'under-90', target: 1 },
    reward: 200, unlocks: [] }
]);

export const DAILY_MISSION_POOL = Object.freeze([
  { id: 'complete-races', name: 'Kilómetros de hoy',
    description: 'Completa tres carreras.',
    goal: { type: 'race_finished' }, target: 3, reward: 120 },
  { id: 'win-race', name: 'A por la victoria',
    description: 'Gana una carrera.',
    goal: { type: 'race_finished', condition: 'win' }, target: 1, reward: 150 },
  { id: 'daily-overtakes', name: 'Tráfico superado',
    description: 'Realiza cinco adelantamientos.',
    goal: { type: 'overtake' }, target: 5, reward: 120 },
  { id: 'daily-nitro', name: 'Depósito al rojo',
    description: 'Usa nitro durante 20 segundos.',
    goal: { type: 'nitro_second' }, target: 20, reward: 120 },
  { id: 'daily-clean', name: 'Sin rasguños',
    description: 'Termina una carrera sin colisiones.',
    goal: { type: 'race_finished', condition: 'clean' },
    target: 1, reward: 150 },
  { id: 'daily-obstacles', name: 'Paso seguro',
    description: 'Evita tres obstáculos móviles activos.',
    goal: { type: 'obstacle_avoided' }, target: 3, reward: 120 },
  { id: 'daily-jumps', name: 'Vuelo controlado',
    description: 'Aterriza dos saltos correctamente.',
    goal: { type: 'jump_landed' }, target: 2, reward: 120 },
  { id: 'daily-plasma', name: 'Ruta extrema',
    description: 'Completa una carrera en PLASMA CIRCUIT.',
    goal: { type: 'race_finished', condition: 'plasma' },
    target: 1, reward: 180 }
]);

const VALID_EVENT_TYPES = new Set([
  'race_started',
  'race_finished',
  'race_abandoned',
  'lap_completed',
  'collision',
  'overtake',
  'nitro_second',
  'jump_landed',
  'speed_sample',
  'checkpoint',
  'record_improved',
  'obstacle_avoided',
  'sector_completed',
  'on_track_second'
]);
const DRIVER_NAMES = Object.freeze({
  player: 'TÚ',
  nova: 'NOVA',
  blaze: 'BLAZE',
  volt: 'VOLT'
});

function utcDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function createCup() {
  return {
    id: null,
    status: 'not_started',
    roundIndex: 0,
    races: [],
    standings: [],
    championIds: [],
    playerPosition: null,
    reward: 0,
    unlocks: [],
    rewardClaimed: false
  };
}

export function createProgressionState(timestamp = Date.now()) {
  const date = utcDate(timestamp);
  return {
    version: PROGRESSION_VERSION,
    dailyDate: date,
    dailyMissions: selectDailyMissions(date),
    challengeProgress: Object.fromEntries(CHALLENGES.map(({ id }) => [id, 0])),
    challengeClaimed: {},
    eventIds: [],
    eventLog: [],
    records: {},
    championship: createCup(),
    championshipHistory: []
  };
}

function selectDailyMissions(date) {
  const day = Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86400000);
  const start = ((day % DAILY_MISSION_POOL.length) +
    DAILY_MISSION_POOL.length) % DAILY_MISSION_POOL.length;
  return Array.from({ length: 3 }, (_, offset) => {
    const mission = DAILY_MISSION_POOL[
      (start + offset) % DAILY_MISSION_POOL.length
    ];
    return {
      id: mission.id,
      progress: 0,
      claimed: false
    };
  });
}

export function validateProgressionState(input, timestamp = Date.now()) {
  const defaults = createProgressionState(timestamp);
  if (!input || input.version !== PROGRESSION_VERSION) return defaults;
  const date = utcDate(timestamp);
  if (input.dailyDate !== date) return defaults;
  const challengeProgress = Object.fromEntries(
    CHALLENGES.map(({ id }) => {
      const progress = Number(input.challengeProgress?.[id]);
      return [id, Number.isFinite(progress) ? Math.max(0, progress) : 0];
    })
  );
  const dailyMissions = defaults.dailyMissions.map((mission) => {
    const previous = Array.isArray(input.dailyMissions)
      ? input.dailyMissions.find((item) => item.id === mission.id)
      : null;
    const definition = DAILY_MISSION_POOL.find(({ id }) => id === mission.id);
    return {
      id: mission.id,
      progress: Math.max(0, Math.min(
        definition.target,
        Number(previous?.progress) || 0
      )),
      claimed: Boolean(previous?.claimed)
    };
  });
  const history = Array.isArray(input.championshipHistory)
    ? input.championshipHistory.slice(-10).map(normalizeSeason)
    : [];
  return {
    ...defaults,
    challengeProgress,
    challengeClaimed: Object.fromEntries(
      CHALLENGES.map(({ id }) => [
        id,
        Boolean(input.challengeClaimed?.[id])
      ])
    ),
    eventIds: Array.isArray(input.eventIds)
      ? [...new Set(input.eventIds.filter((id) =>
        typeof id === 'string' && id.length <= 180
      ))].slice(-5000)
      : [],
    eventLog: Array.isArray(input.eventLog)
      ? input.eventLog.filter((event) =>
        event && VALID_EVENT_TYPES.has(event.type) &&
        typeof event.eventId === 'string'
      ).slice(-200)
      : [],
    records: input.records && typeof input.records === 'object'
      ? Object.fromEntries(Object.entries(input.records)
        .filter(([id, value]) => CHAMPIONSHIP_TRACKS.includes(id) &&
          Number.isFinite(Number(value)) && Number(value) > 0)
        .map(([id, value]) => [id, Number(value)]))
      : {},
    dailyMissions,
    championship: normalizeCup(input.championship),
    championshipHistory: history
  };
}

function normalizeCup(input) {
  if (!input || typeof input !== 'object') return createCup();
  const id = typeof input.id === 'string' && input.id.length <= 120
    ? input.id
    : null;
  const requestedStatus = ['not_started', 'in_progress', 'completed']
    .includes(input.status) ? input.status : 'not_started';
  return {
    ...createCup(),
    id,
    status: id ? requestedStatus : 'not_started',
    roundIndex: Math.max(0, Math.min(
      CHAMPIONSHIP_TRACKS.length,
      Math.floor(Number(input.roundIndex) || 0)
    )),
    races: Array.isArray(input.races)
      ? input.races.slice(0, CHAMPIONSHIP_TRACKS.length)
        .map(normalizeCupRace).filter(Boolean)
      : [],
    standings: normalizeStandings(input.standings),
    championIds: Array.isArray(input.championIds)
      ? [...new Set(input.championIds.filter((id) =>
        Object.hasOwn(DRIVER_NAMES, id)
      ))]
      : [],
    playerPosition: Number.isInteger(input.playerPosition)
      ? input.playerPosition
      : null,
    reward: Math.max(0, Math.floor(Number(input.reward) || 0)),
    unlocks: Array.isArray(input.unlocks)
      ? [...new Set(input.unlocks.filter((id) => typeof id === 'string'))]
      : [],
    rewardClaimed: Boolean(input.rewardClaimed)
  };
}

function normalizeStandings(input) {
  if (!Array.isArray(input)) return [];
  return input.filter((row) =>
    row && typeof row === 'object' &&
    Object.hasOwn(DRIVER_NAMES, row.id)
  ).map((row) => ({
    id: row.id,
    name: DRIVER_NAMES[row.id],
    position: Math.max(1, Math.floor(Number(row.position) || 1)),
    points: Math.max(0, Math.floor(Number(row.points) || 0)),
    wins: Math.max(0, Math.floor(Number(row.wins) || 0)),
    seconds: Math.max(0, Math.floor(Number(row.seconds) || 0)),
    thirds: Math.max(0, Math.floor(Number(row.thirds) || 0)),
    finishTime: Number.isFinite(Number(row.finishTime))
      ? Number(row.finishTime)
      : 0,
    timedRaces: Math.max(0, Math.floor(Number(row.timedRaces) || 0)),
    completedRaces: Math.max(0, Math.floor(Number(row.completedRaces) || 0))
  }));
}

function normalizeCupRace(race) {
  if (!race || typeof race !== 'object' ||
      typeof race.raceId !== 'string' ||
      !CHAMPIONSHIP_TRACKS.includes(race.trackId)) return null;
  const participants = Array.isArray(race.participants)
    ? race.participants.filter((participant) =>
      participant && Object.hasOwn(DRIVER_NAMES, participant.id)
    ).map((participant) => ({
      id: participant.id,
      name: DRIVER_NAMES[participant.id],
      position: Number.isInteger(participant.position) &&
        participant.position > 0
        ? participant.position
        : null,
      finishTime: participant.finishTime !== null &&
        Number.isFinite(Number(participant.finishTime))
        ? Number(participant.finishTime)
        : null,
      finished: Boolean(participant.finished)
    }))
    : [];
  return {
    raceId: race.raceId.slice(0, 100),
    trackId: race.trackId,
    status: race.status === 'dnf' ? 'dnf' : 'completed',
    elapsedTime: Math.max(0, Number(race.elapsedTime) || 0),
    participants
  };
}

function normalizeSeason(season) {
  if (!season || typeof season !== 'object') {
    return {
      id: '',
      championIds: [],
      playerPosition: null,
      standings: [],
      races: []
    };
  }
  const standings = normalizeStandings(season.standings);
  return {
    id: typeof season.id === 'string' ? season.id.slice(0, 120) : '',
    championIds: Array.isArray(season.championIds)
      ? [...new Set(season.championIds.filter((id) =>
        Object.hasOwn(DRIVER_NAMES, id)
      ))]
      : [],
    playerPosition: Number.isInteger(season.playerPosition)
      ? season.playerPosition
      : null,
    standings,
    races: Array.isArray(season.races)
      ? season.races.slice(0, CHAMPIONSHIP_TRACKS.length)
        .map(normalizeCupRace).filter(Boolean)
      : []
  };
}

export function loadProgressionState(storage, timestamp = Date.now()) {
  if (!storage) return createProgressionState(timestamp);
  try {
    const raw = storage.getItem(PROGRESSION_KEY);
    if (!raw) return createProgressionState(timestamp);
    return validateProgressionState(JSON.parse(raw), timestamp);
  } catch (error) {
    console.warn('Neon Rush progression data is invalid; using fresh progress.', error);
    return createProgressionState(timestamp);
  }
}

export function saveProgressionState(state, storage) {
  if (!storage) return false;
  try {
    storage.setItem(PROGRESSION_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error('Unable to persist Neon Rush progression.', error);
    return false;
  }
}

function goalIncrement(goal, event) {
  if (event.type !== goal.type) return 0;
  if (event.type === 'race_finished' && event.data.completed !== true) return 0;
  if (goal.condition === 'clean' && event.data.collisions !== 0) return 0;
  if (goal.condition === 'win' && event.data.position !== 1) return 0;
  if (goal.condition === 'plasma' && event.trackId !== 'plasma-circuit') return 0;
  if (goal.condition === 'under-90' &&
      !(Number(event.data.elapsedTime) < 90)) return 0;
  if (goal.maxSeconds &&
      !(Number(event.data.seconds) > 0 &&
        Number(event.data.seconds) <= goal.maxSeconds)) return 0;
  if (goal.metric) {
    return Math.max(0, Number(event.data[goal.metric]) || 0);
  }
  return Math.max(0, Number(event.data.count ?? event.data.seconds) || 1);
}

function applyEventToObjectives(objectives, event, definitions, progress) {
  for (const definition of definitions) {
    const current = progress[definition.id] ?? 0;
    const increment = goalIncrement(definition.goal, event);
    if (!increment) continue;
    progress[definition.id] = definition.goal.metric
      ? Math.max(current, increment)
      : Math.min(definition.goal.target, current + increment);
  }
  return progress;
}

function validEventData(event) {
  const { data } = event;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  switch (event.type) {
    case 'race_started':
      return Number.isInteger(data.laps) && data.laps > 0;
    case 'race_finished':
      return data.completed === true &&
        Number.isInteger(data.position) && data.position > 0 &&
        Number.isFinite(data.elapsedTime) && data.elapsedTime > 0 &&
        Number.isInteger(data.collisions) && data.collisions >= 0;
    case 'race_abandoned':
      return Number.isFinite(data.elapsedTime) && data.elapsedTime >= 0;
    case 'lap_completed':
      return Number.isInteger(data.lap) && data.lap > 0 &&
        Number.isFinite(data.lapTime) && data.lapTime > 0;
    case 'collision':
      return typeof data.source === 'string' &&
        Number.isInteger(data.collisions) && data.collisions > 0;
    case 'overtake':
      return ['nova', 'blaze', 'volt'].includes(data.rivalId) &&
        data.count === 1;
    case 'nitro_second':
    case 'on_track_second':
      return data.seconds === 1;
    case 'jump_landed':
      return Number.isFinite(data.airTime) && data.airTime > 0;
    case 'speed_sample':
      return Number.isFinite(data.speedKmh) && data.speedKmh > 0;
    case 'checkpoint':
      return ['north', 'west', 'south'].includes(data.checkpoint) &&
        Number.isFinite(data.progress) &&
        data.progress >= 0 && data.progress <= 1;
    case 'record_improved':
      return Number.isFinite(data.lapTime) && data.lapTime > 0;
    case 'obstacle_avoided':
      return typeof data.obstacleId === 'string' &&
        typeof data.obstacleType === 'string';
    case 'sector_completed':
      return ['north', 'west', 'south'].includes(data.checkpoint) &&
        Number.isFinite(data.seconds) && data.seconds > 0;
    default:
      return false;
  }
}

export function recordProgressionEvent(stateInput, event, timestamp = Date.now()) {
  if (!event || !VALID_EVENT_TYPES.has(event.type) ||
      typeof event.eventId !== 'string' || event.eventId.length === 0 ||
      event.eventId.length > 180 ||
      typeof event.raceId !== 'string' || !event.raceId.length ||
      event.raceId.length > 100 ||
      !CHAMPIONSHIP_TRACKS.includes(event.trackId) ||
      !validEventData(event)) {
    return { accepted: false, state: stateInput };
  }
  const state = validateProgressionState(stateInput, timestamp);
  if (state.eventIds.includes(event.eventId)) {
    return { accepted: false, duplicate: true, state };
  }
  const normalizedEvent = {
    ...event,
    trackId: event.trackId,
    data: event.data && typeof event.data === 'object' ? event.data : {}
  };
  state.eventIds.push(event.eventId);
  if (state.eventIds.length > 5000) state.eventIds.splice(0, 1000);
  state.eventLog.push(normalizedEvent);
  if (state.eventLog.length > 200) state.eventLog.splice(0, 50);

  applyEventToObjectives(
    state.challengeProgress,
    normalizedEvent,
    CHALLENGES,
    state.challengeProgress
  );
  for (const mission of state.dailyMissions) {
    const definition = DAILY_MISSION_POOL.find(({ id }) => id === mission.id);
    if (!definition || mission.claimed) continue;
    const increment = goalIncrement(definition.goal, normalizedEvent);
    mission.progress = Math.min(definition.target, mission.progress + increment);
  }

  let recordImproved = false;
  if (normalizedEvent.type === 'lap_completed') {
    const lapTime = Number(normalizedEvent.data.lapTime);
    const previous = state.records[normalizedEvent.trackId];
    if (Number.isFinite(lapTime) && lapTime > 0 &&
        (previous === undefined || lapTime < previous)) {
      state.records[normalizedEvent.trackId] = lapTime;
      recordImproved = true;
      const derived = {
        ...normalizedEvent,
        eventId: `${normalizedEvent.eventId}:record`,
        type: 'record_improved',
        data: { previous: previous ?? null, lapTime }
      };
      state.eventIds.push(derived.eventId);
      state.eventLog.push(derived);
      if (state.eventLog.length > 200) state.eventLog.splice(0, 50);
      applyEventToObjectives(
        state.challengeProgress,
        derived,
        CHALLENGES,
        state.challengeProgress
      );
    }
  }
  return { accepted: true, recordImproved, state };
}

function makeCupId(timestamp) {
  return globalThis.crypto?.randomUUID?.() ??
    `neon-cup-${timestamp}-${Math.random().toString(36).slice(2)}`;
}

export function startChampionship(stateInput, timestamp = Date.now(), id) {
  const state = validateProgressionState(stateInput, timestamp);
  if (state.championship.status === 'in_progress') {
    return { state, championship: state.championship, resumed: true };
  }
  if (state.championship.status === 'completed') {
    state.championshipHistory.push({
      id: state.championship.id,
      championIds: state.championship.championIds,
      playerPosition: state.championship.playerPosition,
      standings: state.championship.standings,
      races: state.championship.races
    });
    state.championshipHistory = state.championshipHistory.slice(-10);
  }
  state.championship = {
    ...createCup(),
    id: id ?? makeCupId(timestamp),
    status: 'in_progress'
  };
  return { state, championship: state.championship, resumed: false };
}

function calculateCupStandings(races) {
  const table = new Map();
  for (const race of races) {
    for (const participant of race.participants ?? []) {
      if (!participant.id || !participant.name) continue;
      if (!table.has(participant.id)) {
        table.set(participant.id, {
          id: participant.id,
          name: participant.name,
          points: 0,
          wins: 0,
          seconds: 0,
          thirds: 0,
          finishTime: 0,
          timedRaces: 0,
          completedRaces: 0
        });
      }
      const row = table.get(participant.id);
      const place = Number(participant.position);
      if (Number.isInteger(place) && place > 0) {
        row.points += CHAMPIONSHIP_POINTS[place] ?? 0;
        if (place === 1) row.wins += 1;
        if (place === 2) row.seconds += 1;
        if (place === 3) row.thirds += 1;
      }
      if (participant.finishTime !== null &&
          Number.isFinite(Number(participant.finishTime))) {
        row.finishTime += Number(participant.finishTime);
        row.timedRaces += 1;
      }
      if (participant.finished === true) {
        row.completedRaces += 1;
      }
    }
  }
  return [...table.values()].sort((first, second) =>
    second.points - first.points ||
    second.wins - first.wins ||
    second.seconds - first.seconds ||
    second.thirds - first.thirds ||
    second.completedRaces - first.completedRaces ||
    first.finishTime - second.finishTime ||
    first.id.localeCompare(second.id)
  ).map((row, index, list) => ({
    ...row,
    position: index > 0 &&
      row.points === list[index - 1].points &&
      row.wins === list[index - 1].wins &&
      row.seconds === list[index - 1].seconds &&
      row.thirds === list[index - 1].thirds &&
      row.completedRaces === list[index - 1].completedRaces &&
      row.timedRaces === list[index - 1].timedRaces &&
      row.finishTime === list[index - 1].finishTime
      ? list[index - 1].position
      : index + 1
  }));
}

function championReward(position, championId) {
  const rewards = { 1: 1000, 2: 700, 3: 500, 4: 300 };
  const unlockByPosition = {
    1: championId === 'player' ? 'vehicle-nova-hyper' : null,
    2: 'neon-lime',
    3: 'paint-ice',
    4: 'spoiler-small'
  };
  return {
    coins: rewards[position] ?? 0,
    unlocks: unlockByPosition[position]
      ? [unlockByPosition[position]]
      : []
  };
}

export function recordChampionshipRace(stateInput, result, timestamp = Date.now()) {
  const state = validateProgressionState(stateInput, timestamp);
  const cup = state.championship;
  if (!cup.id || cup.status !== 'in_progress' ||
      !result || typeof result.raceId !== 'string' ||
      !CHAMPIONSHIP_TRACKS.includes(result.trackId) ||
      result.championshipId !== cup.id) {
    return { accepted: false, state, championship: cup };
  }
  if (cup.races.some((race) => race.raceId === result.raceId)) {
    return { accepted: false, duplicate: true, state, championship: cup };
  }
  const expectedTrack = CHAMPIONSHIP_TRACKS[cup.roundIndex];
  if (result.trackId !== expectedTrack ||
      (!result.abandoned && result.completed !== true)) {
    return { accepted: false, state, championship: cup };
  }
  const participants = result.abandoned
    ? [{ id: 'player', name: 'TÚ', position: null, finishTime: null }]
    : (Array.isArray(result.participants) ? result.participants : [])
      .filter(({ id, name }) => typeof id === 'string' && typeof name === 'string')
      .map(({ id, name, position, finishTime, finished }) => ({
        id,
        name,
        position: Number.isInteger(position) && position > 0
          ? position
          : null,
        finishTime: finishTime !== null &&
          Number.isFinite(Number(finishTime))
          ? Number(finishTime)
          : null,
        finished: Boolean(finished)
      }));
  if (!participants.some(({ id }) => id === 'player')) {
    participants.push({
      id: 'player',
      name: 'TÚ',
      position: null,
      finishTime: null,
      finished: false
    });
  }
  cup.races.push({
    raceId: result.raceId,
    trackId: result.trackId,
    status: result.abandoned ? 'dnf' : 'completed',
    elapsedTime: Number(result.elapsedTime) || 0,
    participants
  });
  cup.roundIndex += 1;
  cup.standings = calculateCupStandings(cup.races);
  if (cup.roundIndex >= CHAMPIONSHIP_TRACKS.length) {
    cup.status = 'completed';
    const hasPoints = cup.standings.some(({ points }) => points > 0);
    cup.championIds = hasPoints
      ? cup.standings.filter(({ position }) => position === 1)
        .map(({ id }) => id)
      : [];
    cup.playerPosition = cup.standings.find(
      ({ id }) => id === 'player'
    )?.position ?? null;
    if (!hasPoints) cup.playerPosition = null;
    const reward = championReward(
      cup.playerPosition,
      cup.championIds.includes('player') ? 'player' : null
    );
    cup.reward = reward.coins;
    cup.unlocks = reward.unlocks;
    cup.rewardClaimed = false;
  }
  return { accepted: true, state, championship: cup };
}

export function getDailyMissionView(stateInput, timestamp = Date.now()) {
  const state = validateProgressionState(stateInput, timestamp);
  const untilMidnight = Date.parse(`${state.dailyDate}T00:00:00.000Z`) +
    86400000 - timestamp;
  return state.dailyMissions.map((progress) => {
    const definition = DAILY_MISSION_POOL.find(({ id }) => id === progress.id);
    return {
      ...definition,
      ...progress,
      complete: progress.progress >= definition.target,
      remainingSeconds: Math.max(0, Math.ceil(untilMidnight / 1000))
    };
  });
}

export function getChallengeView(stateInput, timestamp = Date.now()) {
  const state = validateProgressionState(stateInput, timestamp);
  return CHALLENGES.map((challenge) => {
    const progress = state.challengeProgress[challenge.id] ?? 0;
    return {
      ...challenge,
      progress: Math.min(challenge.goal.target, progress),
      complete: progress >= challenge.goal.target,
      claimed: Boolean(state.challengeClaimed[challenge.id])
    };
  });
}

export class ProgressionManager {
  constructor({
    storage = globalThis.localStorage,
    wallet,
    saveWallet = (nextWallet) => saveNeonWallet(nextWallet),
    now = () => Date.now()
  } = {}) {
    this.storage = storage;
    this.wallet = wallet;
    this.saveWallet = saveWallet;
    this.now = now;
    this.state = loadProgressionState(storage, now());
    this.claimPendingRewards();
  }

  persist() {
    return saveProgressionState(this.state, this.storage);
  }

  grant(rewardId, coins, unlocks = [], description = rewardId) {
    const result = grantWalletReward(
      this.wallet,
      {
        rewardId,
        amount: coins,
        unlocks,
        description,
        timestamp: this.now()
      }
    );
    if (!result.ok) return false;
    if (!result.duplicate && !this.saveWallet(result.wallet)) return false;
    this.wallet = result.wallet;
    return true;
  }

  claimPendingRewards() {
    for (const challenge of CHALLENGES) {
      if (this.state.challengeProgress[challenge.id] >= challenge.goal.target &&
          !this.state.challengeClaimed[challenge.id]) {
        if (!this.grant(
          `challenge:${challenge.id}`,
          challenge.reward,
          challenge.unlocks,
          challenge.name
        )) continue;
        this.state.challengeClaimed[challenge.id] = true;
        this.persist();
      }
    }
    for (const mission of getDailyMissionView(this.state, this.now())) {
      const saved = this.state.dailyMissions.find(({ id }) => id === mission.id);
      if (mission.complete && !saved.claimed) {
        if (!this.grant(
          `daily:${this.state.dailyDate}:${mission.id}`,
          mission.reward,
          [],
          mission.name
        )) continue;
        saved.claimed = true;
        this.persist();
      }
    }
    const cup = this.state.championship;
    if (cup.status === 'completed' && !cup.rewardClaimed) {
      if (!this.grant(
        `championship:${cup.id}`,
        cup.reward,
        cup.unlocks,
        'NEON CUP'
      )) return;
      cup.rewardClaimed = true;
      this.persist();
    }
  }

  recordEvent(event) {
    const result = recordProgressionEvent(this.state, event, this.now());
    if (!result.accepted) return result;
    this.state = result.state;
    this.persist();
    this.claimPendingRewards();
    return { ...result, state: this.state };
  }

  beginChampionship(id) {
    const result = startChampionship(this.state, this.now(), id);
    this.state = result.state;
    this.persist();
    return result;
  }

  recordCupRace(result) {
    const saved = recordChampionshipRace(this.state, result, this.now());
    if (!saved.accepted) return saved;
    this.state = saved.state;
    this.persist();
    this.claimPendingRewards();
    return { ...saved, state: this.state };
  }
}
