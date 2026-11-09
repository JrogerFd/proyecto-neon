import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCar, updateCarVisuals } from '../src/game/Car.js';
import { getDifficultyConfig, DIFFICULTIES } from '../src/game/Difficulty.js';
import { getUpgradePreview, applyUpgrades } from '../src/game/UpgradePreview.js';
import { getQualityProfile } from '../src/game/QualityProfiles.js';
import { getVehicle, VEHICLES } from '../src/game/VehicleCatalog.js';
import {
  getTrackBounds,
  getTrackSurface,
  getTrackLength,
  getTrackPoint,
  getTrackTangent,
  isOnTrack
} from '../src/game/Track.js';
import { TRACKS, getTrackDefinition } from '../src/game/TrackCatalog.js';
import { RampSystem } from '../src/game/RampSystem.js';
import { Rivals } from '../src/game/Rivals.js';
import { ObstacleSystem } from '../src/game/Obstacles.js';
import {
  NEON_COINS_REWARDS,
  STORE_ITEMS
} from '../src/game/Economy.js';
import {
  equipWalletItem,
  getWalletCustomization,
  loadNeonWallet,
  NEON_WALLET_VERSION,
  processRaceReward,
  purchaseWalletItem,
  saveNeonWallet,
  validateNeonWallet
} from '../src/storage/NeonWallet.js';
import {
  DEFAULT_PLAYER_PROFILE,
  loadPlayerProfile,
  PLAYER_PROFILE_KEY,
  PLAYER_PROFILE_VERSION,
  savePlayerProfile,
  validatePlayerProfile
} from '../src/storage/PlayerProfile.js';

test('vehicle catalog has six distinct physical and visual profiles', () => {
  assert.equal(VEHICLES.length, 6);
  assert.equal(new Set(VEHICLES.map(({ id }) => id)).size, 6);
  assert.equal(getVehicle('missing').id, 'neon-starter');
  assert.ok(new Set(VEHICLES.map(({ length, width }) =>
    `${length}/${width}`
  )).size >= 5);

  const bounds = VEHICLES.map(({ id }) => {
    const car = createCar(id);
    const box = new THREE.Box3().setFromObject(car);
    assert.equal(car.userData.wheelAssemblies.length, 4);
    assert.equal(car.userData.frontWheels.length, 2);
    assert.ok(box.getSize(new THREE.Vector3()).x > 1.5);
    assert.ok(box.getSize(new THREE.Vector3()).z > 3.5);
    const result = box.getSize(new THREE.Vector3()).toArray();
    car.traverse((object) => {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];
      materials.forEach((material) => material.dispose());
    });
    return result;
  });
  assert.ok(new Set(bounds.map((size) => size.join(','))).size >= 4);
});

test('vehicle animation responds to driving, steering, braking, and nitro', () => {
  const car = createCar('thunder-x');
  const initialWheelRotation = car.userData.wheelAssemblies[0].spin.rotation.x;
  const brakeMaterial = car.userData.brakeLights[0];
  const nitroMaterial = car.userData.nitroLights[0];
  updateCarVisuals(car, {
    delta: 0.1,
    speed: 0.5,
    steering: 1,
    braking: true,
    nitro: true
  });
  assert.notEqual(
    car.userData.wheelAssemblies[0].spin.rotation.x,
    initialWheelRotation
  );
  assert.ok(car.userData.frontWheels[0].pivot.rotation.y > 0);
  assert.ok(brakeMaterial.emissiveIntensity > 1);
  assert.ok(nitroMaterial.opacity > 0.9);
});

test('three track paths are closed, distinct, bounded, and drivable', () => {
  assert.equal(TRACKS.length, 3);
  const lengths = TRACKS.map(({ id }) => getTrackLength(id));
  assert.equal(new Set(lengths.map((length) => Math.round(length))).size, 3);
  for (const track of TRACKS) {
    const start = getTrackPoint(0, track.id);
    const nearFinish = getTrackPoint(0.99999, track.id);
    const midpoint = getTrackPoint(0.5, track.id);
    const bounds = getTrackBounds(track.id);
    assert.ok(start.distanceTo(nearFinish) < 0.1);
    assert.ok(isOnTrack(midpoint.x, midpoint.z, track.id));
    assert.ok(bounds.maxX > bounds.minX);
    assert.ok(bounds.maxZ > bounds.minZ);
    assert.equal(track.checkpoints.length, 3);
  }
  assert.equal(getTrackDefinition('unknown').id, 'neon-city');
});

test('all circuits have traversable elevation and banked road cross-sections', () => {
  for (const track of TRACKS) {
    const low = getTrackPoint(0.01, track.id);
    const high = getTrackPoint(track.id === 'cyber-desert' ? 0.63 : 0.23, track.id);
    assert.ok(Math.abs(high.y - low.y) > 1);
    const inside = getTrackSurface(0.25, -5, track.id);
    const outside = getTrackSurface(0.25, 5, track.id);
    assert.ok(Math.abs(inside.point.y - outside.point.y) > 0.5);
    assert.ok(Math.abs(inside.bank) > 0.05);
    assert.ok(Math.hypot(
      getTrackTangent(0.25, track.id).x,
      getTrackTangent(0.25, track.id).y,
      getTrackTangent(0.25, track.id).z
    ) > 0.99);
  }
});

test('difficulty levels change real rival control parameters monotonically', () => {
  const difficulties = Object.values(DIFFICULTIES);
  assert.deepEqual(
    difficulties.map(({ targetSpeed }) => targetSpeed),
    [...difficulties.map(({ targetSpeed }) => targetSpeed)].sort()
  );
  assert.ok(getDifficultyConfig('expert').aggression >
    getDifficultyConfig('easy').aggression);
  assert.ok(getDifficultyConfig('hard').acceleration >
    getDifficultyConfig('normal').acceleration);
});

test('rival personalities remain distinct at every difficulty', () => {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    const scene = new THREE.Scene();
    const rivals = new Rivals(scene, { difficulty });
    const aggression = rivals.cars.map(({ personality }) =>
      personality.aggression
    );
    assert.equal(new Set(aggression).size, 3);
    assert.ok(aggression.every((value) => value >= 0 && value <= 1));
    scene.traverse((object) => {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];
      materials.forEach((material) => material.dispose());
    });
  }
});

test('quality profiles configure actual rendering budgets', () => {
  assert.ok(getQualityProfile('low').pixelRatio <
    getQualityProfile('medium').pixelRatio);
  assert.ok(getQualityProfile('medium').pixelRatio <
    getQualityProfile('high').pixelRatio);
  assert.equal(getQualityProfile('low').shadows, false);
  assert.equal(getQualityProfile('high').shadows, true);
  assert.ok(getQualityProfile('low').decorationDensity <
    getQualityProfile('high').decorationDensity);
});

test('profile storage validates values and keeps garage settings persistent', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const profile = validatePlayerProfile({
    vehicleId: 'nova-hyper',
    selectedTrack: 'plasma-circuit',
    quality: 'high',
    customization: {
      bodyColor: '#123456',
      neonColor: '#abcdef',
      wheelStyle: 'disc',
      livery: 'racing-stripe',
      spoiler: 'large'
    }
  });
  assert.equal(savePlayerProfile(profile, storage), true);
  assert.deepEqual(loadPlayerProfile(storage), {
    version: PLAYER_PROFILE_VERSION,
    ...profile
  });

  values.set(PLAYER_PROFILE_KEY, JSON.stringify({
    version: PLAYER_PROFILE_VERSION,
    vehicleId: 'unknown',
    selectedTrack: 'unknown',
    quality: 'ultra',
    customization: { bodyColor: 'url(javascript:bad)' }
  }));
  const recovered = loadPlayerProfile(storage);
  assert.equal(recovered.vehicleId, DEFAULT_PLAYER_PROFILE.vehicleId);
  assert.equal(recovered.selectedTrack, DEFAULT_PLAYER_PROFILE.selectedTrack);
  assert.equal(recovered.quality, DEFAULT_PLAYER_PROFILE.quality);
  assert.match(recovered.customization.bodyColor, /^#[\da-f]{6}$/i);
});

test('ramp state machine launches and returns the vehicle to track height', () => {
  const car = new THREE.Group();
  const ramp = new RampSystem([
    getTrackDefinition('plasma-circuit').zones[0]
  ]);
  assert.equal(ramp.update(car, 0.35, 0.37, 1 / 60, 0.4), 'AIRBORNE');
  assert.ok(car.position.y > 0);
  for (let frame = 0; frame < 100; frame += 1) {
    ramp.update(car, 0.37, 0.37, 1 / 60, 0.4);
  }
  assert.equal(ramp.state, 'GROUNDED');
  assert.equal(car.position.y, 0);

  const elevatedCar = new THREE.Group();
  const elevatedRamp = new RampSystem([
    getTrackDefinition('plasma-circuit').zones[0]
  ]);
  elevatedRamp.update(elevatedCar, 0.35, 0.37, 1 / 60, 0.4, 4);
  assert.ok(elevatedCar.position.y > 4);
  for (let frame = 0; frame < 100; frame += 1) {
    elevatedRamp.update(elevatedCar, 0.37, 0.37, 1 / 60, 0.4, 3.5);
  }
  assert.equal(elevatedRamp.state, 'GROUNDED');
  assert.equal(elevatedCar.position.y, 3.5);
});

test('mobile track obstacles move, switch state, collide, and cool down per vehicle', () => {
  const scene = new THREE.Scene();
  const system = new ObstacleSystem(scene, 'plasma-circuit');
  const obstacle = system.obstacles.find(({ type }) => type === 'platform');
  const start = obstacle.mesh.position.clone();
  for (let frame = 0; frame < 60; frame += 1) system.update(1 / 60);
  assert.ok(obstacle.mesh.position.distanceTo(start) > 0.1);
  assert.ok(system.obstacles.some(({ type }) => type === 'gate'));
  assert.ok(system.obstacles.some(({ type }) => type === 'electric'));

  const moving = system.obstacles.find(({ type }) =>
    type === 'barrier' || type === 'rotator'
  );
  const carA = new THREE.Group();
  carA.position.copy(moving.mesh.position);
  const carB = new THREE.Group();
  carB.position.copy(moving.mesh.position);
  const previous = carA.position.clone().add(new THREE.Vector3(-1, 0, 0));
  const hit = system.checkCollision(carA, previous);
  assert.equal(hit.collided, true);
  const secondVehicleHit = system.checkCollision(carB, previous);
  assert.equal(secondVehicleHit.collided, true);
  const repeatHit = system.checkCollision(carA, previous);
  assert.equal(repeatHit.collided, false);
  system.destroy();
  assert.equal(system.obstacles.length, 0);
});

test('upgrade previews are temporary and do not mutate vehicle definitions', () => {
  const vehicle = { ...VEHICLES[0] };
  const originalAcceleration = vehicle.acceleration;
  const preview = getUpgradePreview(vehicle, 'acceleration', 3);
  assert.ok(preview.acceleration > vehicle.acceleration);
  assert.equal(vehicle.acceleration, originalAcceleration);
  assert.equal(getUpgradePreview(vehicle, 'invalid', 2).acceleration,
    vehicle.acceleration);
});

test('race rewards are position-based, persistent, and idempotent', () => {
  const storageValues = new Map();
  const storage = {
    getItem: (key) => storageValues.get(key) ?? null,
    setItem: (key, value) => storageValues.set(key, value)
  };
  let wallet = validateNeonWallet({});
  assert.equal(wallet.version, NEON_WALLET_VERSION);
  for (const [position, reward] of Object.entries(
    NEON_COINS_REWARDS.positions
  )) {
    const result = processRaceReward(wallet, {
      raceId: `place-${position}`,
      position: Number(position),
      timestamp: 100
    });
    assert.equal(result.reward, reward + NEON_COINS_REWARDS.completionBonus);
    wallet = result.wallet;
  }
  assert.equal(wallet.totalEarned, 1500);
  const repeat = processRaceReward(wallet, {
    raceId: 'place-1',
    position: 1
  });
  assert.equal(repeat.duplicate, true);
  assert.equal(repeat.reward, 0);
  assert.equal(repeat.wallet.balance, wallet.balance);
  assert.equal(saveNeonWallet(wallet, storage), true);
  const restored = loadNeonWallet(storage);
  assert.equal(restored.balance, 1500);
  assert.equal(restored.processedRaces.length, 4);
});

test('store validates purchases and equips usable vehicle cosmetics and upgrades', () => {
  let wallet = processRaceReward(validateNeonWallet({}), {
    raceId: 'store-test',
    position: 1
  }).wallet;
  const vehicle = STORE_ITEMS.find(({ id }) => id === 'vehicle-shadow-gt');
  const boughtVehicle = purchaseWalletItem(wallet, vehicle.id, 123);
  assert.equal(boughtVehicle.ok, false);
  assert.equal(boughtVehicle.error, 'Saldo insuficiente.');

  const lockedUpgrade = purchaseWalletItem(wallet, 'upgrade-engine-2', 124);
  assert.equal(lockedUpgrade.ok, false);
  assert.match(lockedUpgrade.error, /nivel anterior/);

  const paint = purchaseWalletItem(wallet, 'paint-red', 125);
  assert.equal(paint.ok, true);
  wallet = paint.wallet;
  assert.equal(getWalletCustomization(wallet).customization.bodyColor, '#e34235');
  assert.equal(purchaseWalletItem(wallet, 'paint-red').ok, false);
  assert.equal(purchaseWalletItem(wallet, 'vehicle-shadow-gt').ok, false);

  const unequippedPaint = equipWalletItem(wallet, 'paint-purple');
  assert.equal(unequippedPaint.ok, true);
  wallet = unequippedPaint.wallet;
  assert.equal(getWalletCustomization(wallet).customization.bodyColor, '#7517ff');

  wallet = processRaceReward(wallet, {
    raceId: 'store-test-two',
    position: 1
  }).wallet;
  const vehiclePurchase = purchaseWalletItem(wallet, 'vehicle-shadow-gt');
  assert.equal(vehiclePurchase.ok, true);
  wallet = vehiclePurchase.wallet;
  assert.equal(getWalletCustomization(wallet).vehicleId, 'shadow-gt');
  wallet = processRaceReward(wallet, {
    raceId: 'store-test-three',
    position: 1
  }).wallet;

  const before = getVehicle('shadow-gt');
  const levelOne = purchaseWalletItem(wallet, 'upgrade-engine-1');
  assert.equal(levelOne.ok, true);
  wallet = levelOne.wallet;
  const levelTwo = purchaseWalletItem(wallet, 'upgrade-engine-2');
  assert.equal(levelTwo.ok, true);
  wallet = levelTwo.wallet;
  const upgraded = applyUpgrades(before, wallet.upgrades);
  assert.ok(upgraded.maxSpeed > before.maxSpeed);
  assert.ok(upgraded.acceleration > before.acceleration);
  assert.ok(wallet.totalSpent > 0);
  assert.ok(wallet.history.some(({ type }) => type === 'purchase'));
});
