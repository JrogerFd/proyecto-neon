const UPGRADE_FACTORS = Object.freeze({
  engine: Object.freeze({ maxSpeed: 0.035, acceleration: 0.012 }),
  turbo: Object.freeze({ nitro: 0.06, maxSpeed: 0.01 }),
  acceleration: Object.freeze({ acceleration: 0.04 }),
  brakes: Object.freeze({ braking: 0.05 }),
  stability: Object.freeze({ stability: 0.04, handling: 0.01 })
});

export function getUpgradePreview(vehicle, category, level = 0) {
  const clampedLevel = Math.max(0, Math.min(3, Number(level) || 0));
  const factors = UPGRADE_FACTORS[category];
  if (!factors) return { ...vehicle };
  const preview = { ...vehicle };
  for (const [stat, factor] of Object.entries(factors)) {
    preview[stat] = (preview[stat] ?? 1) * (1 + factor * clampedLevel);
  }
  return preview;
}

export function applyUpgrades(vehicle, levels = {}) {
  return UPGRADE_CATEGORIES.reduce(
    (result, { id }) => getUpgradePreview(result, id, levels[id] ?? 0),
    { ...vehicle }
  );
}

export const UPGRADE_CATEGORIES = Object.freeze([
  { id: 'engine', label: 'Motor' },
  { id: 'turbo', label: 'Turbo' },
  { id: 'acceleration', label: 'Aceleración' },
  { id: 'brakes', label: 'Frenos' },
  { id: 'stability', label: 'Estabilidad' }
]);
