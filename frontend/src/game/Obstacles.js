import * as THREE from 'three';
import { getTrackSurface } from './Track.js';
import { getTrackDefinition } from './TrackCatalog.js';

const OBSTACLE_LAYOUTS = Object.freeze({
  'neon-city': [
    'sweeper', 'electric', 'sweeper', 'barrier', 'electric', 'barrier'
  ],
  'cyber-desert': [
    'rock', 'platform', 'rock', 'barrier', 'platform', 'rock'
  ],
  'plasma-circuit': [
    'rotator', 'gate', 'electric', 'platform', 'rotator', 'electric'
  ]
});

const OBSTACLE_PROGRESS = Object.freeze({
  'neon-city': [0.10, 0.25, 0.40, 0.58, 0.75, 0.90],
  'cyber-desert': [0.12, 0.29, 0.44, 0.61, 0.78, 0.92],
  'plasma-circuit': [0.09, 0.23, 0.39, 0.56, 0.72, 0.88]
});

export class ObstacleSystem {
  constructor(scene, trackId = 'neon-city') {
    this.scene = scene;
    this.trackId = trackId;
    this.elapsed = 0;
    this.obstacles = [];
    this.track = getTrackDefinition(trackId);
    this.createTrackObstacles();
  }

  createTrackObstacles() {
    const progressList = OBSTACLE_PROGRESS[this.trackId] ??
      OBSTACLE_PROGRESS['neon-city'];
    const types = OBSTACLE_LAYOUTS[this.trackId] ??
      OBSTACLE_LAYOUTS['neon-city'];

    progressList.forEach((progress, index) => {
      const laneOffset = this.trackId === 'cyber-desert'
        ? (index % 2 === 0 ? -1.6 : 1.6)
        : (index % 2 === 0 ? -2.5 : 2.5);
      const surface = getTrackSurface(progress, laneOffset, this.trackId);
      this.createObstacle(surface.point, index, {
        type: types[index],
        progress,
        laneOffset,
        phase: index * 1.17
      });
    });
  }

  createObstacle(position, index, {
    type = 'barrier',
    progress = 0,
    laneOffset = 0,
    phase = 0
  } = {}) {
    const group = new THREE.Group();
    const neonColors = [0xff00aa, 0x00eaff, 0xa855ff];
    const color = neonColors[index % neonColors.length];
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: this.trackId === 'cyber-desert'
        ? 0x76513a
        : this.trackId === 'plasma-circuit'
          ? 0x24103d
          : 0x171329,
      metalness: 0.65,
      roughness: 0.25
    });
    const glowMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 2.5,
      metalness: 0.2,
      roughness: 0.2
    });
    const isRock = type === 'rock';
    const body = new THREE.Mesh(
      isRock
        ? new THREE.DodecahedronGeometry(1.35, 0)
        : new THREE.BoxGeometry(
          type === 'gate' ? 5.2 : 3,
          type === 'platform' ? 0.65 : 2,
          type === 'gate' ? 0.8 : 3
        ),
      bodyMaterial
    );
    body.position.y = type === 'platform' ? 0.35 : 1;
    group.add(body);

    if (isRock) {
      body.scale.setScalar(0.7);
      body.position.y = 1.15;
    }

    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(
        type === 'gate' ? 5.4 : isRock ? 2.1 : 3.2,
        0.16,
        type === 'gate' ? 0.18 : isRock ? 2.1 : 3.2
      ),
      glowMaterial
    );
    glow.position.y = type === 'platform' ? 0.8 : isRock ? 1.35 : 2.05;
    group.add(glow);

    group.position.copy(position);
    this.scene.add(group);
    this.obstacles.push({
      id: `${this.trackId}-obstacle-${index}`,
      mesh: group,
      type,
      progress,
      laneOffset,
      phase,
      cooldowns: new Map(),
      radius: type === 'gate' ? 2.1 : isRock ? 1.15 : 1.8,
      active: true,
      collidable: true,
      baseY: position.y
    });
  }

  update(delta) {
    this.elapsed += Math.min(delta, 0.05);
    for (const obstacle of this.obstacles) {
      for (const [vehicleId, cooldown] of obstacle.cooldowns) {
        const remaining = cooldown - delta;
        if (remaining <= 0) obstacle.cooldowns.delete(vehicleId);
        else obstacle.cooldowns.set(vehicleId, remaining);
      }
      const phase = this.elapsed * 1.35 + obstacle.phase;
      const movingLane = obstacle.laneOffset +
        (obstacle.type === 'sweeper' || obstacle.type === 'rock'
          ? Math.sin(phase) * 2.6
          : 0);
      const surface = getTrackSurface(
        obstacle.progress,
        movingLane,
        this.trackId
      );
      if (obstacle.type === 'gate' || obstacle.type === 'electric') {
        obstacle.active =
          Math.sin(phase * (obstacle.type === 'gate' ? 0.65 : 1.8)) > -0.15;
      } else {
        obstacle.active = true;
      }
      const verticalMotion = obstacle.type === 'platform'
        ? 1.3 + Math.sin(phase * 0.8) * 0.85
        : 0;
      const gateMotion = obstacle.type === 'gate' && !obstacle.active
        ? 2.8
        : 0;
      obstacle.mesh.position.set(
        surface.point.x,
        surface.point.y + verticalMotion + gateMotion,
        surface.point.z
      );
      obstacle.mesh.rotation.y =
        Math.atan2(surface.tangent.x, surface.tangent.z);
      obstacle.mesh.rotation.z = surface.bank;
      if (obstacle.type === 'rotator') {
        obstacle.mesh.rotation.y += phase;
      }

      obstacle.collidable = obstacle.active &&
        (obstacle.type !== 'platform' ||
          obstacle.mesh.position.y - surface.point.y < 1.25);
      const material = obstacle.mesh.children[1]?.material;
      if (material) {
        material.emissiveIntensity = obstacle.active ? 2.5 : 0.12;
        material.opacity = obstacle.active ? 1 : 0.34;
        material.transparent = !obstacle.active;
      }
    }
  }

  checkCollision(car, previousPosition) {
    for (const obstacle of this.obstacles) {
      if (!obstacle.collidable ||
          Math.abs(car.position.y - obstacle.mesh.position.y) > 3.4) {
        continue;
      }
      const dx = car.position.x - obstacle.mesh.position.x;
      const dz = car.position.z - obstacle.mesh.position.z;
      const distance = Math.hypot(dx, dz);
      const minimumDistance = obstacle.radius + 1.2;
      if (distance >= minimumDistance) continue;

      const normal = distance > 0.0001
        ? new THREE.Vector3(dx / distance, 0, dz / distance)
        : new THREE.Vector3(
          previousPosition.x - obstacle.mesh.position.x,
          0,
          previousPosition.z - obstacle.mesh.position.z
        ).normalize();
      if (normal.lengthSq() < 0.0001) normal.set(1, 0, 0);
      const penetration = minimumDistance - distance + 0.06;
      car.position.x += normal.x * penetration;
      car.position.z += normal.z * penetration;
      const vehicleId = car.uuid;
      if (obstacle.cooldowns.has(vehicleId)) {
        return { collided: false, touching: true, obstacle };
      }
      obstacle.cooldowns.set(vehicleId, 0.65);
      return {
        collided: true,
        touching: true,
        normal,
        obstacle,
        penalty: obstacle.type === 'electric' ? 0.78 : 0.86
      };
    }
    return { collided: false, touching: false };
  }

  reset() {
    this.elapsed = 0;
    for (const obstacle of this.obstacles) obstacle.cooldowns.clear();
    this.update(0);
  }

  destroy() {
    for (const obstacle of this.obstacles) {
      obstacle.mesh.traverse((object) => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : object.material
            ? [object.material]
            : [];
        materials.forEach((material) => material.dispose());
      });
      obstacle.mesh.removeFromParent();
    }
    this.obstacles.length = 0;
  }
}
