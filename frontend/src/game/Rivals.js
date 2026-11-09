import * as THREE from 'three';
import { createCar } from './Car.js';
import {
  distanceToTrack,
  getTrackPoint,
  getTrackSurface,
  getTrackLength,
  isOnTrack
} from './Track.js';
import { getTrackDefinition } from './TrackCatalog.js';
import { getDifficultyConfig } from './Difficulty.js';

export class Rivals {
  constructor(scene, {
    trackId = 'neon-city',
    difficulty = 'normal',
    count = 3
  } = {}) {
    this.scene = scene;
    this.cars = [];
    this.trackId = trackId;
    this.trackLength = getTrackLength(trackId);
    this.track = getTrackDefinition(trackId);
    this.difficulty = getDifficultyConfig(difficulty);
    this.count = Math.max(0, Math.min(3, Number(count) || 0));

    this.createRivals();
  }

  createRivals() {
    const rivalsData = [
      {
        name: 'NOVA',
        color: 0x00eaff,
        speed: 0.033,
        progress: 0.985,
        laneOffset: -2.5,
        personality: {
          aggression: 0.3,
          safeGap: 7,
          laneChangeRate: 2.2
        }
      },
      {
        name: 'BLAZE',
        color: 0xff0088,
        speed: 0.030,
        progress: 0.970,
        laneOffset: 2.5,
        personality: {
          aggression: 0.9,
          safeGap: 4.4,
          laneChangeRate: 3.5
        }
      },
      {
        name: 'VOLT',
        color: 0xa855ff,
        speed: 0.027,
        progress: 0.955,
        laneOffset: -2.5,
        personality: {
          aggression: 0.58,
          safeGap: 5.6,
          laneChangeRate: 2.8
        }
      }
    ];

    const vehicleIds = ['shadow-gt', 'thunder-x', 'phantom-rs'];
    for (const [index, data] of rivalsData.slice(0, this.count).entries()) {
      const car = createCar(vehicleIds[index], {
        neonColor: `#${data.color.toString(16).padStart(6, '0')}`
      });

      this.scene.add(car);

      const rival = {
        name: data.name,
        color: data.color,
        mesh: car,
        speed: data.speed * this.difficulty.targetSpeed,
        baseSpeed: data.speed * this.difficulty.targetSpeed,
        speedScale: 1,
        progress: data.progress,
        startProgress: data.progress,
        laneOffset: data.laneOffset,
        startLaneOffset: data.laneOffset,
        targetLaneOffset: data.laneOffset,
        personality: {
          ...data.personality,
          aggression: Math.min(
            1,
            data.personality.aggression *
              this.difficulty.aggression / 0.58
          ),
          laneChangeRate: data.personality.laneChangeRate *
            this.difficulty.linePrecision,
          acceleration: this.difficulty.acceleration,
          recovery: this.difficulty.recovery,
          cornerLookAhead: this.difficulty.cornerLookAhead
        },
        passing: null,
        passingLane: null,
        passingTime: 0,
        raceTime: 0,
        finishTime: null,
        finished: false,
        lap: 1,
        completedLaps: 0
      };

      this.cars.push(rival);

      this.positionRival(rival);
    }
  }

  getLanePoint(progress, laneOffset) {
    const normalizedProgress =
      ((progress % 1) + 1) % 1;
    return getTrackSurface(
      normalizedProgress,
      laneOffset,
      this.trackId
    ).point;
  }

  getTangent(progress) {
    const before = getTrackPoint(progress - 0.0001, this.trackId);
    const after = getTrackPoint(progress + 0.0001, this.trackId);

    return after.sub(before).normalize();
  }

  positionRival(rival) {
    const position = this.getLanePoint(
      rival.progress,
      rival.laneOffset
    );
    const nextPosition = this.getLanePoint(
      rival.progress + 0.001,
      rival.laneOffset
    );
    const direction = nextPosition.sub(position).normalize();

    rival.mesh.position.copy(position);
    const surface = getTrackSurface(
      rival.progress,
      rival.laneOffset,
      this.trackId
    );
    rival.mesh.rotation.order = 'YXZ';
    rival.mesh.rotation.y = Math.atan2(
      -direction.x,
      -direction.z
    );
    rival.mesh.rotation.x = Math.atan2(
      direction.y,
      Math.hypot(direction.x, direction.z)
    );
    rival.mesh.rotation.z = surface.bank;
  }

  getVelocity(rival) {
    const tangent = this.getTangent(rival.progress);
    const speed = rival.baseSpeed *
      rival.speedScale *
      this.trackLength;

    return {
      x: tangent.x * speed,
      z: tangent.z * speed
    };
  }

  getRelativePosition(origin, target, tangent) {
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;

    return {
      forward: dx * tangent.x + dz * tangent.z,
      lateral: dx * tangent.z - dz * tangent.x
    };
  }

  getCandidateLanes(rival, player, obstacles, tangent) {
    const candidates = [-4.8, -3.6, 3.6, 4.8];
    const clearLanes = [];
    for (const lane of candidates) {
      const point = this.getLanePoint(
        rival.progress + rival.personality.cornerLookAhead,
        lane
      );

      if (
        !isOnTrack(point.x, point.z, this.trackId) ||
        distanceToTrack(point.x, point.z, this.trackId) >
          this.track.width / 2 - 1.5
      ) {
        continue;
      }

      const clearOfCars = [
        player,
        ...this.cars
          .filter((other) => other !== rival)
          .map((other) => other.mesh)
      ]
        .filter(Boolean)
        .every((vehicle) => {
          const relative = this.getRelativePosition(
            rival.mesh.position,
            vehicle.position,
            tangent
          );

          if (relative.forward < -3 || relative.forward > 15) {
            return true;
          }

          return Math.hypot(
            relative.forward,
            relative.lateral - lane + rival.laneOffset
          ) >= rival.personality.safeGap;
        });

      const clearOfObstacles = obstacles.every((obstacle) => {
        if (obstacle.active === false) return true;
        const relative = this.getRelativePosition(
          rival.mesh.position,
          obstacle.mesh.position,
          tangent
        );

        if (relative.forward < -2 || relative.forward > 13) {
          return true;
        }

        const targetLateral =
          relative.lateral - lane + rival.laneOffset;

        return Math.abs(targetLateral) > 3.2;
      });

      if (clearOfCars && clearOfObstacles) {
        clearLanes.push(lane);
      }
    }

    return clearLanes;
  }

  findBlocker(rival, player, playerSpeed, obstacles, tangent) {
    let nearest = null;
    let nearestDistance = 13;

    const vehicles = [
      ...this.cars
        .filter((other) => other !== rival)
        .map((other) => ({
          object: other,
          mesh: other.mesh,
          speed: other.baseSpeed * other.speedScale * this.trackLength
        })),
      {
        object: player,
        mesh: player,
        speed: Math.max(0, playerSpeed) * 60
      }
    ];

    for (const vehicle of vehicles) {
      const relative = this.getRelativePosition(
        rival.mesh.position,
        vehicle.mesh.position,
        tangent
      );
      const gap = relative.forward - 3.8;

      if (
        gap > 0 &&
        gap < nearestDistance &&
        Math.abs(relative.lateral) < 4.8 &&
        vehicle.speed < rival.baseSpeed * this.trackLength * 1.08
      ) {
        nearestDistance = gap;
        nearest = vehicle.object;
      }
    }

    for (const obstacle of obstacles) {
      if (obstacle.active === false) continue;
      const relative = this.getRelativePosition(
        rival.mesh.position,
        obstacle.mesh.position,
        tangent
      );
      const gap = relative.forward - 3;

      if (
        gap > 0 &&
        gap < nearestDistance &&
        Math.abs(relative.lateral - rival.laneOffset) < 4.2
      ) {
        nearestDistance = gap;
        nearest = obstacle;
      }
    }

    return nearest ? { object: nearest, gap: nearestDistance } : null;
  }

  updateRival(
    rival,
    delta,
    player,
    playerSpeed,
    obstacles,
    totalLaps
  ) {
    if (rival.finished) return;

    const tangent = this.getTangent(rival.progress);
    const blocker = this.findBlocker(
      rival,
      player,
      playerSpeed,
      obstacles,
      tangent
    );

    if (rival.passing) {
      const passingPosition =
        rival.passing.mesh?.position ?? rival.passing.position;

      if (passingPosition) {
        const relative = this.getRelativePosition(
          rival.mesh.position,
          passingPosition,
          tangent
        );

        if (relative.forward < -5) {
          rival.passing = null;
          rival.passingLane = null;
          rival.passingTime = 0;
        } else {
          rival.passingTime += delta;
        }
      } else {
        rival.passing = null;
        rival.passingLane = null;
      }

      if (rival.passingTime > 3) {
        rival.passing = null;
        rival.passingLane = null;
      }
    }

    rival.targetLaneOffset = rival.passing
      ? rival.passingLane
      : rival.startLaneOffset;

    if (blocker && !rival.passing) {
      const lanes = this.getCandidateLanes(
        rival,
        player,
        obstacles,
        tangent
      );

      if (lanes.length > 0) {
        lanes.sort((a, b) => {
          const aCost =
            Math.abs(a - rival.laneOffset) -
            rival.personality.aggression * Math.abs(a);
          const bCost =
            Math.abs(b - rival.laneOffset) -
            rival.personality.aggression * Math.abs(b);

          return aCost - bCost;
        });

        rival.targetLaneOffset = lanes[0];
        rival.passing = blocker.object;
        rival.passingLane = lanes[0];
        rival.passingTime = 0;
      }
    }

    const cannotPass =
      blocker &&
      !rival.passing &&
      blocker.gap < 8;
    const surfaceZone = this.track.zones.find((zone) =>
      rival.progress >= zone.start && rival.progress <= zone.end
    );
    const zoneFactor = surfaceZone?.type === 'sand'
      ? surfaceZone.factor
      : 1;
    const desiredSpeedScale = (cannotPass
      ? 0.62 + Math.max(0, blocker.gap) * 0.035
      : 1) * zoneFactor;

    rival.speedScale +=
      (desiredSpeedScale - rival.speedScale) *
      Math.min(1, delta * rival.personality.acceleration);

    rival.speed = rival.baseSpeed * rival.speedScale;
    rival.raceTime += delta;
    rival.progress += rival.speed * delta;

    if (rival.progress >= 1) {
      rival.progress -= 1;
      rival.completedLaps += 1;
      rival.lap = rival.completedLaps + 1;
    }

    const raceProgress =
      rival.completedLaps +
      rival.progress -
      rival.startProgress;

    if (raceProgress >= totalLaps) {
      const progressRate = rival.speed;
      const excess = raceProgress - totalLaps;

      rival.finished = true;
      rival.finishTime = Math.max(
        0,
        rival.raceTime -
          (progressRate > 0 ? excess / progressRate : 0)
      );
      rival.speedScale = 0;
      rival.speed = 0;
    }

    const laneAlpha = 1 - Math.exp(
      -rival.personality.laneChangeRate * delta
    );

    rival.laneOffset +=
      (rival.targetLaneOffset - rival.laneOffset) * laneAlpha;

    const target = this.getLanePoint(
      rival.progress,
      rival.laneOffset
    );

    const positionAlpha = 1 - Math.exp(-7 * delta);
    rival.mesh.position.x +=
      (target.x - rival.mesh.position.x) * positionAlpha;
    rival.mesh.position.z +=
      (target.z - rival.mesh.position.z) * positionAlpha;

    const nextPosition = this.getLanePoint(
      rival.progress + 0.001,
      rival.laneOffset
    );
    const direction = nextPosition.sub(target).normalize();

    rival.mesh.rotation.order = 'YXZ';
    rival.mesh.rotation.y = Math.atan2(
      -direction.x,
      -direction.z
    );
    rival.mesh.rotation.x = Math.atan2(
      direction.y,
      Math.hypot(direction.x, direction.z)
    );
    rival.mesh.rotation.z = getTrackSurface(
      rival.progress,
      rival.laneOffset,
      this.trackId
    ).bank;
  }

  update(delta, player, obstacles = [], playerSpeed = 0, totalLaps = 3) {
    const safeDelta = Math.min(delta, 0.05);

    for (const rival of this.cars) {
      if (rival.finished) continue;

      rival.speedScale = Math.min(
        1,
        rival.speedScale + safeDelta * 0.16
      );
      this.updateRival(
        rival,
        safeDelta,
        player,
        playerSpeed,
        obstacles,
        totalLaps
      );
    }
  }

  reset() {
    for (const rival of this.cars) {
      rival.progress = rival.startProgress;
      rival.laneOffset = rival.startLaneOffset;
      rival.targetLaneOffset = rival.startLaneOffset;
      rival.speedScale = 1;
      rival.speed = rival.baseSpeed;
      rival.passing = null;
      rival.passingLane = null;
      rival.passingTime = 0;
      rival.raceTime = 0;
      rival.finishTime = null;
      rival.finished = false;
      rival.completedLaps = 0;
      rival.lap = 1;

      this.positionRival(rival);
    }
  }

  destroy() {
    for (const rival of this.cars) {
      this.scene.remove(rival.mesh);

      rival.mesh.traverse((object) => {
        if (object.geometry) {
          object.geometry.dispose();
        }

        if (object.material) {
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];

          for (const material of materials) {
            material.dispose();
          }
        }
      });
    }

    this.cars = [];
  }
}
