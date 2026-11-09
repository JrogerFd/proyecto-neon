function crossedForward(previous, current, target) {
  if (current >= previous) return target > previous && target <= current;
  return target > previous || target <= current;
}

export class RampSystem {
  constructor(zones = []) {
    this.ramps = zones.filter((zone) => zone.type === 'ramp');
    this.state = 'GROUNDED';
    this.verticalVelocity = 0;
    this.airTime = 0;
    this.airOffset = 0;
  }

  update(
    car,
    previousProgress,
    currentProgress,
    delta,
    speed,
    surfaceHeight = 0
  ) {
    if (this.state === 'GROUNDED' &&
        speed > 0.18 &&
        this.ramps.some((ramp) =>
          crossedForward(previousProgress, currentProgress, ramp.start)
        )) {
      this.state = 'LAUNCHING';
      this.verticalVelocity = 7.2;
      this.airTime = 0;
      this.airOffset = 0;
    }

    if (this.state === 'GROUNDED') {
      car.position.y = surfaceHeight;
      return this.state;
    }
    const safeDelta = Math.min(delta, 0.05);
    this.airTime += safeDelta;
    if (this.state === 'LAUNCHING') this.state = 'AIRBORNE';
    this.verticalVelocity -= 17 * safeDelta;
    this.airOffset += this.verticalVelocity * safeDelta;
    car.position.y = surfaceHeight + this.airOffset;

    if (this.verticalVelocity <= 0) this.state = 'LANDING';
    if (this.airOffset <= 0) {
      car.position.y = surfaceHeight;
      this.verticalVelocity = 0;
      this.state = 'GROUNDED';
      this.airTime = 0;
      this.airOffset = 0;
    }
    return this.state;
  }

  reset(car) {
    this.state = 'GROUNDED';
    this.verticalVelocity = 0;
    this.airTime = 0;
    this.airOffset = 0;
    if (car) car.position.y = 0;
  }
}
