export class RaceIntro {
  constructor() {
    this.overlay = null;
    this.timers = [];
    this.active = false;
    this.generation = 0;
  }

  start(onComplete, track = {}) {
    this.destroy();

    this.active = true;

    const generation = this.generation;

    const container = document.getElementById('ui-container');

    if (!container) {
      this.active = false;
      onComplete();
      return;
    }

    this.overlay = document.createElement('div');
    this.overlay.className = 'race-intro';

    this.overlay.innerHTML = `
      <div class="race-intro-content">
        <div class="race-intro-subtitle"></div>

        <h1 class="race-intro-title"></h1>

        <div class="race-intro-description">
          PREPÁRATE PARA LA CARRERA
        </div>

        <div class="race-countdown" id="raceCountdown">
          3
        </div>
      </div>
    `;

    container.appendChild(this.overlay);

    const trackNumbers = {
      'neon-city': '01',
      'cyber-desert': '02',
      'plasma-circuit': '03'
    };
    this.overlay.querySelector('.race-intro-subtitle').textContent =
      `NEON RUSH — CIRCUITO ${trackNumbers[track.id] ?? '01'}`;
    this.overlay.querySelector('.race-intro-title').textContent =
      track.name ?? 'NEON CITY';

    const countdown = this.overlay.querySelector('#raceCountdown');

    const schedule = (callback, delay) => {
      const timer = window.setTimeout(() => {
        if (generation !== this.generation) return;
        callback();
      }, delay);

      this.timers.push(timer);
    };

    schedule(() => {
      countdown.textContent = '2';
    }, 1000);

    schedule(() => {
      countdown.textContent = '1';
    }, 2000);

    schedule(() => {
      countdown.textContent = 'GO!';
      countdown.classList.add('go');
    }, 3000);

    schedule(() => {
      this.destroy();
      onComplete();
    }, 3600);
  }

  destroy() {
    this.generation += 1;

    for (const timer of this.timers) {
      window.clearTimeout(timer);
    }

    this.timers = [];

    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }

    this.active = false;
  }
}
