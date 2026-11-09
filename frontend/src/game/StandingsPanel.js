export class StandingsPanel {
  constructor(container = document.getElementById('ui-container')) {
    this.container = container;
    this.element = document.createElement('section');
    this.element.className = 'standings-panel';
    this.element.setAttribute('aria-label', 'Clasificación de carrera');
    this.element.innerHTML = `
      <h2>🏆 CLASIFICACIÓN</h2>
      <ol class="standings-list"></ol>
      <p class="standings-player-position"></p>
    `;

    this.list = this.element.querySelector('.standings-list');
    this.playerPosition = this.element.querySelector(
      '.standings-player-position'
    );

    if (this.container) {
      this.container.appendChild(this.element);
    }
  }

  update(standings) {
    if (!this.list || !this.playerPosition) return;

    this.list.innerHTML = standings.map((participant) => `
      <li
        class="${participant.id === 'player' ? 'is-player' : ''}"
        style="--participant-color: ${participant.color}"
      >
        <span class="standings-rank">${participant.position}.</span>
        <span class="standings-name">${participant.name}</span>
        <span class="standings-status">
          ${participant.finished ? 'FINALIZADO' : 'EN CARRERA'}
        </span>
      </li>
    `).join('');

    const player = standings.find(
      (participant) => participant.id === 'player'
    );

    if (player) {
      this.playerPosition.textContent =
        `TU POSICIÓN: ${player.position}.º / ${standings.length}`;
    }
  }

  destroy() {
    this.element.remove();
    this.container = null;
  }
}
