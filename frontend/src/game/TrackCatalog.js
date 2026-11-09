export const TRACKS = Object.freeze([
  Object.freeze({
    id: 'neon-city',
    name: 'NEON CITY',
    description: 'Un sprint nocturno entre avenidas y torres luminosas.',
    difficulty: 'Fácil',
    width: 14,
    checkpoints: Object.freeze([0.25, 0.5, 0.75]),
    environment: 'city',
    accent: '#00eaff',
    zones: Object.freeze([
      Object.freeze({ start: 0.14, end: 0.16, type: 'ramp', factor: 1 }),
      Object.freeze({ start: 0.63, end: 0.68, type: 'boost', factor: 1.14 })
    ]),
    controls: null
  }),
  Object.freeze({
    id: 'cyber-desert',
    name: 'CYBER DESERT',
    description: 'Un trazado desértico de curvas abiertas y terreno suelto.',
    difficulty: 'Media',
    width: 14,
    checkpoints: Object.freeze([0.25, 0.5, 0.75]),
    environment: 'desert',
    accent: '#ffae35',
    zones: Object.freeze([
      Object.freeze({ start: 0.41, end: 0.49, type: 'sand', factor: 0.68 }),
      Object.freeze({ start: 0.61, end: 0.64, type: 'ramp', factor: 1 })
    ]),
    controls: Object.freeze([
      [-5, -63], [31, -59], [51, -36], [40, -8],
      [55, 21], [35, 51], [2, 63], [-35, 53],
      [-54, 22], [-43, -12], [-55, -42], [-31, -62]
    ])
  }),
  Object.freeze({
    id: 'plasma-circuit',
    name: 'PLASMA CIRCUIT',
    description: 'Un complejo técnico de chicanas y cambios de ritmo.',
    difficulty: 'Experta',
    width: 13,
    checkpoints: Object.freeze([0.25, 0.5, 0.75]),
    environment: 'plasma',
    accent: '#ff47d2',
    zones: Object.freeze([
      Object.freeze({ start: 0.36, end: 0.43, type: 'ramp', factor: 1 })
    ]),
    controls: Object.freeze([
      [-3, -73], [31, -66], [45, -43], [18, -22],
      [49, -4], [53, 25], [28, 48], [4, 60],
      [-23, 53], [-46, 28], [-31, -3], [-50, -34],
      [-30, -65]
    ])
  })
]);

export const TRACK_BY_ID = new Map(
  TRACKS.map((track) => [track.id, track])
);

export function getTrackDefinition(trackId = 'neon-city') {
  return TRACK_BY_ID.get(trackId) ?? TRACKS[0];
}
