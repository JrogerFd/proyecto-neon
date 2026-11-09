import { Rivals } from './Rivals.js';
import { WrongWayDetector } from './WrongWayDetector.js';
import { RaceAnnouncements } from './RaceAnnouncements.js';
import { MiniMap } from './MiniMap.js';
import { RaceIntro } from './RaceIntro.js';
import { ObstacleSystem } from './Obstacles.js';
import { CollisionSystem } from './Collision.js';
import { VehicleCollisionSystem } from './VehicleCollision.js';
import {
  getForwardProgressDelta,
  getTrackProgress,
  RaceStandings
} from './RaceStandings.js';
import { StandingsPanel } from './StandingsPanel.js';
import { getTrackSurface, isOnTrack } from './Track.js';
import { LapManager } from './LapManager.js';
import { BackendClient } from './BackendClient.js';
import * as THREE from 'three';
import { createCar, updateCarVisuals } from './Car.js';
import { createTrack } from './Track.js';
import { getTrackDefinition } from './TrackCatalog.js';
import { getTrackPoint, getTrackTangent } from './Track.js';
import { getVehicle } from './VehicleCatalog.js';
import { applyUpgrades } from './UpgradePreview.js';
import { applyRendererQuality, getQualityProfile } from './QualityProfiles.js';
import { RampSystem } from './RampSystem.js';
import { VehicleEffects } from './VehicleEffects.js';

export class Race {
  constructor(
    container,
    simulationConfig = {},
    onBackendStatus = () => {},
    onRaceCompleted = () => null,
    onGameEvent = () => {},
    audioManager = null
  ) {
    this.container = container;
    const supportedModes = ['local', 'sequential', 'openmp', 'mpi'];
    this.simulationConfig = {
      mode: supportedModes.includes(simulationConfig.mode)
        ? simulationConfig.mode
        : 'local',
      threads: [2, 4].includes(Number(simulationConfig.threads))
        ? Number(simulationConfig.threads)
        : 4,
      processes: [1, 2, 3].includes(Number(simulationConfig.processes))
        ? Number(simulationConfig.processes)
        : 3,
      laps: [1, 3, 5].includes(Number(simulationConfig.laps))
        ? Number(simulationConfig.laps)
        : 3,
      trackId: ['neon-city', 'cyber-desert', 'plasma-circuit']
        .includes(simulationConfig.trackId)
        ? simulationConfig.trackId
        : 'neon-city',
      vehicleId: simulationConfig.vehicleId ?? 'neon-starter',
      difficulty: ['easy', 'normal', 'hard', 'expert']
        .includes(simulationConfig.difficulty)
        ? simulationConfig.difficulty
        : 'normal',
      rivalCount: [0, 1, 2, 3].includes(Number(simulationConfig.rivalCount))
        ? Number(simulationConfig.rivalCount)
        : 3,
      quality: ['low', 'medium', 'high'].includes(simulationConfig.quality)
        ? simulationConfig.quality
        : 'medium',
      customization: simulationConfig.customization ?? {},
      upgrades: simulationConfig.upgrades ?? {},
      championship: typeof simulationConfig.championship?.id === 'string'
        ? {
          id: simulationConfig.championship.id,
          roundIndex: Number(simulationConfig.championship.roundIndex) || 0
        }
        : null
    };
    this.track = getTrackDefinition(this.simulationConfig.trackId);
    this.vehicle = getVehicle(this.simulationConfig.vehicleId);
    this.vehicleStats = applyUpgrades(
      this.vehicle,
      this.simulationConfig.upgrades
    );
    this.qualityProfile = getQualityProfile(this.simulationConfig.quality);
    this.backendClient = new BackendClient();
    this.onBackendStatus = (status) => {
      this.backendStatus = status;
      this.setSimulationLabel();
      onBackendStatus(status);
    };
    this.onRaceCompleted = onRaceCompleted;
    this.onGameEvent = onGameEvent;
    this.audioManager = audioManager;
    this.raceId = globalThis.crypto?.randomUUID?.() ??
      `race-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.gameEventSequence = 0;
    this.raceCollisionCount = 0;
    this.raceDistanceMeters = 0;
    this.telemetryAccumulators = { nitro: 0, speed: 0, onTrack: 0 };
    this.reportedSpeedMilestones = new Set();
    this.overtakenRivals = new Set();
    this.previousStandingsProgress = new Map();
    this.obstacleVisits = new Set();
    this.sectorStartedAt = 0;
    this.lapStartedAt = 0;
    this.backendRequestSequence = 0;
    this.backendRequestController = null;
    this.backendRequestInFlight = false;
    this.backendElapsed = 0;
    this.backendUpdateInterval =
      this.simulationConfig.mode === 'mpi' ? 0.5 : 0.1;
    this.cppMovementEnabled =
      this.simulationConfig.mode === 'sequential' ||
      this.simulationConfig.mode === 'openmp';
    this.backendPositionTarget = null;
    this.backendTransitionRemaining = 0;
    this.backendCollisionPairs = [];
    this.backendImpactCooldowns = new Map();
    this.backendLatestMetrics = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);
    this.scene.fog = new THREE.Fog(
      0x050510,
      40,
      this.qualityProfile.fogFar
    );

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.simulationConfig.quality !== 'low'
    });

    applyRendererQuality(this.renderer, this.simulationConfig.quality);
    this.renderer.setSize(
      this.container.clientWidth || window.innerWidth,
      this.container.clientHeight || window.innerHeight,
      false
    );
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    this.container.appendChild(this.renderer.domElement);

    createTrack(
      this.scene,
      this.simulationConfig.trackId,
      this.simulationConfig.quality
    );

    // Obstáculos interactivos
    this.obstacleSystem = new ObstacleSystem(
      this.scene,
      this.simulationConfig.trackId
    );

    this.car = createCar(
      this.vehicle.id,
      { customization: this.simulationConfig.customization }
    );
    this.car.position.copy(getTrackPoint(0, this.simulationConfig.trackId));
    this.progressionDistancePosition = this.car.position.clone();
    const startTangent = getTrackTangent(0, this.simulationConfig.trackId);
    this.car.rotation.order = 'YXZ';
    this.car.rotation.y = Math.atan2(-startTangent.x, -startTangent.z);
    this.car.rotation.x = Math.atan2(
      startTangent.y,
      Math.hypot(startTangent.x, startTangent.z)
    );
    this.car.rotation.z = getTrackSurface(
      0,
      0,
      this.simulationConfig.trackId
    ).bank;
    this.scene.add(this.car);
    this.setSimulationLabel();

    // Sprint 4.1 — Tres rivales en la parrilla.
    this.rivals = new Rivals(this.scene, {
      trackId: this.simulationConfig.trackId,
      difficulty: this.simulationConfig.difficulty,
      count: this.simulationConfig.rivalCount
    });

    // SPRINT 3.7 — Minimapa en tiempo real.
    this.miniMap = new MiniMap(this.simulationConfig.trackId);
    this.miniMap.update(this.car);

    this.lapManager = new LapManager(this.simulationConfig.laps);
    this.rampSystem = new RampSystem(this.track.zones);
    this.effects = new VehicleEffects(
      this.scene,
      this.qualityProfile.maxParticles
    );
    this.raceStandings = new RaceStandings(
      this.lapManager.totalLaps,
      this.simulationConfig.trackId
    );
    this.standingsPanel = new StandingsPanel();
    this.currentStandings = [];
    this.standingsUpdateTimer = 0;
    this.previousTrackProgress = getTrackProgress(
      this.car.position,
      this.simulationConfig.trackId
    );
    this.updateStandings();

    // Sprint 3.8: avisos y detección de sentido contrario.
    this.announcements = new RaceAnnouncements();
    this.wrongWayDetector = new WrongWayDetector(
      this.simulationConfig.trackId
    );
    this.wrongWayDetector.reset(this.car);
    this.warningVisible = false;
    this.collisionSystem = new CollisionSystem(
      this.simulationConfig.trackId
    );
    this.vehicleCollisionSystem = new VehicleCollisionSystem();
    this.collisionFlash = 0;
    this.previousCarPosition = this.car.position.clone();

    this.keys = {};
    this.speed = 0;
    this.maxSpeed = 0.65 * this.vehicleStats.maxSpeed;
    this.acceleration = 0.012 * this.vehicleStats.acceleration;
    this.braking = this.acceleration * (this.vehicleStats.braking ?? 1);
    this.friction = 0.006;
    this.steeringScale = this.vehicleStats.handling;

    this.clock = new THREE.Timer();
    this.clock.connect(document);
    this.backendStatus = 'disconnected';
    this.elapsedTime = 0;
    this.nitro = 100;
    this.nitroActive = false;

    this.onKeyDown = (event) => {
      this.keys[event.code] = true;

      if ([
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Space'
      ].includes(event.code)) {
        event.preventDefault();
      }
    };

    this.onKeyUp = (event) => {
      this.keys[event.code] = false;
    };

    this.onResize = () => {
      const width = this.container.clientWidth || window.innerWidth;
      const height = this.container.clientHeight || window.innerHeight;

      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      this.renderer.setSize(width, height, false);
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);

    // SPRINT 3.6 — Introducción de NEON CITY
    this.raceIntro = new RaceIntro();
    this.raceStarted = false;

    this.startRaceIntro();

    this.running = true;
    this.animate();
  }

  startRaceIntro() {
    this.raceStarted = false;
    this.speed = 0;
    this.nitroActive = false;
    this.keys = {};

    this.raceIntro.start(() => {
      this.raceStarted = true;

      // Evitar que el tiempo de la introducción
      // afecte al primer fotograma de la carrera.
      this.clock.update(performance.now());
      this.clock.getDelta();
      this.lapStartedAt = this.elapsedTime;
      this.sectorStartedAt = this.elapsedTime;
      this.emitGameEvent('race_started', {
        laps: this.lapManager.totalLaps,
        rivalCount: this.rivals.cars.length
      });
    }, this.track);
  }

  emitGameEvent(type, data = {}) {
    const event = {
      eventId: `${this.raceId}:${++this.gameEventSequence}`,
      raceId: this.raceId,
      type,
      trackId: this.simulationConfig.trackId,
      elapsedTime: this.elapsedTime,
      championshipId: this.simulationConfig.championship?.id ?? null,
      data: {
        vehicleId: this.simulationConfig.vehicleId,
        ...data
      }
    };
    try {
      this.onGameEvent(event);
    } catch (error) {
      console.error(`Unable to record race event "${type}".`, error);
    }
    return event;
  }

  recordCollision(source) {
    this.raceCollisionCount += 1;
    this.emitGameEvent('collision', {
      source,
      collisions: this.raceCollisionCount
    });
  }

  recordContinuousTelemetry(delta) {
    const trackedDelta = Math.min(delta, 0.05);
    this.telemetryAccumulators.speed += trackedDelta;
    if (this.nitroActive) {
      this.telemetryAccumulators.nitro += trackedDelta;
    }
    const progress = getTrackProgress(
      this.car.position,
      this.simulationConfig.trackId
    );
    const speedKmh = Math.round(Math.abs(this.speed) * 300);
    for (const milestone of [150, 180, 200, 220]) {
      if (speedKmh >= milestone &&
          !this.reportedSpeedMilestones.has(milestone)) {
        this.reportedSpeedMilestones.add(milestone);
        this.emitGameEvent('speed_sample', {
          speedKmh,
          milestone
        });
      }
    }
    const surface = getTrackSurface(
      progress,
      0,
      this.simulationConfig.trackId
    );
    const onTrack = this.rampSystem.state === 'GROUNDED' &&
      isOnTrack(
        this.car.position.x,
        this.car.position.z,
        this.simulationConfig.trackId
      ) &&
      Math.abs(this.car.position.y - surface.point.y) < 2;
    if (onTrack) this.telemetryAccumulators.onTrack += trackedDelta;

    while (this.telemetryAccumulators.speed >= 1) {
      this.telemetryAccumulators.speed -= 1;
      const speedKmh = Math.round(Math.abs(this.speed) * 300);
      if (speedKmh > 0) this.emitGameEvent('speed_sample', { speedKmh });
    }
    while (this.telemetryAccumulators.nitro >= 1) {
      this.telemetryAccumulators.nitro -= 1;
      this.emitGameEvent('nitro_second', { seconds: 1 });
    }
    while (this.telemetryAccumulators.onTrack >= 1) {
      this.telemetryAccumulators.onTrack -= 1;
      this.emitGameEvent('on_track_second', { seconds: 1 });
    }
  }

  recordObstacleAvoidances(previousProgress, currentProgress, collision) {
    const crossed = (target) => previousProgress <= currentProgress
      ? target > previousProgress && target <= currentProgress
      : target > previousProgress || target <= currentProgress;
    for (const obstacle of this.obstacleSystem.obstacles) {
      const visitId = `${obstacle.id}:${this.lapManager.completedLaps}`;
      if (this.obstacleVisits.has(visitId) ||
          !obstacle.active ||
          !crossed(obstacle.progress) ||
          collision?.obstacle === obstacle ||
          Math.abs(this.car.position.y - obstacle.mesh.position.y) > 3.4) {
        continue;
      }
      const distance = Math.hypot(
        this.car.position.x - obstacle.mesh.position.x,
        this.car.position.z - obstacle.mesh.position.z
      );
      if (distance > obstacle.radius + 5 || distance < obstacle.radius + 1.2) {
        continue;
      }
      this.obstacleVisits.add(visitId);
      this.emitGameEvent('obstacle_avoided', {
        obstacleId: obstacle.id,
        obstacleType: obstacle.type
      });
    }
  }

  setSimulationLabel() {
    const statusText = this.backendStatus === 'connected'
      ? 'CONECTADO'
      : this.backendStatus === 'simulating'
        ? 'SIMULANDO'
        : this.backendStatus === 'error'
          ? 'DESCONECTADO'
          : 'DESCONECTADO';

    const labels = {
      local: `FÍSICA LOCAL JS — ${statusText}`,
      sequential: `MOVIMIENTO JUGADOR C++ SECUENCIAL — ${statusText}`,
      openmp: `MOVIMIENTO JUGADOR C++ OPENMP · ${this.simulationConfig.threads} HILOS — ${statusText}`,
      mpi: `FÍSICA LOCAL + MPI ${this.simulationConfig.processes} PROCESOS (SOMBRA) — ${statusText}`
    };
    const label = document.querySelector('.race-hud .hud-item strong');
    if (label) {
      label.textContent = labels[this.simulationConfig.mode];
    }
    this.renderBackendMetrics();
  }

  renderBackendMetrics() {
    const element = document.getElementById('raceBackendMetrics');
    if (!element) return;

    if (!this.backendLatestMetrics) {
      element.textContent = '';
      return;
    }

    const { metrics } = this.backendLatestMetrics;
    const nodeSummary = this.backendLatestMetrics.nodes?.length
      ? ` · ${this.backendLatestMetrics.nodes.join(', ')}`
      : '';
    element.textContent =
      `C++ ${metrics.totalSeconds.toFixed(3)}s · ` +
      `${metrics.collisions} colisión(es)${nodeSummary}`;
  }

  vehicleSnapshot(id, position, velocity) {
    return {
      id,
      x: position.x,
      z: position.z,
      speed: Math.hypot(velocity.x, velocity.z),
      direction: Math.atan2(velocity.z, velocity.x),
      collisionRadius: 1,
      active: true
    };
  }

  reportBackendCollisions(collisionPairs) {
    const now = performance.now();
    for (const [pair, expiresAt] of this.backendImpactCooldowns) {
      if (expiresAt <= now) {
        this.backendImpactCooldowns.delete(pair);
      }
    }

    for (const pair of collisionPairs) {
      if (!pair.includes(0)) continue;
      const key = pair.join(':');
      if (this.backendImpactCooldowns.has(key)) continue;

      this.backendImpactCooldowns.set(key, now + 500);
      this.collisionFlash = Math.max(this.collisionFlash, 0.16);
    }
  }

  scheduleBackendStep(delta) {
    this.backendElapsed = Math.min(this.backendElapsed + delta, 0.5);
    if (
      this.backendRequestInFlight ||
      this.backendElapsed < this.backendUpdateInterval ||
      !this.running ||
      this.raceFinished
    ) {
      return;
    }

    const elapsed = this.backendElapsed;
    this.backendElapsed = 0;
    const steps = Math.max(1, Math.ceil(elapsed / 0.1));
    const deltaTime = elapsed / steps;
    const requestId = `race-${++this.backendRequestSequence}`;
    const playerVelocity = {
      x: -Math.sin(this.car.rotation.y) * this.speed * 60,
      z: -Math.cos(this.car.rotation.y) * this.speed * 60
    };
    const vehicles = [
      this.vehicleSnapshot(0, this.car.position, playerVelocity),
      ...this.rivals.cars.map((rival, index) =>
        this.vehicleSnapshot(
          index + 1,
          rival.mesh.position,
          this.rivals.getVelocity(rival)
        )
      )
    ];
    const request = {
      requestId,
      mode: this.simulationConfig.mode,
      steps,
      deltaTime,
      vehicles
    };
    const requestStartedAt = performance.now();

    if (request.mode === 'openmp') {
      request.threads = this.simulationConfig.threads;
    } else if (request.mode === 'mpi') {
      request.processes = this.simulationConfig.processes;
    }

    this.backendRequestInFlight = true;
    this.backendRequestController = new AbortController();
    this.onBackendStatus('simulating');

    this.backendClient.simulate(request, {
      signal: this.backendRequestController.signal
    }).then((result) => {
      if (
        !this.running ||
        this.raceFinished ||
        requestId !== `race-${this.backendRequestSequence}`
      ) {
        return;
      }
      if (result.requestId !== requestId) {
        throw new Error('El backend respondió a un tick diferente');
      }

      if (this.cppMovementEnabled &&
          performance.now() - requestStartedAt > 300) {
        throw new Error('La respuesta C++ llegó fuera de la ventana de movimiento');
      }

      const player = result.vehicles.find((vehicle) => vehicle.id === 0);
      if (!player) {
        throw new Error('La respuesta del backend no incluye al jugador');
      }

      if (this.cppMovementEnabled) {
        const playerStart = vehicles[0];
        this.backendPositionTarget = {
          x: this.car.position.x + player.x - playerStart.x,
          z: this.car.position.z + player.z - playerStart.z
        };
        this.backendTransitionRemaining = steps * deltaTime;
      }
      this.backendCollisionPairs = result.collisionPairs;
      this.reportBackendCollisions(result.collisionPairs);
      this.backendLatestMetrics = result;
      this.renderBackendMetrics();
      this.onBackendStatus('connected');
    }).catch((error) => {
      if (error.name === 'AbortError' || !this.running) return;

      console.warn(
        'La simulación C++ no respondió; se conserva el estado de carrera y se vuelve a JavaScript.',
        error
      );
      this.simulationConfig.mode = 'local';
      this.cppMovementEnabled = false;
      this.backendElapsed = 0;
      this.backendPositionTarget = null;
      this.backendTransitionRemaining = 0;
      this.backendCollisionPairs = [];
      this.backendLatestMetrics = null;
      this.setSimulationLabel();
      this.onBackendStatus('error');
    }).finally(() => {
      this.backendRequestInFlight = false;
      this.backendRequestController = null;
    });
  }

  cancelBackendStep() {
    const requestWasActive = this.backendRequestInFlight;
    this.backendRequestSequence += 1;
    this.backendRequestController?.abort();
    this.backendRequestController = null;
    this.backendRequestInFlight = false;
    this.backendElapsed = 0;

    if (requestWasActive) {
      this.backendClient.health()
        .then(() => this.onBackendStatus('connected'))
        .catch(() => this.onBackendStatus('disconnected'));
    }
  }

  applyCppMovement(delta) {
    if (!this.cppMovementEnabled || !this.backendPositionTarget) return;

    const stepDuration = Math.min(delta, this.backendTransitionRemaining);
    const fraction = this.backendTransitionRemaining > 0
      ? stepDuration / this.backendTransitionRemaining
      : 1;
    this.car.position.x +=
      (this.backendPositionTarget.x - this.car.position.x) * fraction;
    this.car.position.z +=
      (this.backendPositionTarget.z - this.car.position.z) * fraction;
    this.backendTransitionRemaining = Math.max(
      0,
      this.backendTransitionRemaining - delta
    );

    if (this.backendTransitionRemaining === 0) {
      this.car.position.x = this.backendPositionTarget.x;
      this.car.position.z = this.backendPositionTarget.z;
      this.backendPositionTarget = null;
    }
  }

  update(delta) {
    if (this.raceFinished || !this.raceStarted) return;
    const step = Math.min(delta * 60, 2);

    this.elapsedTime += delta;

    const minutes = Math.floor(this.elapsedTime / 60);
    const seconds = Math.floor(this.elapsedTime % 60);

    const timerElement = document.getElementById('raceTime');

    if (timerElement) {
      timerElement.textContent =
        String(minutes).padStart(2, '0') + ':' +
        String(seconds).padStart(2, '0');
    }

    this.nitroActive =
      this.keys['Space'] &&
      this.nitro > 0 &&
      this.speed > 0.05;
    if (this.nitroActive) {
      this.effects.emitNitro(
        this.car,
        delta,
        this.simulationConfig.customization.neonColor
      );
    }

    if (this.nitroActive) {
      this.nitro = Math.max(0, this.nitro - 25 * delta);
    } else {
      this.nitro = Math.min(100, this.nitro + 8 * delta);
    }

    this.audioManager?.updateEngine(this.speed, this.acceleration, this.nitroActive);

    const nitroFill = document.getElementById('nitroFill');

    if (nitroFill) {
      nitroFill.style.width = this.nitro + '%';
    }

    if (this.keys['KeyW'] || this.keys['ArrowUp']) {
      this.speed += this.acceleration * step;
    } else if (this.keys['KeyS'] || this.keys['ArrowDown']) {
      this.speed -= this.braking * step;
    } else {
      if (this.speed > 0) {
        this.speed = Math.max(
          0,
          this.speed - this.friction * step
        );
      } else {
        this.speed = Math.min(
          0,
          this.speed + this.friction * step
        );
      }
    }

    const offTrack = !isOnTrack(
      this.car.position.x,
      this.car.position.z,
      this.simulationConfig.trackId
    );

    const trackProgress = getTrackProgress(
      this.car.position,
      this.simulationConfig.trackId
    );
    this.surfaceZone = this.track.zones.find((zone) =>
      trackProgress >= zone.start && trackProgress <= zone.end
    ) ?? null;
    const surfaceFactor = this.surfaceZone?.factor ?? 1;
    const gradeTangent = getTrackTangent(
      trackProgress,
      this.simulationConfig.trackId
    );
    const grade = Math.atan2(
      gradeTangent.y,
      Math.hypot(gradeTangent.x, gradeTangent.z)
    );
    this.speed -= 0.003 * Math.sin(grade) *
      Math.sign(this.speed || 1) * step;
    const currentMaxSpeed = this.nitroActive
      ? this.maxSpeed * (1.45 + this.vehicleStats.nitro * 0.15)
      : this.maxSpeed;

    const surfaceMaxSpeed = offTrack
      ? currentMaxSpeed * 0.4
      : currentMaxSpeed * surfaceFactor;

    this.speed = THREE.MathUtils.clamp(
      this.speed,
      -this.maxSpeed / 2,
      surfaceMaxSpeed
    );
    if (this.surfaceZone?.type === 'sand') {
      this.speed *= Math.max(0, 1 - delta * 0.65);
    }

    const steeringInput =
      Number(Boolean(this.keys['KeyA'] || this.keys['ArrowLeft'])) -
      Number(Boolean(this.keys['KeyD'] || this.keys['ArrowRight']));
    const steering = 0.025 * step * this.steeringScale;

    if (Math.abs(this.speed) > 0.01) {
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) {
        this.car.rotation.y += steering;
      }

      if (this.keys['KeyD'] || this.keys['ArrowRight']) {
        this.car.rotation.y -= steering;
      }
    }

    // Guardar la posición anterior para calcular colisiones.
    const previousPosition = this.car.position.clone();

    if (this.cppMovementEnabled) {
      this.applyCppMovement(delta);
    } else {
      this.car.translateZ(-this.speed * step);
    }
    const currentProgress = getTrackProgress(
      this.car.position,
      this.simulationConfig.trackId
    );
    const centerSurface = getTrackSurface(
      currentProgress,
      0,
      this.simulationConfig.trackId
    );
    const horizontalLength = Math.hypot(
      centerSurface.tangent.x,
      centerSurface.tangent.z
    ) || 1;
    const lateralNormalX = centerSurface.tangent.z / horizontalLength;
    const lateralNormalZ = -centerSurface.tangent.x / horizontalLength;
    let lateralOffset =
      (this.car.position.x - centerSurface.point.x) * lateralNormalX +
      (this.car.position.z - centerSurface.point.z) * lateralNormalZ;
    let surface = getTrackSurface(
      currentProgress,
      lateralOffset,
      this.simulationConfig.trackId
    );
    const previousRampState = this.rampSystem.state;
    const previousAirTime = this.rampSystem.airTime;
    this.rampSystem.update(
      this.car,
      this.previousTrackProgress,
      currentProgress,
      delta,
      this.speed,
      surface.point.y
    );
    if (previousRampState !== 'GROUNDED' &&
        this.rampSystem.state === 'GROUNDED') {
      this.emitGameEvent('jump_landed', {
          airTime: previousAirTime + Math.min(delta, 0.05),
        trackId: this.simulationConfig.trackId
      });
    }
    if (this.rampSystem.state === 'GROUNDED') {
      const edgeLimit = this.track.width / 2 + 0.45;
      if (Math.abs(lateralOffset) > edgeLimit) {
        lateralOffset = Math.sign(lateralOffset) * edgeLimit;
        this.car.position.x = centerSurface.point.x +
          lateralNormalX * lateralOffset;
        this.car.position.z = centerSurface.point.z +
          lateralNormalZ * lateralOffset;
        this.speed *= 0.55;
        this.collisionFlash = Math.max(this.collisionFlash, 0.12);
        surface = getTrackSurface(
          currentProgress,
          lateralOffset,
          this.simulationConfig.trackId
        );
      }
      this.car.position.y = surface.point.y;
      this.car.rotation.order = 'YXZ';
      this.car.rotation.x = Math.atan2(
        centerSurface.tangent.y,
        Math.hypot(centerSurface.tangent.x, centerSurface.tangent.z)
      );
      this.car.rotation.z = surface.bank;
    } else {
      this.car.rotation.x *= Math.max(0, 1 - delta * 2.2);
      this.car.rotation.z *= Math.max(0, 1 - delta * 2.2);
    }

    // =====================================
    // COLISIONES CON OBSTÁCULOS
    // =====================================

    this.obstacleSystem.update(delta);

    const obstacleCollision =
      this.obstacleSystem.checkCollision(
        this.car,
        previousPosition
      );

    if (obstacleCollision.collided) {
      this.recordCollision('obstacle');
      // Reducir velocidad y provocar un rebote arcade.
      this.speed = -Math.abs(this.speed) * 0.18 *
        (obstacleCollision.penalty ?? 0.86);

      // Efecto visual del impacto.
      this.collisionFlash = 0.3;
      this.effects.emitImpact(this.car.position);

      console.log('💥 Rebote contra obstáculo neón');
    }
    this.recordObstacleAvoidances(
      this.previousTrackProgress,
      currentProgress,
      obstacleCollision
    );


    // =====================================
    // COLISIONES CON BARRERAS
    // =====================================

    this.collisionSystem.update(delta);

    const collision = this.collisionSystem.checkTrackCollision(
      this.car,
      this.speed
    );

    if (collision.collided) {
      this.recordCollision('track-barrier');
      this.speed = collision.speed;
      this.collisionFlash = 0.25;
      this.effects.emitImpact(this.car.position);
    }

    if (this.collisionFlash > 0) {
      this.collisionFlash -= delta;
    }

    const flashElement = document.getElementById('collisionFlash');

    if (flashElement) {
      flashElement.style.opacity =
        this.collisionFlash > 0 ? '1' : '0';
    }


    // Comprobar el avance por el circuito
    const wrongWay = this.wrongWayDetector.update(
      this.car,
      delta
    );

    if (wrongWay && !this.warningVisible) {
      this.warningVisible = true;
      this.announcements.show(
        '⚠️ ¡SENTIDO CONTRARIO!',
        'warning',
        0
      );
    }

    if (!wrongWay && this.warningVisible) {
      this.warningVisible = false;
      this.announcements.hide();
    }

    // Actualizar indicador de velocidad
    const speedElement = document.getElementById('speedValue');

    if (speedElement) {
      const kmh = Math.round(Math.abs(this.speed) * 300);
      speedElement.textContent = kmh;
    }

    // Cámara de persecución
    const speedRatio = Math.min(1, Math.abs(this.speed) / this.maxSpeed);
    const cameraOffset = new THREE.Vector3(
      0,
      5.2 + speedRatio * 0.8,
      9.5 + speedRatio * 2.5
    );
    cameraOffset.applyQuaternion(this.car.quaternion);

    const desiredPosition = this.car.position
      .clone()
      .add(cameraOffset);

    this.camera.position.lerp(
      desiredPosition,
      Math.min(0.08 * step, 1)
    );

    const lookTarget = this.car.position.clone();
    lookTarget.y += 1;

    this.camera.lookAt(lookTarget);
    const targetFov = 65 + speedRatio * 6 + (this.nitroActive ? 3 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.15) {
      this.camera.fov += (targetFov - this.camera.fov) *
        Math.min(1, delta * 4);
      this.camera.updateProjectionMatrix();
    }

    updateCarVisuals(this.car, {
      delta,
      speed: this.speed,
      steering: steeringInput,
      braking: Boolean(this.keys['KeyS'] || this.keys['ArrowDown']),
      nitro: this.nitroActive
    });
    const distanceDelta = this.car.position.distanceTo(
      this.progressionDistancePosition
    );
    if (Number.isFinite(distanceDelta) && distanceDelta < 10) {
      this.raceDistanceMeters += distanceDelta;
    }
    this.progressionDistancePosition.copy(this.car.position);
    this.recordContinuousTelemetry(delta);
  }

  animate() {
    if (!this.running) return;

    this.clock.update(performance.now());
    const delta = this.clock.getDelta();
    const clampedDelta = Number.isFinite(delta) && delta >= 0
      ? Math.min(delta, 0.05)
      : 0;

    this.update(clampedDelta);

    if (this.rivals && this.raceStarted && !this.raceFinished) {
      const previousRivalPositions = new Map(
        this.rivals.cars.map((rival) => [
          rival,
          rival.mesh.position.clone()
        ])
      );
      this.rivals.update(
        delta,
        this.car,
        this.obstacleSystem.obstacles,
        this.speed,
        this.lapManager.totalLaps
      );

      for (const rival of this.rivals.cars) {
        const obstacleCollision = this.obstacleSystem.checkCollision(
          rival.mesh,
          previousRivalPositions.get(rival)
        );
        if (obstacleCollision.collided) {
          rival.speedScale *= obstacleCollision.penalty;
          this.effects.emitImpact(rival.mesh.position, rival.color);
        }
        updateCarVisuals(rival.mesh, {
          delta,
          speed: rival.speed * this.rivals.trackLength / 60,
          steering: 0,
          braking: rival.speedScale < 0.75
        });
      }
    }

    if (this.raceStarted && !this.raceFinished) {
      this.vehicleCollisionSystem.update(
        [
          {
            mesh: this.car,
            getVelocity: () => ({
              x: -Math.sin(this.car.rotation.y) * this.speed * 60,
              z: -Math.cos(this.car.rotation.y) * this.speed * 60
            }),
            onImpact: (speedFactor) => {
              this.speed *= speedFactor;
              this.recordCollision('vehicle');
              this.collisionFlash = Math.max(
                this.collisionFlash,
                0.18
              );
              this.effects.emitImpact(this.car.position);
            }
          },
          ...this.rivals.cars.map((rival) => ({
            mesh: rival.mesh,
            getVelocity: () => this.rivals.getVelocity(rival),
            onImpact: (speedFactor) => {
              rival.speedScale *= speedFactor;
              this.effects.emitImpact(rival.mesh.position, rival.color);
            }
          }))
        ],
        delta
      );

      this.updateLaps();
    }

    this.effects.update(delta);

    if (
      this.raceStarted &&
      !this.raceFinished &&
      this.simulationConfig.mode !== 'local'
    ) {
      this.scheduleBackendStep(delta);
    }

    // Actualizar posición y orientación en tiempo real.
    if (this.miniMap) {
      this.miniMap.update(this.car, this.rivals.cars);
    }

    if (this.raceStarted && !this.raceFinished) {
      this.standingsUpdateTimer += delta;

      if (this.standingsUpdateTimer >= 0.1) {
        this.updateStandings();
        this.standingsUpdateTimer %= 0.1;
      }
    }

    this.renderer.render(this.scene, this.camera);

    this.animationId = requestAnimationFrame(
      () => this.animate()
    );
  }

  updateLaps() {
    if (this.lapManager.finished) return;

    const p = this.car.position;
    const currentTrackProgress = getTrackProgress(
      p,
      this.simulationConfig.trackId
    );
    const roadSurface = getTrackSurface(
      currentTrackProgress,
      0,
      this.simulationConfig.trackId
    );
    const onRoad = this.rampSystem.state === 'GROUNDED' &&
      isOnTrack(p.x, p.z, this.simulationConfig.trackId) &&
      Math.abs(p.y - roadSurface.point.y) < 2;
    const progressDirection = getForwardProgressDelta(
      this.previousTrackProgress,
      currentTrackProgress
    );

    if (progressDirection > 0 &&
        onRoad) {
      const checkpointNames = ['north', 'west', 'south'];
      while (this.lapManager.nextCheckpointIndex <
          this.track.checkpoints.length) {
        const checkpointProgress = this.track.checkpoints[
          this.lapManager.nextCheckpointIndex
        ];
        const crossedCheckpoint = currentTrackProgress >=
          this.previousTrackProgress
          ? checkpointProgress > this.previousTrackProgress &&
            checkpointProgress <= currentTrackProgress
          : checkpointProgress > this.previousTrackProgress ||
            checkpointProgress <= currentTrackProgress;
        if (!crossedCheckpoint) break;
        const checkpointVisited = this.lapManager.visitCheckpoint(
          checkpointNames[this.lapManager.nextCheckpointIndex],
          progressDirection
        );
        if (checkpointVisited) {
          const checkpoint = checkpointNames[
            this.lapManager.nextCheckpointIndex - 1
          ];
          const sectorTime = this.elapsedTime - this.sectorStartedAt;
          this.emitGameEvent('checkpoint', {
            checkpoint,
            progress: checkpointProgress
          });
          this.emitGameEvent('sector_completed', {
            checkpoint,
            seconds: sectorTime
          });
          this.sectorStartedAt = this.elapsedTime;
        }
        if (progressDirection < 0) break;
        if (currentTrackProgress < this.previousTrackProgress) break;
      }
    }

    const crossedFinish =
      progressDirection > 0 &&
      currentTrackProgress < this.previousTrackProgress &&
      onRoad;

    if (crossedFinish) {
      const result = this.lapManager.crossFinishLine(
        progressDirection
      );

      if (result.valid) {
        const lapTime = this.elapsedTime - this.lapStartedAt;
        this.emitGameEvent('lap_completed', {
          lap: result.completedLaps,
          lapTime
        });
        this.lapStartedAt = this.elapsedTime;
        console.log(
          `🏁 Vuelta ${result.completedLaps} completada`
        );

        if (result.finished) {
          this.finishRace();
        } else {
          const currentLap = this.lapManager.currentLap;
          const totalLaps = this.lapManager.totalLaps;

          if (currentLap === totalLaps) {
            this.announcements.show(
              '🔥 ¡ÚLTIMA VUELTA!',
              'last-lap',
              2500
            );
          } else {
            this.announcements.show(
              `🏁 ¡VUELTA ${currentLap} DE ${totalLaps}!`,
              'normal',
              2200
            );
          }
        }
      }
    }

    const lapElement = document.getElementById('lapValue');

    if (lapElement) {
      lapElement.textContent =
        `${this.lapManager.currentLap}/${this.lapManager.totalLaps}`;
    }

    this.previousCarPosition.copy(p);
    this.previousTrackProgress = currentTrackProgress;
  }

  updateStandings() {
    this.currentStandings = this.raceStandings.getStandings(
      this.car,
      this.lapManager,
      this.rivals.cars
    );
    this.standingsPanel.update(this.currentStandings);
    const player = this.currentStandings.find(({ id }) => id === 'player');
    if (!player) return;
    for (const rival of this.currentStandings.filter(
      ({ id }) => id !== 'player'
    )) {
      const previousPlayer = this.previousStandingsProgress.get('player');
      const previousRival = this.previousStandingsProgress.get(rival.id);
      if (previousPlayer && previousRival &&
          previousPlayer.position > previousRival.position &&
          player.position < rival.position &&
          !this.overtakenRivals.has(rival.id)) {
        this.overtakenRivals.add(rival.id);
        this.emitGameEvent('overtake', {
          rivalId: rival.id,
          count: 1
        });
      }
      this.previousStandingsProgress.set(rival.id, {
        position: rival.position,
        totalProgress: rival.totalProgress
      });
    }
    this.previousStandingsProgress.set('player', {
      position: player.position,
      totalProgress: player.totalProgress
    });
  }

  finishRace() {
    if (this.raceFinished) return;
    this.cancelBackendStep();
    this.speed = 0;
    this.keys = {};
    this.raceFinished = true;
    this.raceStandings.setPlayerFinishTime(this.elapsedTime);
    this.updateStandings();
    const playerPosition = this.currentStandings.find(
      (participant) => participant.name === 'TÚ'
    )?.position ?? this.currentStandings.length;
    const participants = this.currentStandings.map((participant) => ({
      id: participant.id,
      name: participant.name,
      position: participant.position,
      finishTime: participant.finishTime,
      finished: participant.finished
    }));
    this.emitGameEvent('race_finished', {
      position: playerPosition,
      completed: true,
      collisions: this.raceCollisionCount,
      elapsedTime: this.elapsedTime,
      distanceMeters: this.raceDistanceMeters,
      laps: this.lapManager.totalLaps,
      participants
    });
    let reward = null;
    try {
      reward = this.onRaceCompleted({
        raceId: this.raceId,
        position: playerPosition,
        completed: true,
        trackId: this.simulationConfig.trackId,
        elapsedTime: this.elapsedTime,
        collisions: this.raceCollisionCount,
        distanceMeters: this.raceDistanceMeters,
        participants,
        championship: this.simulationConfig.championship
      });
    } catch (error) {
      console.error('Unable to process the race reward.', error);
    }

    const minutes = Math.floor(this.elapsedTime / 60);
    const seconds = Math.floor(this.elapsedTime % 60);

    const time =
      String(minutes).padStart(2, '0') + ':' +
      String(seconds).padStart(2, '0');

    const screen = document.createElement('div');
    screen.className = 'race-results';
    screen.id = 'raceResults';

    const finalRows = this.currentStandings.map((participant) => {
      const time = participant.finishTime === null
        ? ''
        : ` · ${String(Math.floor(participant.finishTime / 60))
          .padStart(2, '0')}:${String(Math.floor(participant.finishTime % 60))
          .padStart(2, '0')}`;
      const status = participant.finished
        ? `FINALIZADO${time}`
        : 'EN CARRERA';

      return `
        <li style="--participant-color: ${participant.color}">
          <strong>${participant.position}. ${participant.name}</strong>
          <span>${status}</span>
        </li>
      `;
    }).join('');
    const cup = reward?.championship;
    const nextCupTrack = cup?.status === 'in_progress'
      ? getTrackDefinition([
        'neon-city',
        'cyber-desert',
        'plasma-circuit'
      ][cup.roundIndex])
      : null;
    const cupSummary = cup
      ? `<section class="cup-race-summary">
          <strong>NEON CUP · CARRERA ${cup.roundIndex}/3</strong>
          <p>${cup.status === 'completed'
            ? `Campeonato finalizado · campeón: ${
              cup.standings.find(({ id }) =>
                cup.championIds.includes(id)
              )?.name ?? 'Empate'
            }`
            : `Siguiente circuito: ${nextCupTrack?.name ?? '—'}`}
          </p>
          <p>Puntos acumulados: ${cup.standings
            .map(({ name, points }) => `${name} ${points}`)
            .join(' · ')}</p>
          ${cup.status === 'completed'
            ? `<p>${cup.rewardClaimed
              ? `Premio de temporada: +${cup.reward} NC`
              : 'Recompensa de temporada pendiente de guardar'}</p>`
            : ''}
        </section>`
      : '';

    screen.innerHTML = `
      <div class="race-results-panel">
        <h1>🏁 ¡CARRERA TERMINADA!</h1>
        <p>Has completado las ${this.lapManager.totalLaps} vueltas.</p>
        <h2>TIEMPO FINAL: ${time}</h2>
        ${reward?.ok
    ? `<h2 class="race-reward">+${reward.reward} NEON COINS (NC)</h2>`
    : reward?.error
      ? `<p class="race-reward-error">${reward.error}</p>`
      : ''}
        ${cupSummary}
        <h3>CLASIFICACIÓN FINAL</h3>
        <ol class="race-results-standings">${finalRows}</ol>

        ${cup
          ? '<button id="exitRace">← VOLVER A NEON CUP</button>'
          : '<button id="playAgain">↻ VOLVER A CORRER</button>'}
        ${cup ? '' : '<button id="exitRace">← MENÚ PRINCIPAL</button>'}
      </div>
    `;

    document.getElementById('ui-container').appendChild(screen);
  }

  reset() {
    this.cancelBackendStep();
    this.raceFinished = false;
    this.raceId = globalThis.crypto?.randomUUID?.() ??
      `race-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.gameEventSequence = 0;
    this.raceCollisionCount = 0;
    this.raceDistanceMeters = 0;
    this.telemetryAccumulators = { nitro: 0, speed: 0, onTrack: 0 };
    this.reportedSpeedMilestones.clear();
    this.overtakenRivals.clear();
    this.previousStandingsProgress.clear();
    this.obstacleVisits.clear();
    this.sectorStartedAt = 0;
    this.lapStartedAt = 0;

    const results = document.getElementById('raceResults');

    if (results) {
      results.remove();
    }

    this.car.position.copy(getTrackPoint(0, this.simulationConfig.trackId));
    this.progressionDistancePosition.copy(this.car.position);
    const startTangent = getTrackTangent(0, this.simulationConfig.trackId);
    this.car.rotation.set(
      Math.atan2(
        startTangent.y,
        Math.hypot(startTangent.x, startTangent.z)
      ),
      Math.atan2(-startTangent.x, -startTangent.z),
      getTrackSurface(0, 0, this.simulationConfig.trackId).bank
    );
    this.backendCollisionPairs = [];
    this.backendPositionTarget = null;
    this.backendTransitionRemaining = 0;
    this.backendImpactCooldowns.clear();
    this.backendLatestMetrics = null;
    this.setSimulationLabel();

    this.lapManager.reset();
    this.raceStandings.reset();
    this.rampSystem.reset(this.car);
    this.currentStandings = [];
    this.standingsUpdateTimer = 0;

    // Sprint 4.2 — Reiniciar los tres rivales.
    if (this.rivals) {
      this.rivals.reset();
    }
    this.obstacleSystem.reset();
    this.vehicleCollisionSystem.reset();
    this.previousCarPosition.copy(this.car.position);
    this.previousTrackProgress = getTrackProgress(
    this.car.position,
    this.simulationConfig.trackId
    );

    this.wrongWayDetector.reset(this.car);
    this.announcements.hide();
    this.warningVisible = false;

    const lapElement = document.getElementById('lapValue');

    if (lapElement) {
      lapElement.textContent = `1/${this.lapManager.totalLaps}`;
    }

    this.speed = 0;
    this.nitro = 100;
    this.nitroActive = false;
    this.elapsedTime = 0;
    this.keys = {};
    this.updateStandings();

    this.camera.position.set(0, 5, 20);
    this.camera.lookAt(this.car.position);

    // Repetir la presentación al reiniciar.
    this.startRaceIntro();
  }

  destroy() {
    this.audioManager?.stopEngine();
    if (this.raceStarted && !this.raceFinished) {
      this.emitGameEvent('race_abandoned', {
        elapsedTime: this.elapsedTime,
        distanceMeters: this.raceDistanceMeters
      });
    }
    this.running = false;
    this.cancelBackendStep();

    if (this.rivals) {
      this.rivals.destroy();
    }
    if (this.announcements) {
      this.announcements.destroy();
    }
    if (this.miniMap) {
      this.miniMap.destroy();
    }
    if (this.standingsPanel) {
      this.standingsPanel.destroy();
    }

    if (this.raceIntro) {
      this.raceIntro.destroy();
    }
    if (this.effects) {
      this.effects.destroy();
    }
    if (this.obstacleSystem) {
      this.obstacleSystem.destroy();
    }

    cancelAnimationFrame(this.animationId);
    this.clock?.dispose?.();

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);

    this.scene.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose();
      }

      if (object.material) {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];

        materials.forEach((material) => material.dispose());
      }
    });

    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
