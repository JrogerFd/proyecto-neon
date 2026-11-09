import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { LapManager } from '../src/game/LapManager.js';
import { MiniMap } from '../src/game/MiniMap.js';
import {
  getForwardProgressDelta,
  getTrackProgress,
  RaceStandings
} from '../src/game/RaceStandings.js';
import { Rivals } from '../src/game/Rivals.js';
import { getTrackPoint } from '../src/game/Track.js';
import { VehicleCollisionSystem } from '../src/game/VehicleCollision.js';

function createVehicle(x, z, impacts) {
  return {
    mesh: {
      position: { x, z }
    },
    getVelocity: () => ({ x: 0, z: 0 }),
    onImpact: () => impacts.push(true)
  };
}

test('separates overlapping stopped vehicles', () => {
  const system = new VehicleCollisionSystem();
  const impacts = [];
  const vehicles = [
    createVehicle(0, 0, impacts),
    createVehicle(0.5, 0, impacts)
  ];

  system.update(vehicles, 1 / 60);

  const distance = Math.hypot(
    vehicles[1].mesh.position.x - vehicles[0].mesh.position.x,
    vehicles[1].mesh.position.z - vehicles[0].mesh.position.z
  );

  assert.ok(distance >= system.radius * 2);
  assert.equal(impacts.length, 2);
});

test('limits repeated impact penalties while contact persists', () => {
  const system = new VehicleCollisionSystem();
  const impacts = [];
  const vehicles = [
    createVehicle(0, 0, impacts),
    createVehicle(0.5, 0, impacts)
  ];

  system.update(vehicles, 0.1);
  assert.equal(impacts.length, 2);

  vehicles[1].mesh.position.x = vehicles[0].mesh.position.x + 3;
  system.update(vehicles, 0.1);
  assert.equal(impacts.length, 2);

  vehicles[1].mesh.position.x = vehicles[0].mesh.position.x + 3;
  system.update(vehicles, 0.5);
  assert.equal(impacts.length, 4);
});

test('rivals keep moving, avoid an obstacle lane, and reset cleanly', () => {
  const scene = new THREE.Scene();
  const rivals = new Rivals(scene);
  const player = new THREE.Group();
  player.position.set(-100, 0, -100);

  const nova = rivals.cars[0];
  const tangent = rivals.getTangent(nova.progress);
  const obstacle = {
    mesh: new THREE.Group()
  };
  obstacle.mesh.position.set(
    nova.mesh.position.x + tangent.x * 8,
    0,
    nova.mesh.position.z + tangent.z * 8
  );

  const initialProgress = nova.progress;
  const initialLane = nova.laneOffset;

  rivals.update(1 / 60, player, [obstacle], 0);

  assert.ok(nova.progress > initialProgress);
  assert.notEqual(nova.targetLaneOffset, initialLane);
  assert.ok(nova.laneOffset !== initialLane);

  nova.speedScale = 0.5;
  nova.passing = obstacle;
  nova.passingLane = 4.8;
  rivals.reset();

  assert.equal(nova.progress, nova.startProgress);
  assert.equal(nova.laneOffset, nova.startLaneOffset);
  assert.equal(nova.speedScale, 1);
  assert.equal(nova.passing, null);

  rivals.destroy();
  assert.equal(scene.children.length, 0);
});

function createRival(name, startProgress, progress, completedLaps = 0) {
  return {
    name,
    color: 0x00eaff,
    startProgress,
    progress,
    completedLaps,
    finished: false,
    finishTime: null
  };
}

test('orders the player and three rivals by actual circuit progress', () => {
  const standings = new RaceStandings(3);
  const laps = new LapManager(3);
  const player = new THREE.Group();
  player.position.copy(getTrackPoint(0.45));

  const result = standings.getStandings(player, laps, [
    createRival('NOVA', 0.2, 0.6),
    createRival('BLAZE', 0.1, 0.7),
    createRival('VOLT', 0.1, 0.25)
  ]);

  assert.deepEqual(
    result.map(({ name }) => name),
    ['BLAZE', 'TÚ', 'NOVA', 'VOLT']
  );
  assert.equal(result.find(({ id }) => id === 'player').position, 2);
});

test('reorders competitors when the player overtakes a rival', () => {
  const standings = new RaceStandings(3);
  const laps = new LapManager(3);
  const player = new THREE.Group();
  const rivals = [
    createRival('NOVA', 0, 0.2),
    createRival('BLAZE', 0, 0.1),
    createRival('VOLT', 0, 0.05)
  ];

  player.position.copy(getTrackPoint(0.1));
  assert.equal(
    standings.getStandings(player, laps, rivals)[0].name,
    'NOVA'
  );

  player.position.copy(getTrackPoint(0.3));
  assert.equal(
    standings.getStandings(player, laps, rivals)[0].name,
    'TÚ'
  );
});

test('compares completed laps plus partial circuit progress', () => {
  const standings = new RaceStandings(3);
  const laps = new LapManager(3);
  const player = new THREE.Group();
  player.position.copy(getTrackPoint(0.2));

  const result = standings.getStandings(player, laps, [
    createRival('NOVA', 0.8, 0.05, 2),
    createRival('BLAZE', 0.9, 0.99),
    createRival('VOLT', 0.1, 0.15)
  ]);

  assert.equal(result[0].name, 'NOVA');
  assert.ok(result[0].totalProgress > 1);
  assert.ok(result.find(({ id }) => id === 'player').totalProgress < 1);
});

test('recognizes forward start-line crossing and rejects reverse crossing', () => {
  assert.ok(getForwardProgressDelta(0.999, 0.001) > 0);
  assert.ok(getForwardProgressDelta(0.001, 0.999) < 0);

  const laps = new LapManager(3);

  assert.equal(laps.crossFinishLine(-1).valid, false);
  assert.equal(laps.completedLaps, 0);
});

test('supports a one-lap race and marks it finished after one valid circuit', () => {
  const laps = new LapManager(1);

  assert.equal(laps.visitCheckpoint('north', 1), true);
  assert.equal(laps.visitCheckpoint('west', 1), true);
  assert.equal(laps.visitCheckpoint('south', 1), true);
  assert.deepEqual(laps.crossFinishLine(1), {
    valid: true,
    finished: true,
    completedLaps: 1
  });
  assert.equal(laps.finished, true);
});

test('reset clears the classification finish state', () => {
  const standings = new RaceStandings(3);
  const laps = new LapManager(3);
  const player = new THREE.Group();
  player.position.copy(getTrackPoint(0));
  laps.finished = true;
  laps.completedLaps = 3;
  standings.setPlayerFinishTime(42);

  assert.equal(
    standings.getStandings(player, laps, [])[0].finishTime,
    42
  );

  standings.reset();
  laps.reset();

  const resetResult = standings.getStandings(player, laps, []);
  assert.equal(resetResult[0].finished, false);
  assert.equal(resetResult[0].finishTime, null);
  assert.equal(resetResult[0].totalProgress, 0);
});

test('minimap redraws the player and every rival at their live positions', () => {
  const miniMap = Object.create(MiniMap.prototype);
  const markers = [];
  miniMap.context = {
    clearRect() {}
  };
  miniMap.size = 220;
  miniMap.padding = 22;
  miniMap.worldMinX = -49;
  miniMap.worldMaxX = 49;
  miniMap.worldMinZ = -94;
  miniMap.worldMaxZ = 94;
  miniMap.drawTrack = () => {};
  miniMap.drawCar = (car, color, isPlayer) => {
    markers.push({
      position: miniMap.worldToMap(
        car.position.x,
        car.position.z
      ),
      color,
      isPlayer
    });
  };

  const player = new THREE.Group();
  const rivals = ['NOVA', 'BLAZE', 'VOLT'].map((name, index) => ({
    name,
    color: [0x00eaff, 0xff0088, 0xa855ff][index],
    mesh: new THREE.Group()
  }));
  player.position.set(0, 0, 0);
  rivals.forEach(({ mesh }, index) => {
    mesh.position.set(index + 1, 0, index + 2);
  });

  miniMap.update(player, rivals);

  assert.equal(markers.length, 4);
  assert.equal(markers[0].isPlayer, true);
  assert.deepEqual(
    markers.slice(1).map(({ color }) => color),
    ['#00eaff', '#ff0088', '#a855ff']
  );

  const previousX = markers[1].position.x;
  rivals[0].mesh.position.x += 8;
  markers.length = 0;
  miniMap.update(player, rivals);
  assert.notEqual(markers[1].position.x, previousX);
});

test('track projection and wrapped progress remain stable near start and finish', () => {
  const nearFinish = getTrackProgress(getTrackPoint(0.99999));
  const nearStart = getTrackProgress(getTrackPoint(0.00001));

  assert.ok(nearFinish > 0.99);
  assert.ok(nearStart < 0.01);
  assert.ok(getForwardProgressDelta(nearFinish, nearStart) > 0);
});

test('reverse checkpoint visits and skipped controls cannot complete a lap', () => {
  const laps = new LapManager(3);

  assert.equal(laps.visitCheckpoint('north', -1), false);
  assert.equal(laps.visitCheckpoint('west', 1), false);
  assert.equal(laps.crossFinishLine(1).valid, false);
  assert.equal(laps.completedLaps, 0);

  assert.equal(laps.visitCheckpoint('north', 1), true);
  assert.equal(laps.visitCheckpoint('west', -1), false);
  assert.equal(laps.visitCheckpoint('west', 1), true);
  assert.equal(laps.visitCheckpoint('south', 1), true);
  assert.equal(laps.crossFinishLine(-1).valid, false);
  assert.equal(laps.crossFinishLine(1).valid, true);
  assert.equal(laps.completedLaps, 1);
});
