import {
  getItemEquipmentKey,
  getStoreItem,
  NEON_COINS_REWARDS,
  STARTER_INVENTORY,
  STORE_ITEMS
} from '../game/Economy.js';
import { UPGRADE_CATEGORIES } from '../game/UpgradePreview.js';

export const NEON_WALLET_KEY = 'neon-rush-neon-wallet';
export const NEON_WALLET_VERSION = 1;
const MAX_LEDGER_ENTRIES = 500;
const validItemIds = new Set([
  ...STARTER_INVENTORY,
  ...STORE_ITEMS.map(({ id }) => id)
]);

function defaultWallet() {
  return {
    version: NEON_WALLET_VERSION,
    balance: 0,
    totalEarned: 0,
    totalSpent: 0,
    inventory: [...STARTER_INVENTORY],
    equipment: {
      vehicleId: 'vehicle-neon-starter',
      paint: 'paint-purple',
      neon: 'neon-cyan',
      wheels: 'wheel-turbine',
      spoiler: 'spoiler-factory',
      livery: 'livery-none'
    },
    upgrades: Object.fromEntries(
      UPGRADE_CATEGORIES.map(({ id }) => [id, 0])
    ),
    processedRaces: [],
    processedRewards: [],
    history: []
  };
}

function asCoins(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(0, number) : 0;
}

function normalizeLedgerEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const amount = Number(entry.amount);
  if (!Number.isSafeInteger(amount) || !amount) return null;
  return {
    id: String(entry.id ?? ''),
    type: entry.type === 'purchase' ? 'purchase' : 'reward',
    amount,
    description: String(entry.description ?? '').slice(0, 120),
    timestamp: Number.isFinite(Number(entry.timestamp))
      ? Number(entry.timestamp)
      : 0,
    raceId: entry.raceId ? String(entry.raceId).slice(0, 100) : null,
    itemId: entry.itemId ? String(entry.itemId).slice(0, 100) : null
  };
}

export function validateNeonWallet(input) {
  const candidate = input && typeof input === 'object' ? input : {};
  const defaults = defaultWallet();
  const inventory = Array.isArray(candidate.inventory)
    ? [...new Set(candidate.inventory.filter((itemId) =>
      validItemIds.has(itemId)
    ))]
    : defaults.inventory;
  for (const itemId of STARTER_INVENTORY) {
    if (!inventory.includes(itemId)) inventory.push(itemId);
  }
  const equipment = { ...defaults.equipment };
  if (candidate.equipment && typeof candidate.equipment === 'object') {
    for (const [key, itemId] of Object.entries(candidate.equipment)) {
      if (key in equipment && inventory.includes(itemId)) {
        equipment[key] = itemId;
      }
    }
  }
  const upgrades = Object.fromEntries(
    UPGRADE_CATEGORIES.map(({ id }) => [
      id,
      Math.max(0, Math.min(3, Math.floor(
        Number(candidate.upgrades?.[id]) || 0
      )))
    ])
  );
  const history = Array.isArray(candidate.history)
    ? candidate.history.map(normalizeLedgerEntry).filter(Boolean)
      .slice(-MAX_LEDGER_ENTRIES)
    : [];
  return {
    version: NEON_WALLET_VERSION,
    balance: asCoins(candidate.balance),
    totalEarned: asCoins(candidate.totalEarned),
    totalSpent: asCoins(candidate.totalSpent),
    inventory,
    equipment,
    upgrades,
    processedRaces: Array.isArray(candidate.processedRaces)
      ? [...new Set(candidate.processedRaces
        .filter((id) => typeof id === 'string' && id.length > 0)
        .map((id) => id.slice(0, 100)))]
      : [],
    processedRewards: Array.isArray(candidate.processedRewards)
      ? [...new Set(candidate.processedRewards
        .filter((id) => typeof id === 'string' && id.length > 0)
        .map((id) => id.slice(0, 180)))]
      : [],
    history
  };
}

function selectedStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage;
  } catch (error) {
    console.warn('Neon Rush wallet storage is unavailable.', error);
    return null;
  }
}

export function loadNeonWallet(storage) {
  const selected = selectedStorage(storage);
  if (!selected) return defaultWallet();
  try {
    const raw = selected.getItem(NEON_WALLET_KEY);
    if (!raw) return defaultWallet();
    const parsed = JSON.parse(raw);
    if (parsed.version !== NEON_WALLET_VERSION) return defaultWallet();
    return validateNeonWallet(parsed);
  } catch (error) {
    console.warn('Neon Rush wallet data is invalid; using a fresh wallet.', error);
    return defaultWallet();
  }
}

export function saveNeonWallet(wallet, storage) {
  const selected = selectedStorage(storage);
  if (!selected) return false;
  try {
    selected.setItem(
      NEON_WALLET_KEY,
      JSON.stringify(validateNeonWallet(wallet))
    );
    return true;
  } catch (error) {
    console.error('Unable to persist the Neon Rush wallet.', error);
    return false;
  }
}

function appendHistory(wallet, entry) {
  wallet.history.push(normalizeLedgerEntry(entry));
  wallet.history = wallet.history.filter(Boolean).slice(-MAX_LEDGER_ENTRIES);
}

export function purchaseWalletItem(walletInput, itemId, timestamp = Date.now()) {
  const wallet = validateNeonWallet(walletInput);
  const item = getStoreItem(itemId);
  if (!item) return { ok: false, error: 'Artículo inexistente.', wallet };
  if (wallet.inventory.includes(item.id)) {
    return { ok: false, error: 'El artículo ya está en el inventario.', wallet };
  }
  if (item.effect.category &&
      item.effect.level !== wallet.upgrades[item.effect.category] + 1) {
    return {
      ok: false,
      error: 'Compra primero el nivel anterior de esta mejora.',
      wallet
    };
  }
  if (wallet.balance < item.price) {
    return { ok: false, error: 'Saldo insuficiente.', wallet };
  }

  wallet.balance -= item.price;
  wallet.totalSpent += item.price;
  wallet.inventory.push(item.id);
  if (item.effect.category) {
    wallet.upgrades[item.effect.category] = item.effect.level;
  } else {
    const equipmentKey = getItemEquipmentKey(item);
    if (equipmentKey) wallet.equipment[equipmentKey] = item.id;
  }
  if (item.price > 0) {
    appendHistory(wallet, {
      id: `buy-${item.id}-${timestamp}`,
      type: 'purchase',
      amount: -item.price,
      description: `Compra: ${item.name}`,
      timestamp,
      itemId: item.id
    });
  }
  return { ok: true, wallet, item };
}

export function equipWalletItem(walletInput, itemId) {
  const wallet = validateNeonWallet(walletInput);
  const item = getStoreItem(itemId);
  if (!item) return { ok: false, error: 'Artículo inexistente.', wallet };
  if (!wallet.inventory.includes(item.id)) {
    return { ok: false, error: 'El artículo no está desbloqueado.', wallet };
  }
  const equipmentKey = getItemEquipmentKey(item);
  if (!equipmentKey) {
    return { ok: false, error: 'Esta mejora ya está instalada al comprarla.', wallet };
  }
  wallet.equipment[equipmentKey] = item.id;
  return { ok: true, wallet, item };
}

export function processRaceReward(
  walletInput,
  { raceId, position, completed = true, timestamp = Date.now() } = {}
) {
  const wallet = validateNeonWallet(walletInput);
  const place = Number(position);
  if (!completed ||
      typeof raceId !== 'string' ||
      raceId.length === 0 ||
      raceId.length > 100 ||
      !Number.isSafeInteger(place) ||
      place < 1) {
    return { ok: false, duplicate: false, error: 'Resultado de carrera inválido.', wallet };
  }
  if (wallet.processedRaces.includes(raceId)) {
    return { ok: true, duplicate: true, reward: 0, wallet };
  }
  const placeReward =
    NEON_COINS_REWARDS.positions[place] ?? 0;
  const total = placeReward + NEON_COINS_REWARDS.completionBonus;
  wallet.balance += total;
  wallet.totalEarned += total;
  wallet.processedRaces.push(raceId);
  appendHistory(wallet, {
    id: `race-${raceId}`,
    type: 'reward',
    amount: total,
    description: `Carrera completada · posición ${place}`,
    timestamp,
    raceId
  });
  return {
    ok: true,
    duplicate: false,
    reward: total,
    placeReward,
    completionBonus: NEON_COINS_REWARDS.completionBonus,
    wallet
  };
}

export function grantWalletReward(
  walletInput,
  {
    rewardId,
    amount = 0,
    unlocks = [],
    description = '',
    timestamp = Date.now()
  } = {}
) {
  const wallet = validateNeonWallet(walletInput);
  const coins = Number(amount);
  if (typeof rewardId !== 'string' || !rewardId.length ||
      rewardId.length > 180 ||
      !Number.isSafeInteger(coins) || coins < 0 ||
      !Array.isArray(unlocks) ||
      unlocks.some((itemId) => !validItemIds.has(itemId))) {
    return { ok: false, duplicate: false, error: 'Recompensa inválida.', wallet };
  }
  if (wallet.processedRewards.includes(rewardId)) {
    return { ok: true, duplicate: true, wallet };
  }
  wallet.processedRewards.push(rewardId);
  const newUnlocks = [...new Set(unlocks)]
    .filter((itemId) => !wallet.inventory.includes(itemId));
  wallet.inventory.push(...newUnlocks);
  wallet.balance += coins;
  wallet.totalEarned += coins;
  if (coins > 0) {
    appendHistory(wallet, {
      id: `reward-${rewardId}`,
      type: 'reward',
      amount: coins,
      description: `Recompensa: ${String(description || rewardId).slice(0, 100)}`,
      timestamp
    });
  }
  return {
    ok: true,
    duplicate: false,
    wallet,
    amount: coins,
    unlocks: newUnlocks
  };
}

export function getWalletCustomization(walletInput) {
  const wallet = validateNeonWallet(walletInput);
  const getValue = (itemId) => getStoreItem(itemId)?.effect?.value;
  return {
    vehicleId: getStoreItem(wallet.equipment.vehicleId)?.effect.value ??
      'neon-starter',
    customization: {
      bodyColor: getValue(wallet.equipment.paint) ?? '#7517ff',
      neonColor: getValue(wallet.equipment.neon) ?? '#00eaff',
      wheelStyle: getValue(wallet.equipment.wheels) ?? 'turbine',
      spoiler: getValue(wallet.equipment.spoiler) ?? 'factory',
      livery: getValue(wallet.equipment.livery) ?? 'none'
    }
  };
}

export function isVehicleOwned(walletInput, vehicleId) {
  const wallet = validateNeonWallet(walletInput);
  return wallet.inventory.includes(`vehicle-${vehicleId}`);
}

export function getOwnedStoreItems(walletInput, category) {
  const wallet = validateNeonWallet(walletInput);
  return STORE_ITEMS.filter((item) =>
    (!category || category === 'all' || item.category === category) &&
    wallet.inventory.includes(item.id)
  );
}
