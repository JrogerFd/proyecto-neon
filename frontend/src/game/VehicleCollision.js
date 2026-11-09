export class VehicleCollisionSystem {
  constructor(radius = 1.8) {
    this.radius = radius;
    this.cooldowns = new Map();
  }

  update(vehicles, delta) {
    for (const [key, remaining] of this.cooldowns) {
      const next = remaining - delta;

      if (next <= 0) {
        this.cooldowns.delete(key);
      } else {
        this.cooldowns.set(key, next);
      }
    }

    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < vehicles.length; i++) {
        for (let j = i + 1; j < vehicles.length; j++) {
          this.resolvePair(vehicles, i, j);
        }
      }
    }
  }

  resolvePair(vehicles, firstIndex, secondIndex) {
    const first = vehicles[firstIndex];
    const second = vehicles[secondIndex];
    const dx = second.mesh.position.x - first.mesh.position.x;
    const dz = second.mesh.position.z - first.mesh.position.z;
    const minimumDistance = this.radius * 2;
    const distanceSquared = dx * dx + dz * dz;

    if (distanceSquared >= minimumDistance * minimumDistance) {
      return;
    }

    const distance = Math.sqrt(distanceSquared);
    let nx;
    let nz;

    if (distance > 0.0001) {
      nx = dx / distance;
      nz = dz / distance;
    } else {
      const angle = (firstIndex + secondIndex + 1) * 2.399963;
      nx = Math.cos(angle);
      nz = Math.sin(angle);
    }

    const penetration = minimumDistance - distance + 0.01;

    first.mesh.position.x -= nx * penetration * 0.5;
    first.mesh.position.z -= nz * penetration * 0.5;
    second.mesh.position.x += nx * penetration * 0.5;
    second.mesh.position.z += nz * penetration * 0.5;

    const firstVelocity = first.getVelocity();
    const secondVelocity = second.getVelocity();
    const relativeX = secondVelocity.x - firstVelocity.x;
    const relativeZ = secondVelocity.z - firstVelocity.z;
    const closingSpeed = Math.max(
      0,
      -(relativeX * nx + relativeZ * nz)
    );
    const key = `${firstIndex}:${secondIndex}`;

    if (this.cooldowns.has(key)) return;

    this.cooldowns.set(key, 0.5);

    const impact = Math.min(1, Math.max(0.2, closingSpeed / 14));
    const speedFactor = 0.92 - impact * 0.12;

    first.onImpact(speedFactor, closingSpeed, second);
    second.onImpact(speedFactor, closingSpeed, first);
  }

  reset() {
    this.cooldowns.clear();
  }
}
