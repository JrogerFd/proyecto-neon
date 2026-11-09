const AUDIO_SETTINGS_KEY = 'neon-rush-audio-settings';

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  master: 70,
  music: 70,
  effects: 80,
  muted: false
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function normalizePercent(value, fallback = 0) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : Number(fallback);
  return clamp(numeric, 0, 100);
}

export function loadAudioSettings(storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== 'function') {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }

  try {
    const raw = storage.getItem(AUDIO_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_AUDIO_SETTINGS,
      ...parsed,
      master: normalizePercent(parsed?.master, DEFAULT_AUDIO_SETTINGS.master),
      music: normalizePercent(parsed?.music, DEFAULT_AUDIO_SETTINGS.music),
      effects: normalizePercent(parsed?.effects, DEFAULT_AUDIO_SETTINGS.effects),
      muted: Boolean(parsed?.muted)
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(settings, storage = globalThis.localStorage) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  const normalized = {
    ...DEFAULT_AUDIO_SETTINGS,
    ...settings,
    master: normalizePercent(settings?.master, DEFAULT_AUDIO_SETTINGS.master),
    music: normalizePercent(settings?.music, DEFAULT_AUDIO_SETTINGS.music),
    effects: normalizePercent(settings?.effects, DEFAULT_AUDIO_SETTINGS.effects),
    muted: Boolean(settings?.muted)
  };

  try {
    storage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export class AudioManager {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.settings = {
      ...DEFAULT_AUDIO_SETTINGS,
      ...loadAudioSettings(storage)
    };
    this.context = null;
    this.masterGain = null;
    this.musicGain = null;
    this.effectsGain = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.musicTimer = null;
    this.musicMode = null;
    this.lastSoundAt = new Map();
  }

  get masterVolume() {
    return this.settings.muted ? 0 : this.settings.master / 100;
  }

  get musicVolume() {
    return this.settings.muted ? 0 : this.settings.music / 100;
  }

  get effectsVolume() {
    return this.settings.muted ? 0 : this.settings.effects / 100;
  }

  ensureContext() {
    const AudioCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!this.context) {
      this.context = new AudioCtor();
      this.masterGain = this.context.createGain();
      this.musicGain = this.context.createGain();
      this.effectsGain = this.context.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.musicGain.gain.value = this.musicVolume;
      this.effectsGain.gain.value = this.effectsVolume;
      this.musicGain.connect(this.masterGain);
      this.effectsGain.connect(this.masterGain);
      this.masterGain.connect(this.context.destination);
    }
    return this.context;
  }

  async unlock() {
    const context = this.ensureContext();
    if (!context) return false;
    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch {
        return false;
      }
    }
    return true;
  }

  applySettings(nextSettings = {}) {
    const resolved = {
      ...DEFAULT_AUDIO_SETTINGS,
      ...this.settings,
      ...nextSettings,
      master: normalizePercent(nextSettings.master ?? this.settings.master, DEFAULT_AUDIO_SETTINGS.master),
      music: normalizePercent(nextSettings.music ?? this.settings.music, DEFAULT_AUDIO_SETTINGS.music),
      effects: normalizePercent(nextSettings.effects ?? this.settings.effects, DEFAULT_AUDIO_SETTINGS.effects),
      muted: Boolean(nextSettings.muted ?? this.settings.muted)
    };

    this.settings = resolved;
    saveAudioSettings(this.settings, this.storage);

    if (this.masterGain && this.context) {
      const now = this.context.currentTime;
      this.masterGain.gain.setTargetAtTime(this.masterVolume, now, 0.08);
      this.musicGain.gain.setTargetAtTime(this.musicVolume, now, 0.08);
      this.effectsGain.gain.setTargetAtTime(this.effectsVolume, now, 0.08);
    }

    return { ...this.settings };
  }

  _safePlay() {
    const context = this.ensureContext();
    if (!context || this.settings.muted) return null;
    return { context };
  }

  _triggerCooldown(key, delayMs = 180) {
    const now = performance.now();
    const previous = this.lastSoundAt.get(key) ?? 0;
    if (now - previous < delayMs) return true;
    this.lastSoundAt.set(key, now);
    return false;
  }

  playTone({
    type = 'sine',
    frequency = 220,
    duration = 0.12,
    volume = 0.08,
    sweep = 0,
    attack = 0.01,
    release = 0.12,
    filterFrequency = 1200,
    pan = 0
  } = {}) {
    const state = this._safePlay();
    if (!state) return null;

    const { context } = state;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const filterNode = context.createBiquadFilter();
    const pannerNode = context.createStereoPanner();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    if (sweep) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(30, frequency + sweep),
        context.currentTime + duration
      );
    }

    filterNode.type = 'lowpass';
    filterNode.frequency.value = filterFrequency;
    filterNode.Q.value = 0.8;

    gainNode.gain.setValueAtTime(0.0001, context.currentTime);
    gainNode.gain.linearRampToValueAtTime(
      volume * this.effectsVolume,
      context.currentTime + attack
    );
    gainNode.gain.exponentialRampToValueAtTime(
      0.0001,
      context.currentTime + duration + release
    );

    pannerNode.pan.value = clamp(pan, -1, 1);

    oscillator.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(this.effectsGain ?? this.masterGain);

    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + duration + release + 0.05);
    return oscillator;
  }

  playUiSound(kind = 'click') {
    if (this.settings.muted) return;
    const cooldownKey = `ui:${kind}`;
    if (this._triggerCooldown(cooldownKey, 80)) return;

    const patterns = {
      click: { frequency: 620, duration: 0.06, volume: 0.045, sweep: 90 },
      start: { frequency: 440, duration: 0.12, volume: 0.07, sweep: 220 },
      reward: { frequency: 760, duration: 0.16, volume: 0.08, sweep: 300 },
      warning: { frequency: 240, duration: 0.18, volume: 0.06, sweep: -40 }
    };
    const config = patterns[kind] ?? patterns.click;
    this.playTone({
      type: 'triangle',
      ...config,
      filterFrequency: 1800
    });
  }

  playSfx(kind = 'collision') {
    if (this.settings.muted) return;
    const configMap = {
      collision: {
        type: 'sawtooth',
        frequency: 180,
        duration: 0.16,
        volume: 0.12,
        sweep: -120,
        filterFrequency: 900
      },
      jump: {
        type: 'triangle',
        frequency: 420,
        duration: 0.18,
        volume: 0.09,
        sweep: 230,
        filterFrequency: 1400
      },
      landing: {
        type: 'sine',
        frequency: 150,
        duration: 0.22,
        volume: 0.11,
        sweep: -60,
        filterFrequency: 800
      },
      nitro: {
        type: 'square',
        frequency: 620,
        duration: 0.08,
        volume: 0.11,
        sweep: 260,
        filterFrequency: 2000
      },
      obstacle: {
        type: 'sawtooth',
        frequency: 250,
        duration: 0.12,
        volume: 0.08,
        sweep: -90,
        filterFrequency: 1100
      }
    };
    const config = configMap[kind] ?? configMap.collision;
    if (this._triggerCooldown(`sfx:${kind}`, kind === 'nitro' ? 110 : 160)) return;
    this.playTone(config);
  }

  handleRaceEvent(event) {
    if (!event || !event.type) return;
    const { type } = event;

    if (type === 'race_started') {
      this.playUiSound('start');
      this.startMusic('race');
      return;
    }

    if (type === 'collision') {
      this.playSfx('collision');
      return;
    }

    if (type === 'obstacle_avoided') {
      this.playSfx('obstacle');
      return;
    }

    if (type === 'jump_landed') {
      this.playSfx('landing');
      return;
    }

    if (type === 'nitro_second') {
      this.playSfx('nitro');
      return;
    }

    if (type === 'race_finished' || type === 'race_abandoned') {
      this.stopEngine();
      this.stopMusic();
      this.startMusic('menu');
      return;
    }

    if (type === 'speed_sample' && event.data?.milestone >= 180) {
      this.playSfx('nitro');
    }
  }

  updateEngine(speed = 0, acceleration = 0, nitroActive = false) {
    const context = this.ensureContext();
    if (!context) return;
    if (this.settings.muted) {
      if (this.engineGain) {
        this.engineGain.gain.setTargetAtTime(0.0001, context.currentTime, 0.08);
      }
      return;
    }

    if (!this.engineOsc) {
      this.engineOsc = context.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineFilter = context.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 650;
      this.engineGain = context.createGain();
      this.engineOsc.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.musicGain ?? this.masterGain);
      this.engineOsc.start();
    }

    const clampSpeed = clamp(Math.abs(speed), 0, 1.6);
    const driveBoost = nitroActive ? 80 : 0;
    const targetFrequency = 42 + clampSpeed * 120 + Math.max(0, acceleration * 30) + driveBoost;
    const targetLevel = clampSpeed * 0.12 + (nitroActive ? 0.06 : 0.01);

    this.engineOsc.frequency.setTargetAtTime(
      targetFrequency,
      context.currentTime,
      0.08
    );
    this.engineGain.gain.setTargetAtTime(
      targetLevel * this.masterVolume,
      context.currentTime,
      0.08
    );
    this.engineFilter.frequency.setTargetAtTime(
      600 + clampSpeed * 1000 + (nitroActive ? 600 : 0),
      context.currentTime,
      0.12
    );
  }

  stopEngine() {
    if (!this.context || !this.engineGain) return;
    this.engineGain.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.08);
  }

  startMusic(mode = 'menu') {
    if (this.settings.muted) return;
    const context = this.ensureContext();
    if (!context || !this.musicGain) return;

    if (this.musicTimer) {
      globalThis.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }

    const pattern = mode === 'race'
      ? [220, 330, 165, 293, 196, 392]
      : [164.81, 196, 246.94, 293.66, 220, 261.63];

    let step = 0;
    this.musicMode = mode;
    this.musicTimer = globalThis.setInterval(() => {
      if (!this.context || this.settings.muted) return;
      const note = pattern[step % pattern.length];
      this.playTone({
        type: 'sine',
        frequency: note,
        duration: mode === 'race' ? 0.18 : 0.24,
        volume: mode === 'race' ? 0.03 : 0.025,
        sweep: mode === 'race' ? 20 : 0,
        filterFrequency: mode === 'race' ? 1400 : 900,
        attack: 0.01,
        release: 0.12
      });
      step += 1;
    }, mode === 'race' ? 320 : 480);
  }

  stopMusic() {
    if (this.musicTimer) {
      globalThis.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  destroy() {
    this.stopMusic();
    if (this.engineOsc) {
      try {
        this.engineOsc.stop();
      } catch {
        // no-op
      }
    }
    if (this.context && typeof this.context.close === 'function') {
      this.context.close().catch(() => {});
    }
    this.context = null;
    this.masterGain = null;
    this.musicGain = null;
    this.effectsGain = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
  }
}
