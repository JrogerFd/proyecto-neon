import { VEHICLES } from './VehicleCatalog.js';
import { UPGRADE_CATEGORIES } from './UpgradePreview.js';

export const NEON_COINS_REWARDS = Object.freeze({
  positions: Object.freeze({ 1: 500, 2: 300, 3: 200, 4: 100 }),
  completionBonus: 100
});

const colors = Object.freeze({
  paints: [
    { id: 'paint-purple', name: 'Amatista', color: '#7517ff', price: 0 },
    { id: 'paint-red', name: 'Rojo plasma', color: '#e34235', price: 180 },
    { id: 'paint-ice', name: 'Hielo polar', color: '#d8e1ee', price: 220 },
    { id: 'paint-mint', name: 'Menta cibernética', color: '#286b61', price: 240 },
    { id: 'paint-pink', name: 'Rosa nova', color: '#b020bb', price: 260 }
  ],
  neons: [
    { id: 'neon-cyan', name: 'Cian', color: '#00eaff', price: 0 },
    { id: 'neon-orange', name: 'Naranja', color: '#ffae35', price: 140 },
    { id: 'neon-pink', name: 'Magenta', color: '#ff47d2', price: 180 },
    { id: 'neon-lime', name: 'Lima', color: '#63ff9c', price: 200 }
  ]
});

const cosmeticItems = [
  ...colors.paints.map((item) => ({
    ...item, category: 'paint', description: 'Pintura de carrocería equipable.',
    effect: { field: 'bodyColor', value: item.color }
  })),
  ...colors.neons.map((item) => ({
    ...item, category: 'neon', description: 'Color de neón y efectos equipable.',
    effect: { field: 'neonColor', value: item.color }
  })),
  ...[
    { id: 'wheel-turbine', name: 'Turbina', price: 0 },
    { id: 'wheel-split', name: 'Radios dobles', price: 220 },
    { id: 'wheel-disc', name: 'Disco aerodinámico', price: 260 }
  ].map((item) => ({
    ...item, category: 'wheels', description: 'Juego de llantas visible en el vehículo.',
    effect: { field: 'wheelStyle', value: item.id.replace('wheel-', '') }
  })),
  ...[
    { id: 'spoiler-factory', name: 'De fábrica', value: 'factory', price: 0 },
    { id: 'spoiler-none', name: 'Sin alerón', value: 'none', price: 100 },
    { id: 'spoiler-small', name: 'Alerón compacto', value: 'small', price: 240 },
    { id: 'spoiler-large', name: 'Alerón competición', value: 'large', price: 400 }
  ].map((item) => ({
    ...item, category: 'spoilers', description: 'Alerón visible en el modelo del vehículo.',
    effect: { field: 'spoiler', value: item.value }
  })),
  ...[
    { id: 'livery-none', name: 'Sin diseño', value: 'none', price: 0 },
    { id: 'livery-stripe', name: 'Franjas de competición', value: 'racing-stripe', price: 300 },
    { id: 'livery-circuit', name: 'Líneas de circuito', value: 'circuit-lines', price: 340 }
  ].map((item) => ({
    ...item, category: 'liveries', description: 'Diseño aplicado realmente a la carrocería.',
    effect: { field: 'livery', value: item.value }
  }))
];

const vehicleItems = VEHICLES
  .filter((vehicle) => vehicle.id !== 'neon-starter')
  .map((vehicle) => ({
    id: `vehicle-${vehicle.id}`,
    name: vehicle.name,
    category: 'vehicles',
    price: vehicle.id === 'nova-hyper' ? 1200 : 800,
    description: `${vehicle.description} Se puede seleccionar para las carreras.`,
    effect: { field: 'vehicleId', value: vehicle.id },
    preview: { color: vehicle.bodyColor, kind: 'vehicle' }
  }));

const upgradePrices = [260, 440, 700];
const upgradeItems = UPGRADE_CATEGORIES.flatMap((upgrade) =>
  upgradePrices.map((price, index) => ({
    id: `upgrade-${upgrade.id}-${index + 1}`,
    name: `${upgrade.label} · nivel ${index + 1}`,
    category: 'upgrades',
    price,
    description: `Mejora funcional de ${upgrade.label.toLowerCase()} aplicada a la física de carrera.`,
    effect: { category: upgrade.id, level: index + 1 }
  }))
);

export const STORE_ITEMS = Object.freeze([
  ...vehicleItems,
  ...cosmeticItems,
  ...upgradeItems
].map((item) => Object.freeze({
  ...item,
  preview: item.preview ?? Object.freeze({
    color: item.effect.value ?? null,
    kind: item.category
  })
})));

export const STORE_CATEGORIES = Object.freeze([
  { id: 'all', label: 'Todo' },
  { id: 'vehicles', label: 'Vehículos' },
  { id: 'paint', label: 'Pinturas' },
  { id: 'wheels', label: 'Llantas' },
  { id: 'neon', label: 'Luces neón' },
  { id: 'spoilers', label: 'Alerones' },
  { id: 'liveries', label: 'Diseños' },
  { id: 'upgrades', label: 'Mejoras' }
]);

export const STARTER_INVENTORY = Object.freeze([
  'vehicle-neon-starter',
  'paint-purple',
  'neon-cyan',
  'wheel-turbine',
  'spoiler-factory',
  'livery-none'
]);

export function getStoreItem(itemId) {
  return STORE_ITEMS.find((item) => item.id === itemId) ?? null;
}

export function getItemEquipmentKey(item) {
  if (item.category === 'vehicles') return 'vehicleId';
  if (item.category === 'paint') return 'paint';
  if (item.category === 'neon') return 'neon';
  if (item.category === 'wheels') return 'wheels';
  if (item.category === 'spoilers') return 'spoiler';
  if (item.category === 'liveries') return 'livery';
  return null;
}
