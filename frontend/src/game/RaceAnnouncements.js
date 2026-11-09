export class RaceAnnouncements {
  constructor() {
    this.container = document.getElementById('ui-container');
    this.announcement = null;
    this.timer = null;
    this.currentType = null;
  }

  show(message, type = 'normal', duration = 2200) {
    this.hide();

    if (!this.container) return;

    this.announcement = document.createElement('div');
    this.announcement.className = 'race-announcement';

    if (type === 'warning') {
      this.announcement.classList.add('warning');
    }

    if (type === 'last-lap') {
      this.announcement.classList.add('last-lap');
    }

    this.announcement.textContent = message;
    this.currentType = type;

    this.container.appendChild(this.announcement);

    if (duration > 0) {
      this.timer = window.setTimeout(() => {
        this.hide();
      }, duration);
    }
  }

  hide() {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.announcement) {
      this.announcement.remove();
      this.announcement = null;
    }

    this.currentType = null;
  }

  destroy() {
    this.hide();
    this.container = null;
  }
}
