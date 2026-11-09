import { getTrackPoint } from './Track.js';

const TRACK_SEGMENTS = 600;
const samplesByTrack = new Map();

export function getTrackProgress(position, trackId = 'neon-city') {
  if (!samplesByTrack.has(trackId)) {
    samplesByTrack.set(trackId, Array.from(
      { length: TRACK_SEGMENTS },
      (_, index) => getTrackPoint(index / TRACK_SEGMENTS, trackId)
    ));
  }
  const trackSamples = samplesByTrack.get(trackId);
  let closestDistanceSquared = Infinity;
  let closestProgress = 0;

  for (let index = 0; index < TRACK_SEGMENTS; index++) {
    const start = trackSamples[index];
    const end = trackSamples[(index + 1) % TRACK_SEGMENTS];
    const segmentX = end.x - start.x;
    const segmentZ = end.z - start.z;
    const segmentLengthSquared =
      segmentX * segmentX + segmentZ * segmentZ;
    const projection = Math.max(
      0,
      Math.min(
        1,
        ((position.x - start.x) * segmentX +
          (position.z - start.z) * segmentZ) /
          segmentLengthSquared
      )
    );
    const dx = position.x - (start.x + segmentX * projection);
    const dz = position.z - (start.z + segmentZ * projection);
    const distanceSquared = dx * dx + dz * dz;

    if (distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared;
      closestProgress =
        (index + projection) / TRACK_SEGMENTS;
    }
  }

  return closestProgress % 1;
}

export function getForwardProgressDelta(previous, current) {
  let difference = current - previous;

  if (difference > 0.5) difference -= 1;
  if (difference < -0.5) difference += 1;

  return difference;
}

export class RaceStandings {
  constructor(totalLaps = 3, trackId = 'neon-city') {
    this.totalLaps = totalLaps;
    this.trackId = trackId;
    this.reset();
  }

  getStandings(player, lapManager, rivals) {
    const playerProgress = getTrackProgress(player.position, this.trackId);
    const participants = [
      {
        id: 'player',
        name: 'TÚ',
        color: '#ffffff',
        totalProgress: lapManager.finished
          ? this.totalLaps
          : lapManager.completedLaps + playerProgress,
        finished: lapManager.finished,
        finishTime: lapManager.finished ? this.playerFinishTime : null,
        gridOrder: 0
      },
      ...rivals.map((rival, index) => {
        const progress = rival.finished
          ? this.totalLaps
          : Math.max(
            0,
            rival.completedLaps +
              rival.progress -
              rival.startProgress
          );

        return {
          id: rival.name.toLowerCase(),
          name: rival.name,
          color: `#${rival.color.toString(16).padStart(6, '0')}`,
          totalProgress: Math.min(this.totalLaps, progress),
          finished: Boolean(rival.finished),
          finishTime: rival.finishTime ?? null,
          gridOrder: index + 1
        };
      })
    ];

    participants.sort((first, second) => {
      if (first.finished !== second.finished) {
        return first.finished ? -1 : 1;
      }

      const progressDifference =
        second.totalProgress - first.totalProgress;

      if (Math.abs(progressDifference) > 1e-8) {
        return progressDifference;
      }

      if (
        first.finished &&
        first.finishTime !== null &&
        second.finishTime !== null
      ) {
        return first.finishTime - second.finishTime;
      }

      return first.gridOrder - second.gridOrder;
    });

    return participants.map((participant, index) => ({
      ...participant,
      position: index + 1
    }));
  }

  setPlayerFinishTime(time) {
    this.playerFinishTime = time;
  }

  reset() {
    this.playerFinishTime = null;
  }
}
