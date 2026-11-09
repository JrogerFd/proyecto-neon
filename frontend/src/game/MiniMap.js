import {
  getTrackBounds,
  getTrackPoint
} from './Track.js';
import { getTrackDefinition } from './TrackCatalog.js';

export class MiniMap {
  constructor(trackId = 'neon-city') {
    this.trackId = trackId;
    this.track = getTrackDefinition(trackId);
    this.canvas = document.createElement('canvas');
    this.canvas.width = 220;
    this.canvas.height = 220;
    this.canvas.className = 'minimap-canvas';

    this.context = this.canvas.getContext('2d', { alpha: true });

    this.container = document.createElement('div');
    this.container.className = 'minimap-container';

    this.container.innerHTML = `
      <div class="minimap-title">NEON CITY</div>
    `;

    this.container.appendChild(this.canvas);

    const ui = document.getElementById('ui-container');

    if (ui) {
      ui.appendChild(this.container);
    }

    this.size = 220;
    this.padding = 22;

    // El circuito ocupa aproximadamente:
    // X: -35 a 35
    // Z: -80 a 80
    const bounds = getTrackBounds(trackId);
    this.worldMinX = bounds.minX;
    this.worldMaxX = bounds.maxX;
    this.worldMinZ = bounds.minZ;
    this.worldMaxZ = bounds.maxZ;
    this.container.querySelector('.minimap-title').textContent =
      this.track.name;
  }

  worldToMap(x, z) {
    const usableWidth = this.size - this.padding * 2;
    const usableHeight = this.size - this.padding * 2;

    const mapX =
      this.padding +
      ((x - this.worldMinX) /
        (this.worldMaxX - this.worldMinX)) *
        usableWidth;

    const mapY =
      this.padding +
      ((z - this.worldMinZ) /
        (this.worldMaxZ - this.worldMinZ)) *
        usableHeight;

    return { x: mapX, y: mapY };
  }

  drawTrack() {
    const ctx = this.context;

    ctx.beginPath();

    for (let i = 0; i <= 240; i++) {
      const progress = i / 240;
      const point = getTrackPoint(progress, this.trackId);

      const mapPoint = this.worldToMap(
        point.x,
        point.z
      );

      if (i === 0) {
        ctx.moveTo(mapPoint.x, mapPoint.y);
      } else {
        ctx.lineTo(mapPoint.x, mapPoint.y);
      }
    }

    ctx.closePath();

    ctx.strokeStyle = 'rgba(5, 5, 20, 0.75)';
    ctx.lineWidth = 10;
    ctx.stroke();

    ctx.strokeStyle = '#00eaff';
    ctx.lineWidth = 5;
    ctx.shadowColor = '#00eaff';
    ctx.shadowBlur = 12;
    ctx.stroke();

    ctx.shadowBlur = 0;
  }

  drawCar(car, color, isPlayer = false) {
    const ctx = this.context;

    const position = this.worldToMap(
      car.position.x,
      car.position.z
    );

    // Dirección del frente del automóvil (-Z local).
    const angle = car.rotation.y;

    ctx.save();

    ctx.translate(position.x, position.y);

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = isPlayer ? 15 : 10;

    if (isPlayer) {
      // El marcador triangular conserva el rumbo del jugador.
      ctx.rotate(-angle);
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(-6, 7);
      ctx.lineTo(6, 7);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  update(car, rivals = []) {
    if (!this.context || !car) return;

    const ctx = this.context;

    ctx.clearRect(0, 0, this.size, this.size);

    this.drawTrack();
    this.drawCar(car, '#ffe66d', true);

    for (const rival of rivals) {
      this.drawCar(
        rival.mesh,
        `#${rival.color.toString(16).padStart(6, '0')}`
      );
    }
  }

  destroy() {
    this.container.remove();
  }
}
