import * as THREE from 'three';
import { getTrackPoint, isOnTrack } from './Track.js';

export class WrongWayDetector {
  constructor(trackId = 'neon-city') {
    this.trackId = trackId;
    this.previousPosition = null;
    this.wrongWayTime = 0;
    this.recoveryTime = 0;
    this.isWrongWay = false;
  }

  reset(car) {
    this.previousPosition = car.position.clone();
    this.wrongWayTime = 0;
    this.recoveryTime = 0;
    this.isWrongWay = false;
  }

  getTrackDirection(position) {
    let closestProgress = 0;
    let closestDistance = Infinity;

    // Buscar el punto más cercano del circuito.
    for (let i = 0; i < 200; i++) {
      const progress = i / 200;
      const point = getTrackPoint(progress, this.trackId);

      const dx = position.x - point.x;
      const dz = position.z - point.z;

      const distance = dx * dx + dz * dz;

      if (distance < closestDistance) {
        closestDistance = distance;
        closestProgress = progress;
      }
    }

    // Calcular la dirección correcta del recorrido.
    const before = getTrackPoint(
      (closestProgress - 0.001 + 1) % 1,
      this.trackId
    );

    const after = getTrackPoint(
      (closestProgress + 0.001) % 1,
      this.trackId
    );

    return after.sub(before).normalize();
  }

  update(car, delta) {
    if (!this.previousPosition) {
      this.reset(car);
      return false;
    }

    const movement = new THREE.Vector3().subVectors(
      car.position,
      this.previousPosition
    );

    this.previousPosition.copy(car.position);

    // Ignorar movimientos pequeños o fuera del circuito.
    if (
      movement.lengthSq() < 0.0004 ||
      !isOnTrack(car.position.x, car.position.z, this.trackId)
    ) {
      return this.isWrongWay;
    }

    const trackDirection = this.getTrackDirection(
      car.position
    );

    movement.normalize();

    const alignment = movement.dot(trackDirection);

    if (alignment < -0.35) {
      this.wrongWayTime += delta;
      this.recoveryTime = 0;

      if (this.wrongWayTime >= 0.8) {
        this.isWrongWay = true;
      }
    } else if (alignment > 0.35) {
      this.recoveryTime += delta;
      this.wrongWayTime = 0;

      if (this.recoveryTime >= 0.4) {
        this.isWrongWay = false;
      }
    }

    return this.isWrongWay;
  }
}
