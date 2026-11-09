import { distanceToTrack } from './Track.js';
import { getTrackDefinition } from './TrackCatalog.js';

export class CollisionSystem {
  constructor(trackId = 'neon-city') {
    this.trackId = trackId;
    this.track = getTrackDefinition(trackId);
    this.carRadius = 1.1;
    this.barrierMargin = 0.5;
    this.collisionCooldown = 0;
  }

  update(delta) {
    if (this.collisionCooldown > 0) {
      this.collisionCooldown -= delta;
    }
  }

  checkTrackCollision(car, speed) {
    const x = car.position.x;
    const z = car.position.z;

    const distance = distanceToTrack(x, z, this.trackId);

    const collisionLimit =
      this.track.width / 2 +
      this.barrierMargin;

    if (distance < collisionLimit) {
      return {
        collided: false,
        speed
      };
    }

    if (this.collisionCooldown > 0) {
      return {
        collided: false,
        speed
      };
    }

    this.collisionCooldown = 0.35;

    return {
      collided: true,
      speed: speed * 0.35
    };
  }
}
