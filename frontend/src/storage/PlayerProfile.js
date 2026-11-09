import { VEHICLE_BY_ID } from '../game/VehicleCatalog.js';

export const PLAYER_PROFILE_KEY = 'neon-rush-player-profile';
export const PLAYER_PROFILE_VERSION = 1;

export const DEFAULT_PLAYER_PROFILE = Object.freeze({
  vehicleId: 'neon-starter',
  selectedTrack: 'neon-city',
  quality: 'medium',
  customization: {
    bodyColor: '#7517ff',
    neonColor: '#00eaff',
    wheelStyle: 'turbine',
    livery: 'none',
    spoiler: 'factory'
  }
});

const QUALITY_PROFILES = new Set(['low', 'medium', 'high']);
const TRACK_IDS = new Set(['neon-city', 'cyber-desert', 'plasma-circuit']);
const WHEEL_STYLES = new Set(['turbine', 'split', 'disc']);
const LIVERIES = new Set(['none', 'racing-stripe', 'circuit-lines']);
const SPOILERS = new Set(['factory', 'none', 'small', 'large']);
const COLOR_PATTERN = /^#[\da-f]{6}$/i;

function sanitizeCustomization(value, vehicle) {
  const candidate = value && typeof value === 'object' ? value : {};
  return {
    bodyColor: COLOR_PATTERN.test(candidate.bodyColor)
      ? candidate.bodyColor
      : vehicle.bodyColor,
    neonColor: COLOR_PATTERN.test(candidate.neonColor)
      ? candidate.neonColor
      : vehicle.neonColor,
    wheelStyle: WHEEL_STYLES.has(candidate.wheelStyle)
      ? candidate.wheelStyle
      : DEFAULT_PLAYER_PROFILE.customization.wheelStyle,
    livery: LIVERIES.has(candidate.livery)
      ? candidate.livery
      : DEFAULT_PLAYER_PROFILE.customization.livery,
    spoiler: SPOILERS.has(candidate.spoiler)
      ? candidate.spoiler
      : DEFAULT_PLAYER_PROFILE.customization.spoiler
  };
}

export function validatePlayerProfile(input) {
  const candidate = input && typeof input === 'object' ? input : {};
  const vehicle = VEHICLE_BY_ID.get(candidate.vehicleId) ?? VEHICLE_BY_ID.get(
    DEFAULT_PLAYER_PROFILE.vehicleId
  );
  return {
    version: PLAYER_PROFILE_VERSION,
    vehicleId: vehicle.id,
    selectedTrack: TRACK_IDS.has(candidate.selectedTrack)
      ? candidate.selectedTrack
      : DEFAULT_PLAYER_PROFILE.selectedTrack,
    quality: QUALITY_PROFILES.has(candidate.quality)
      ? candidate.quality
      : DEFAULT_PLAYER_PROFILE.quality,
    customization: sanitizeCustomization(candidate.customization, vehicle)
  };
}

function getStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage;
  } catch (error) {
    console.warn('Neon Rush storage is unavailable; using defaults.', error);
    return null;
  }
}

export function loadPlayerProfile(storage) {
  const selectedStorage = getStorage(storage);
  if (!selectedStorage) return validatePlayerProfile(DEFAULT_PLAYER_PROFILE);

  try {
    const raw = selectedStorage.getItem(PLAYER_PROFILE_KEY);
    if (!raw) return validatePlayerProfile(DEFAULT_PLAYER_PROFILE);
    const parsed = JSON.parse(raw);
    if (parsed.version !== PLAYER_PROFILE_VERSION) {
      return validatePlayerProfile(DEFAULT_PLAYER_PROFILE);
    }
    return validatePlayerProfile(parsed);
  } catch (error) {
    console.warn('Neon Rush profile is invalid; using defaults.', error);
    return validatePlayerProfile(DEFAULT_PLAYER_PROFILE);
  }
}

export function savePlayerProfile(profile, storage) {
  const selectedStorage = getStorage(storage);
  if (!selectedStorage) return false;
  const validated = validatePlayerProfile(profile);
  try {
    selectedStorage.setItem(PLAYER_PROFILE_KEY, JSON.stringify(validated));
    return true;
  } catch (error) {
    console.error('Unable to save the Neon Rush player profile.', error);
    return false;
  }
}
