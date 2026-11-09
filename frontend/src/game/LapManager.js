export class LapManager {
  constructor(totalLaps = 3) {
    this.totalLaps = totalLaps;

    this.requiredCheckpoints = [
      'north',
      'west',
      'south'
    ];

    this.reset();
  }

  visitCheckpoint(name, direction = 1) {
    if (this.finished) return false;
    if (direction <= 0) return false;

    const expected =
      this.requiredCheckpoints[this.nextCheckpointIndex];

    if (name === expected) {
      this.nextCheckpointIndex++;
      return true;
    }

    return false;
  }

  hasCompletedCircuit() {
    return this.nextCheckpointIndex >=
      this.requiredCheckpoints.length;
  }

  crossFinishLine(direction = 1) {
    if (this.finished || !this.hasCompletedCircuit()) {
      return {
        valid: false,
        finished: this.finished
      };
    }

    if (direction <= 0) {
      return {
        valid: false,
        finished: this.finished
      };
    }

    this.completedLaps++;

    this.nextCheckpointIndex = 0;

    if (this.completedLaps >= this.totalLaps) {
      this.finished = true;
      this.currentLap = this.totalLaps;

      return {
        valid: true,
        finished: true,
        completedLaps: this.completedLaps
      };
    }

    this.currentLap = this.completedLaps + 1;

    return {
      valid: true,
      finished: false,
      currentLap: this.currentLap,
      completedLaps: this.completedLaps
    };
  }

  reset() {
    this.currentLap = 1;
    this.completedLaps = 0;
    this.nextCheckpointIndex = 0;
    this.finished = false;
  }

  getProgress() {
    return {
      currentLap: this.currentLap,
      totalLaps: this.totalLaps,
      completedLaps: this.completedLaps,
      finished: this.finished
    };
  }
}
