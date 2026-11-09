export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    id: 'easy',
    label: 'Fácil',
    targetSpeed: 0.88,
    acceleration: 1.5,
    linePrecision: 0.75,
    cornerLookAhead: 0.003,
    aggression: 0.35,
    recovery: 0.7
  }),
  normal: Object.freeze({
    id: 'normal',
    label: 'Normal',
    targetSpeed: 1,
    acceleration: 1.8,
    linePrecision: 0.88,
    cornerLookAhead: 0.004,
    aggression: 0.58,
    recovery: 1
  }),
  hard: Object.freeze({
    id: 'hard',
    label: 'Difícil',
    targetSpeed: 1.06,
    acceleration: 2.2,
    linePrecision: 0.96,
    cornerLookAhead: 0.005,
    aggression: 0.78,
    recovery: 1.25
  }),
  expert: Object.freeze({
    id: 'expert',
    label: 'Experto',
    targetSpeed: 1.1,
    acceleration: 2.5,
    linePrecision: 1,
    cornerLookAhead: 0.006,
    aggression: 0.9,
    recovery: 1.5
  })
});

export function getDifficultyConfig(id = 'normal') {
  return DIFFICULTIES[id] ?? DIFFICULTIES.normal;
}
