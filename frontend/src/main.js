import { Race } from './game/Race.js';
import { BackendClient } from './game/BackendClient.js';
import { mountParallelLab } from './game/ParallelLab.js';
import { screens } from './components/screens.js';
import { createCar, updateCarVisuals } from './game/Car.js';
import { VEHICLES, getVehicle } from './game/VehicleCatalog.js';
import { TRACKS, getTrackDefinition } from './game/TrackCatalog.js';
import { getTrackBounds, getTrackPoint } from './game/Track.js';
import {
  applyUpgrades,
  getUpgradePreview,
  UPGRADE_CATEGORIES
} from './game/UpgradePreview.js';
import { GarageView } from './game/GarageView.js';
import {
  loadPlayerProfile,
  savePlayerProfile,
  validatePlayerProfile
} from './storage/PlayerProfile.js';
import { applyRendererQuality, getQualityProfile } from './game/QualityProfiles.js';
import { AudioManager } from './game/AudioManager.js';
import {
  getStoreItem,
  getItemEquipmentKey,
  NEON_COINS_REWARDS,
  STORE_CATEGORIES,
  STORE_ITEMS
} from './game/Economy.js';
import {
  equipWalletItem,
  getWalletCustomization,
  isVehicleOwned,
  loadNeonWallet,
  processRaceReward,
  purchaseWalletItem,
  saveNeonWallet
} from './storage/NeonWallet.js';
import {
  CHAMPIONSHIP_TRACKS,
  CHALLENGES,
  DAILY_MISSION_POOL,
  ProgressionManager,
  getChallengeView,
  getDailyMissionView
} from './game/Progression.js';
import {
  PlayerProgressionManager,
  XP_REWARDS,
  levelForExperience
} from './storage/PlayerProgression.js';
import * as THREE from 'three';
import './style.css';

// ===================================
// 1. INTERFAZ PRINCIPAL
// ===================================

document.querySelector('#app').innerHTML = `
  <div id="scene-container"></div>
  <div id="race-container"></div>
  <div id="ui-container"></div>
`;

let playerProfile = loadPlayerProfile();
let playerWallet = loadNeonWallet();
let garageView = null;
let progression = null;
let playerProgression = null;
const audioManager = new AudioManager();

// ===================================
// 2. ESCENA THREE.JS
// ===================================

const container = document.getElementById('scene-container');
const backendPollState = {
  id: null,
  delay: 3000,
  attempts: 0
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

camera.position.set(7, 5, 11);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
  antialias: true
});

renderer.setSize(
  container.clientWidth || window.innerWidth,
  container.clientHeight || window.innerHeight,
  false
);
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';
applyRendererQuality(renderer, playerProfile.quality);

container.appendChild(renderer.domElement);

// ===================================
// 3. ILUMINACIÓN
// ===================================

scene.add(new THREE.AmbientLight(0xffffff, 1.5));

const blueLight = new THREE.PointLight(0x00eaff, 80);
blueLight.position.set(5, 5, 5);
scene.add(blueLight);

const purpleLight = new THREE.PointLight(0x9900ff, 80);
purpleLight.position.set(-5, 5, -5);
scene.add(purpleLight);
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(-3, 8, 6);
keyLight.castShadow = getQualityProfile(playerProfile.quality).shadows;
scene.add(keyLight);

// ===================================
// 4. PLATAFORMA
// ===================================

const platformGeometry = new THREE.CylinderGeometry(
  4,
  4,
  0.3,
  64
);

const platformMaterial = new THREE.MeshStandardMaterial({
  color: 0x111122,
  metalness: 0.8,
  roughness: 0.2
});

const platform = new THREE.Mesh(
  platformGeometry,
  platformMaterial
);

platform.position.y = -0.5;
platform.receiveShadow = true;
scene.add(platform);

// ===================================
// 5. AUTOMÓVIL PROVISIONAL
// ===================================

let car = createCar(playerProfile.vehicleId, {
  customization: playerProfile.customization
});
car.scale.setScalar(0.82);
scene.add(car);

// ===================================
// 6. ANIMACIÓN
// ===================================

function animate() {
  requestAnimationFrame(animate);

  car.rotation.y += 0.005;
  updateCarVisuals(car, { delta: 1 / 60, speed: 0.13 });

  if (!activeRace && currentScreen === 'welcome') {
    renderer.render(scene, camera);
  }
}


// ===================================
// 7. BOTONES
// ===================================







// ===================================
// 8. AJUSTAR TAMAÑO DE PANTALLA
// ===================================

const handleResize = () => {
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
};

window.addEventListener('resize', handleResize);

function scheduleBackendHealthCheck() {
  if (backendPollState.id !== null) {
    window.clearTimeout(backendPollState.id);
  }

  backendPollState.id = window.setTimeout(async () => {
    backendPollState.id = null;
    if (backendSimulationActive) return;
    await checkBackendConnection();
    scheduleBackendHealthCheck();
  }, backendPollState.delay);
}

function disposeRuntime() {
  if (backendPollState.id !== null) {
    window.clearTimeout(backendPollState.id);
    backendPollState.id = null;
  }
  if (activeRace) {
    activeRace.destroy();
    activeRace = null;
  }
  window.removeEventListener('resize', handleResize);
}

window.addEventListener('beforeunload', disposeRuntime);

// ========================================
// NAVEGACIÓN Y CONTROL DE CARRERA
// ========================================

const uiContainer = document.getElementById('ui-container');
const sceneContainer = document.getElementById('scene-container');
const raceContainer = document.getElementById('race-container');
const backendClient = new BackendClient();

let currentScreen = 'welcome';
let previousScreen = 'welcome';
let activeRace = null;
let parallelLab = null;
let backendSimulationActive = false;
let backendStatus = 'disconnected';

progression = new ProgressionManager({
  storage: globalThis.localStorage,
  wallet: playerWallet,
  saveWallet: (wallet) => {
    if (!saveNeonWallet(wallet)) return false;
    playerWallet = wallet;
    return true;
  }
});
playerProgression = new PlayerProgressionManager({
  storage: globalThis.localStorage
});
playerWallet = progression.wallet;
reconcileProgressionExperience();

function disposeModel(model) {
  model.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    for (const material of materials) material.dispose();
  });
}

function refreshHeroVehicle() {
  scene.remove(car);
  disposeModel(car);
  car = createCar(playerProfile.vehicleId, {
    customization: playerProfile.customization
  });
  car.scale.setScalar(0.82);
  scene.add(car);
}

function updatePlayerProfile(changes) {
  playerProfile = validatePlayerProfile({
    ...playerProfile,
    ...changes,
    customization: {
      ...playerProfile.customization,
      ...(changes.customization ?? {})
    }
  });
  savePlayerProfile(playerProfile);
  if (changes.vehicleId || changes.customization) refreshHeroVehicle();
}

function migrateLegacyGarageOwnership() {
  const legacyValues = {
    vehicleId: playerProfile.vehicleId,
    bodyColor: playerProfile.customization.bodyColor,
    neonColor: playerProfile.customization.neonColor,
    wheelStyle: playerProfile.customization.wheelStyle,
    spoiler: playerProfile.customization.spoiler,
    livery: playerProfile.customization.livery
  };
  let changed = false;
  for (const [field, value] of Object.entries(legacyValues)) {
    const item = STORE_ITEMS.find((candidate) =>
      candidate.effect.field === field &&
      candidate.effect.value === value
    );
    if (item && !playerWallet.inventory.includes(item.id)) {
      playerWallet.inventory.push(item.id);
      const key = getItemEquipmentKey(item);
      if (key) playerWallet.equipment[key] = item.id;
      changed = true;
    }
  }
  if (changed) saveNeonWallet(playerWallet);
}

function renderWallet() {
  const balance = document.getElementById('walletBalance');
  const earned = document.getElementById('walletEarned');
  const spent = document.getElementById('walletSpent');
  const history = document.getElementById('walletHistory');
  if (balance) balance.textContent = `${playerWallet.balance} NC`;
  if (earned) earned.textContent = `${playerWallet.totalEarned} NC`;
  if (spent) spent.textContent = `${playerWallet.totalSpent} NC`;
  const rules = document.getElementById('walletRewardRules');
  if (rules) {
    const positions = Object.entries(NEON_COINS_REWARDS.positions)
      .map(([place, amount]) => `${place}.º: ${amount} NC`)
      .join(' · ');
    rules.textContent =
      `Recompensas por posición: ${positions} · ` +
      `Carrera completada: +${NEON_COINS_REWARDS.completionBonus} NC.`;
  }
  if (!history) return;
  history.innerHTML = [...playerWallet.history].reverse().map((entry) => `
    <li class="${entry.amount < 0 ? 'is-expense' : 'is-income'}">
      <span>${entry.description}</span>
      <strong>${entry.amount > 0 ? '+' : ''}${entry.amount} NC</strong>
      <time>${entry.timestamp
        ? new Date(entry.timestamp).toLocaleString()
        : '—'}</time>
    </li>
  `).join('') || '<li>Sin movimientos todavía.</li>';
}

function formatRemaining(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function renderChallenges() {
  progression.wallet = playerWallet;
  progression.claimPendingRewards();
  playerWallet = progression.wallet;

  const dailyContainer = document.getElementById('dailyMissionContent');
  const challengeContainer = document.getElementById('challengeContent');
  if (!dailyContainer || !challengeContainer) return;

  const dailyMissions = getDailyMissionView(
    progression.state,
    Date.now()
  );
  dailyContainer.innerHTML = `
    <section class="progression-section">
      <div class="progression-heading">
        <div>
          <h2>MISIONES DIARIAS</h2>
          <p>Reinicio UTC · siguiente rotación en ${
            formatRemaining(dailyMissions[0]?.remainingSeconds ?? 0)
          }</p>
        </div>
      </div>
      <div class="progression-grid daily-grid">
        ${dailyMissions.map((mission) => {
    const percent = Math.min(100, mission.progress / mission.target * 100);
    const state = mission.claimed
      ? 'RECOMPENSA RECIBIDA'
      : mission.complete
        ? 'COMPLETADA'
        : 'EN PROGRESO';
    return `
      <article class="progression-card ${mission.complete ? 'is-complete' : ''}">
        <div class="progression-card-top">
          <span class="progression-tag">DIARIA</span>
          <span class="progression-state">${state}</span>
        </div>
        <h3>${mission.name}</h3>
        <p>${mission.description}</p>
        <div class="progression-progress" role="progressbar"
          aria-valuenow="${mission.progress}" aria-valuemin="0"
          aria-valuemax="${mission.target}">
          <span style="width:${percent}%"></span>
        </div>
        <div class="progression-card-bottom">
          <span>${mission.progress}/${mission.target}</span>
          <strong>+${mission.reward} NC</strong>
        </div>
      </article>
    `;
  }).join('')}
      </div>
    </section>
  `;

  const challenges = getChallengeView(progression.state);
  const categories = [...new Set(challenges.map(({ category }) => category))];
  challengeContainer.innerHTML = categories.map((category) => `
    <section class="progression-section">
      <div class="progression-heading">
        <h2>${category.toUpperCase()}</h2>
      </div>
      <div class="progression-grid">
        ${challenges.filter((challenge) => challenge.category === category)
    .map((challenge) => {
      const percent = Math.min(
        100,
        challenge.progress / challenge.goal.target * 100
      );
      const unlockNames = challenge.unlocks
        .map((id) => getStoreItem(id)?.name)
        .filter(Boolean);
      const status = challenge.claimed
        ? 'RECOMPENSA RECIBIDA'
        : challenge.complete
          ? 'COMPLETADO'
          : 'PENDIENTE';
      return `
        <article class="progression-card ${challenge.complete ? 'is-complete' : ''}">
          <div class="progression-card-top">
            <span class="progression-tag">${challenge.category.toUpperCase()}</span>
            <span class="progression-state">${status}</span>
          </div>
          <h3>${challenge.name}</h3>
          <p>${challenge.description}</p>
          <div class="progression-progress" role="progressbar"
            aria-valuenow="${challenge.progress}" aria-valuemin="0"
            aria-valuemax="${challenge.goal.target}">
            <span style="width:${percent}%"></span>
          </div>
          <div class="progression-card-bottom">
            <span>${challenge.progress}/${challenge.goal.target}</span>
            <strong>+${challenge.reward} NC</strong>
          </div>
          ${unlockNames.length
            ? `<small>Desbloquea: ${unlockNames.join(', ')}</small>`
            : ''}
        </article>
      `;
    }).join('')}
      </div>
    </section>
  `).join('');
}

function renderChampionship() {
  progression.wallet = playerWallet;
  progression.claimPendingRewards();
  playerWallet = progression.wallet;
  const container = document.getElementById('championshipContent');
  if (!container) return;
  const cup = progression.state.championship;
  const round = Math.min(cup.roundIndex + 1, CHAMPIONSHIP_TRACKS.length);
  const title = cup.status === 'not_started'
    ? 'Temporada lista'
    : cup.status === 'completed'
      ? 'Temporada completada'
      : `Carrera ${round} de ${CHAMPIONSHIP_TRACKS.length}`;
  const championNames = cup.championIds
    .map((id) => cup.standings.find((entry) => entry.id === id)?.name)
    .filter(Boolean);
  const cupUnlockNames = cup.unlocks
    .map((id) => getStoreItem(id)?.name)
    .filter(Boolean);
  const standingsRows = cup.standings.length
    ? cup.standings.map((entry) => `
      <tr>
        <td>${entry.position}.</td>
        <td>${escapeHtml(entry.name)}</td>
        <td>${entry.points}</td>
        <td>${entry.wins}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4">La clasificación se genera con resultados de carrera.</td></tr>';
  const raceRows = cup.races.map((race, index) => {
    const player = race.participants.find(({ id }) => id === 'player');
    const place = player?.position
      ? `${player.position}.º`
      : 'ABANDONO · 0 pts';
    return `
      <li>
        <span>${index + 1}. ${escapeHtml(
      getTrackDefinition(race.trackId).name
    )}</span>
        <strong>${place}</strong>
      </li>
    `;
  }).join('');
  const actionLabel = cup.status === 'in_progress'
    ? `▶ CONTINUAR · ${getTrackDefinition(
      CHAMPIONSHIP_TRACKS[cup.roundIndex]
    ).name}`
    : cup.status === 'completed'
      ? '↻ NUEVA TEMPORADA'
      : '▶ COMENZAR NEON CUP';
  const previousSeasons = progression.state.championshipHistory
    .slice()
    .reverse()
    .map((season, index) => {
      const champions = season.championIds
        .map((id) => season.standings.find((entry) => entry.id === id)?.name)
        .filter(Boolean)
        .map(escapeHtml)
        .join(' / ') || 'Sin campeón';
      return `<li>Temporada ${progression.state.championshipHistory.length - index}
        · ${champions} · posición del jugador: ${
        season.playerPosition ?? '—'
      }</li>`;
    }).join('');
  container.innerHTML = `
    <section class="cup-overview game-panel">
      <div class="progression-heading">
        <div>
          <span class="progression-tag">CAMPEONATO OFICIAL</span>
          <h2>${title}</h2>
          <p>NEON CITY → CYBER DESERT → PLASMA CIRCUIT</p>
        </div>
        <button class="primary" id="championshipAction">${actionLabel}</button>
      </div>
      <p class="note">Puntuación: 1.º 15 · 2.º 12 · 3.º 10 · 4.º 8 · 5.º o posterior 0. Un abandono (DNF) cuenta como carrera disputada y otorga 0 puntos.</p>
      ${cup.status === 'completed'
        ? `<p class="cup-champion">CAMPEÓN: ${
          escapeHtml(championNames.join(' / ') || 'Sin clasificación')
        }${cup.reward ? ` · Recompensa: ${cup.reward} NC` : ''}</p>`
        : ''}
      ${cup.status === 'completed' && cupUnlockNames.length
        ? `<p>Desbloqueos: ${cupUnlockNames.map(escapeHtml).join(', ')}</p>`
        : ''}
      <h3>CLASIFICACIÓN GENERAL</h3>
      <div class="cup-table-wrap">
        <table class="cup-table">
          <thead><tr><th>#</th><th>Piloto</th><th>Puntos</th><th>Victorias</th></tr></thead>
          <tbody>${standingsRows}</tbody>
        </table>
      </div>
      <h3>RESULTADOS REGISTRADOS</h3>
      <ol class="cup-race-list">${raceRows || '<li>Aún no hay carreras disputadas.</li>'}</ol>
      ${previousSeasons
        ? `<h3>TEMPORADAS ANTERIORES</h3><ol class="cup-race-list">${previousSeasons}</ol>`
        : ''}
    </section>
  `;
}

function renderPlayerProgression() {
  const container = document.getElementById('playerProgressionContent');
  if (!container) return;
  const profile = playerProgression.profile;
  const { stats } = profile;
  const level = levelForExperience(profile.xp);
  const favoriteVehicleId = playerProgression.favoriteVehicleId;
  const favoriteVehicle = favoriteVehicleId
    ? getVehicle(favoriteVehicleId).name
    : 'Aún sin datos';
  const statCards = [
    ['Carreras disputadas', stats.races],
    ['Carreras finalizadas', stats.finishedRaces],
    ['Victorias', stats.wins],
    ['Podios', stats.podiums],
    ['Vueltas válidas', stats.laps],
    ['Colisiones', stats.collisions],
    ['Adelantamientos', stats.overtakes],
    ['Saltos aterrizados', stats.jumps],
    ['Obstáculos evitados', stats.obstaclesAvoided],
    ['Tiempo con nitro', `${Math.floor(stats.nitroSeconds)} s`],
    ['Distancia recorrida', `${(stats.distanceMeters / 1000).toFixed(1)} km`],
    ['Tiempo de carrera', `${Math.floor(stats.timePlayedSeconds / 60)} min`],
    ['Saldo Neon Coins', `${playerWallet.balance} NC`],
    ['NC ganadas', `${playerWallet.totalEarned} NC`],
    ['NC gastadas', `${playerWallet.totalSpent} NC`]
  ];
  const records = TRACKS.map(({ id, name }) => {
    const record = profile.records[id];
    return `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td>${record?.bestLap ? `${record.bestLap.toFixed(2)} s` : '—'}</td>
        <td>${record?.bestRace ? `${record.bestRace.toFixed(2)} s` : '—'}</td>
        <td>${record?.bestPosition ? `${record.bestPosition}.º` : '—'}</td>
        <td>${record?.topSpeedKmh ? `${record.topSpeedKmh} km/h` : '—'}</td>
      </tr>
    `;
  }).join('');
  const descriptions = {
    race_started: 'Carrera iniciada',
    race_finished: 'Carrera finalizada',
    race_abandoned: 'Carrera abandonada',
    lap_completed: 'Vuelta válida',
    collision: 'Colisión',
    overtake: 'Adelantamiento',
    jump_landed: 'Salto aterrizado',
    obstacle_avoided: 'Obstáculo evitado',
    xp: 'Experiencia obtenida'
  };
  const history = profile.history.slice().reverse()
    .filter(({ type }) => Object.hasOwn(descriptions, type))
    .slice(0, 8)
    .map((entry) => `
      <li>
        <span>${descriptions[entry.type]}${
          entry.trackId
            ? ` · ${escapeHtml(getTrackDefinition(entry.trackId).name)}`
            : ''
        }</span>
        <strong>${
          entry.type === 'xp'
            ? `+${entry.amount} XP`
            : entry.elapsedTime
              ? `${entry.elapsedTime.toFixed(2)} s`
              : entry.position
                ? `${entry.position}.º`
                : new Date(entry.timestamp).toLocaleDateString('es-ES')
        }</strong>
      </li>
    `).join('');

  container.innerHTML = `
    <section class="player-level-panel">
      <div class="player-profile-heading">
        <div>
          <span class="progression-tag">NIVEL ${level.level}</span>
          <h2>${escapeHtml(profile.alias)}</h2>
          <p>Vehículo más utilizado: ${escapeHtml(favoriteVehicle)}</p>
        </div>
        <form id="playerAliasForm" class="player-alias-form">
          <label for="playerAlias">Alias del piloto</label>
          <div>
            <input id="playerAlias" name="alias" maxlength="24"
              value="${escapeHtml(profile.alias)}" autocomplete="nickname">
            <button type="submit" class="secondary">GUARDAR</button>
          </div>
          <p id="playerAliasMessage" aria-live="polite"></p>
        </form>
      </div>
      <div class="player-xp-summary">
        <div class="progression-progress" role="progressbar"
          aria-label="Experiencia del nivel"
          aria-valuenow="${level.currentXp}" aria-valuemin="0"
          aria-valuemax="${level.requiredXp}">
          <span style="width:${level.progress}%"></span>
        </div>
        <div><strong>${level.currentXp} / ${level.requiredXp} XP</strong>
          <span>${profile.xp} XP totales</span></div>
      </div>
    </section>
    <section class="player-stat-grid">
      ${statCards.map(([label, value]) => `
        <article class="player-stat-card">
          <span>${label}</span><strong>${value}</strong>
        </article>
      `).join('')}
    </section>
    <section class="player-data-panel">
      <h2>RÉCORDS POR CIRCUITO</h2>
      <div class="cup-table-wrap">
        <table class="cup-table player-record-table">
          <thead><tr><th>Circuito</th><th>Mejor vuelta</th>
            <th>Mejor carrera</th><th>Mejor posición</th>
            <th>Velocidad punta</th></tr></thead>
          <tbody>${records}</tbody>
        </table>
      </div>
    </section>
    <section class="player-data-panel">
      <h2>ACTIVIDAD RECIENTE</h2>
      <ol class="player-history-list">${
        history || '<li>Aún no hay eventos registrados.</li>'
      }</ol>
    </section>
    <p class="note">El progreso se guarda localmente en este navegador y puede
      modificarse desde el cliente; no es una cuenta ni una protección contra
      manipulación.</p>
  `;
}

function getStoreStatus(item) {
  const owned = playerWallet.inventory.includes(item.id);
  if (item.effect.category) {
    const currentLevel = playerWallet.upgrades[item.effect.category] ?? 0;
    if (owned || item.effect.level <= currentLevel) return 'installed';
    return item.effect.level === currentLevel + 1 ? 'available' : 'locked';
  }
  if (!owned) return 'available';
  const key = getItemEquipmentKey(item);
  return key && playerWallet.equipment[key] === item.id
    ? 'equipped'
    : 'owned';
}

function previewStoreItem(item) {
  if (!garageView) return;
  const current = getWalletCustomization(playerWallet);
  if (item.category === 'vehicles') {
    garageView.selectVehicle(item.effect.value, false);
  } else if (item.effect.field) {
    const field = item.effect.field;
    if (field === 'vehicleId') {
      garageView.selectVehicle(item.effect.value, false);
    } else {
      const profileField = field;
      garageView.updateCustomization({
        ...current.customization,
        [profileField]: item.effect.value
      });
    }
  }
  const detail = document.getElementById('storePreviewDetail');
  if (detail) {
    let stats = '';
    if (item.effect.category) {
      const base = getVehicle(current.vehicleId);
      const preview = getUpgradePreview(
        base,
        item.effect.category,
        item.effect.level
      );
      stats = Object.keys(preview)
        .filter((key) => preview[key] !== base[key])
        .map((key) => `${key}: ${Math.round((preview[key] ?? 0) * 100)}`)
        .join(' · ');
    }
    detail.textContent = `${item.name}: ${item.description}` +
      (stats ? ` Vista de estadísticas: ${stats}.` : '');
  }
}

function renderStore() {
  const categorySelect = document.getElementById('storeCategory');
  const grid = document.getElementById('storeGrid');
  if (!categorySelect || !grid) return;
  if (!categorySelect.options.length) {
    categorySelect.innerHTML = STORE_CATEGORIES.map(({ id, label }) =>
      `<option value="${id}">${label}</option>`
    ).join('');
  }
  const category = categorySelect.value || 'all';
  const items = STORE_ITEMS.filter((item) =>
    category === 'all' || item.category === category
  );
  grid.innerHTML = items.map((item) => {
    const state = getStoreStatus(item);
    const owned = state === 'owned' || state === 'equipped' ||
      state === 'installed';
    const action = owned ? 'equip' : 'buy';
    const disabled = state === 'installed' || state === 'equipped' ||
      (state === 'locked' && !owned) ||
      (!owned && playerWallet.balance < item.price);
    const statusText = {
      available: 'Disponible',
      locked: 'Desbloquea el nivel anterior',
      owned: 'En inventario',
      equipped: 'Equipado',
      installed: 'Instalada'
    }[state];
    const actionText = state === 'equipped' || state === 'installed'
      ? statusText
      : state === 'locked'
        ? 'Bloqueado'
        : state === 'owned'
          ? 'Equipar'
          : playerWallet.balance < item.price
            ? 'Saldo insuficiente'
            : `Comprar · ${item.price} NC`;
    const colorPreview = /^#[\da-f]{6}$/i.test(item.preview.color ?? '')
      ? item.preview.color
      : '#00eaff';
    return `
      <article class="store-item" data-shop-item="${item.id}">
        <div class="store-item-preview ${item.preview.kind}"
             style="--preview-color:${colorPreview}">
          <span>${item.category === 'vehicles' ? '🏎️'
      : item.category === 'upgrades' ? '⚙'
        : item.category === 'wheels' ? '◉'
          : item.category === 'spoilers' ? '▰'
            : item.category === 'liveries' ? '✦'
              : '◆'}</span>
        </div>
        <h3>${item.name}</h3>
        <p>${item.description}</p>
        <span class="store-item-status">${statusText}</span>
        <button data-shop-action="${action}"
                data-shop-item-id="${item.id}"
                ${disabled ? 'disabled' : ''}>${actionText}</button>
      </article>
    `;
  }).join('');
  renderWallet();
}

function syncProfileFromStoreItem(item) {
  if (item.effect.field === 'vehicleId') {
    updatePlayerProfile({ vehicleId: item.effect.value });
  } else if (item.effect.field) {
    updatePlayerProfile({
      customization: { [item.effect.field]: item.effect.value }
    });
  }
}

function handleStoreAction(action, itemId) {
  const item = STORE_ITEMS.find((candidate) => candidate.id === itemId);
  if (!item) return;
  const result = action === 'buy'
    ? purchaseWalletItem(playerWallet, itemId)
    : equipWalletItem(playerWallet, itemId);
  const status = document.getElementById('storeMessage');
  if (!result.ok) {
    if (status) status.textContent = result.error;
    return;
  }
  if (!saveNeonWallet(result.wallet)) {
    if (status) status.textContent =
      'No se pudo guardar la transacción; no se aplicó el cambio.';
    return;
  }
  playerWallet = result.wallet;
  syncProfileFromStoreItem(item);
  if (status) status.textContent = action === 'buy'
    ? `Compra confirmada: ${item.name}.`
    : `${item.name} equipado.`;
  renderStore();
}

function getOwnedVehicleIds() {
  return VEHICLES
    .filter(({ id }) => isVehicleOwned(playerWallet, id))
    .map(({ id }) => id);
}

function fillVehicleSelect(select, selectedId) {
  if (!select) return;
  const ownedIds = new Set(getOwnedVehicleIds());
  const vehicles = VEHICLES.filter(({ id }) => ownedIds.has(id));
  select.innerHTML = vehicles.map(({ id, name }) =>
    `<option value="${id}">${name}</option>`
  ).join('');
  select.value = ownedIds.has(selectedId)
    ? selectedId
    : getWalletCustomization(playerWallet).vehicleId;
}

function fillCosmeticSelect(selectId, category, selectedValue) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const owned = STORE_ITEMS.filter((item) =>
    item.category === category &&
    playerWallet.inventory.includes(item.id)
  );
  const hasSelection = owned.some((item) =>
    item.effect.value === selectedValue
  );
  const legacyOption = hasSelection || selectedValue === undefined
    ? ''
    : `<option value="${selectedValue}">Personalización anterior</option>`;
  select.innerHTML = legacyOption + owned.map((item) =>
    `<option value="${item.effect.value}">${item.name}</option>`
  ).join('');
  select.value = hasSelection || legacyOption
    ? selectedValue
    : owned[0]?.effect.value ?? '';
}

function createTrackPreview(trackId) {
  const bounds = getTrackBounds(trackId);
  const margin = 4;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxZ - bounds.minZ;
  const points = Array.from({ length: 181 }, (_, index) =>
    getTrackPoint(index / 180, trackId)
  );
  const coordinates = points.map((point) => [
    margin + (point.x - bounds.minX) / width * (160 - margin * 2),
    margin + (point.z - bounds.minZ) / height * (112 - margin * 2)
  ]);
  const path = coordinates.map(([x, y], index) =>
    `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  ).join(' ') + ' Z';
  const track = getTrackDefinition(trackId);
  return `<svg viewBox="0 0 160 120" role="img" aria-label="${track.name} track">
    <path d="${path}" fill="none" stroke="#15152a" stroke-width="14" stroke-linejoin="round"/>
    <path d="${path}" fill="none" stroke="${track.accent}" stroke-width="2.4" stroke-linejoin="round"/>
    <circle cx="${coordinates[0][0]}" cy="${coordinates[0][1]}" r="3" fill="#fff"/>
  </svg>`;
}

function renderTrackPreviews(root = uiContainer) {
  for (const track of TRACKS) {
    const preview = root.querySelector(`[data-track-preview="${track.id}"]`);
    if (preview) preview.innerHTML = createTrackPreview(track.id);
  }
}

function updateRaceTrackSummary() {
  const trackId = document.getElementById('raceTrack')?.value;
  const summary = document.getElementById('raceTrackSummary');
  if (!summary || !trackId) return;
  const track = getTrackDefinition(trackId);
  summary.innerHTML = `${createTrackPreview(trackId)}
    <strong>${track.name} · ${track.difficulty}</strong>
    <span>${track.description}</span>`;
  updateRaceConfigurationSummary();
}

function updateRaceConfigurationSummary() {
  const target = document.getElementById('raceConfigurationSummary');
  if (!target) return;
  const vehicle = getVehicle(
    document.getElementById('raceVehicle')?.value ??
      playerProfile.vehicleId
  );
  const track = getTrackDefinition(
    document.getElementById('raceTrack')?.value ??
      playerProfile.selectedTrack
  );
  const difficulty = document.getElementById('raceDifficulty');
  const rivals = document.getElementById('raceRivals');
  const laps = document.getElementById('raceLaps');
  target.textContent =
    `${vehicle.name} · ${track.name} · ` +
    `${difficulty?.selectedOptions[0]?.text ?? 'Normal'} · ` +
    `${rivals?.selectedOptions[0]?.text ?? '3 rivales'} · ` +
    `${laps?.selectedOptions[0]?.text ?? '3 vueltas'}`;
}

function updateGarageStats(vehicleId = playerProfile.vehicleId) {
  const target = document.getElementById('garageStats');
  if (!target) return;
  const vehicle = applyUpgrades(
    getVehicle(vehicleId),
    playerWallet.upgrades
  );
  const labels = [
    ['Velocidad máxima', vehicle.maxSpeed],
    ['Aceleración', vehicle.acceleration],
    ['Control', vehicle.handling],
    ['Estabilidad', vehicle.stability],
    ['Potencia de nitro', vehicle.nitro]
  ];
  target.innerHTML = labels.map(([label, value]) => `
    <div class="garage-stat">
      <span>${label}</span>
      <strong>${Math.round(value * 100)}</strong>
      <i><b style="width:${Math.min(100, value / 1.2 * 100)}%"></b></i>
    </div>
  `).join('');
  const upgrades = document.getElementById('garageUpgrades');
  if (upgrades) {
    upgrades.textContent = UPGRADE_CATEGORIES.map(({ id, label }) =>
      `${label}: nivel ${playerWallet.upgrades[id] ?? 0}`
    ).join(' · ');
  }
}

function setBackendStatus(status) {
  backendStatus = status;
  backendSimulationActive = status === 'simulating';

  document.querySelectorAll('.backend-connection').forEach((element) => {
    element.dataset.state = status;
    element.textContent = status === 'simulating'
      ? 'SIMULANDO'
      : status === 'connected'
        ? element.id === 'raceBackendStatus'
          ? 'BACKEND CONECTADO'
          : 'CONECTADO'
        : status === 'error'
          ? 'ERROR'
          : 'DESCONECTADO';
  });
}

async function checkBackendConnection() {
  if (backendSimulationActive) return;

  try {
    await backendClient.health();
    backendPollState.attempts = 0;
    backendPollState.delay = 3000;
    if (backendStatus === 'disconnected') {
      setBackendStatus('connected');
    }
  } catch {
    backendPollState.attempts += 1;
    backendPollState.delay = Math.min(
      30000,
      3000 * Math.pow(2, Math.min(backendPollState.attempts, 4))
    );
    setBackendStatus('disconnected');
  }
}

function showScreen(screenName) {
  if (!screens[screenName]) {
    console.error(`Pantalla desconocida: ${screenName}`);
    return;
  }

  if (screenName !== currentScreen && activeRace && screenName !== 'race') {
    activeRace.destroy();
    activeRace = null;
    raceContainer.style.display = 'none';
    sceneContainer.style.display = 'block';
  }

  if (screenName !== currentScreen) {
    previousScreen = currentScreen;
  }

  currentScreen = screenName;
  garageView?.destroy();
  garageView = null;
  parallelLab?.destroy();
  parallelLab = null;
  uiContainer.innerHTML = screens[screenName];

  if (screenName === 'laboratory') {
    parallelLab = mountParallelLab(uiContainer, {
      client: backendClient,
      setStatus: setBackendStatus
    });
  }

  if (screenName === 'quickRace') {
    const mode = uiContainer.querySelector('#raceSimulationMode');
    const threads = uiContainer.querySelector('#raceSimulationThreads');
    const processes = uiContainer.querySelector('#raceSimulationProcesses');
    const updateModeControls = () => {
      threads.disabled = mode.value !== 'openmp';
      processes.disabled = mode.value !== 'mpi';
    };
    mode.addEventListener('change', updateModeControls);
    updateModeControls();
    fillVehicleSelect(
      document.getElementById('raceVehicle'),
      playerProfile.vehicleId
    );
    document.getElementById('raceTrack').value = playerProfile.selectedTrack;
    updateRaceTrackSummary();
    document.getElementById('raceTrack')
      .addEventListener('change', updateRaceTrackSummary);
    for (const id of [
      'raceVehicle', 'raceDifficulty', 'raceRivals', 'raceLaps'
    ]) {
      document.getElementById(id).addEventListener(
        'change',
        updateRaceConfigurationSummary
      );
    }
  }

  if (screenName === 'garage') {
    fillVehicleSelect(
      document.getElementById('garageVehicle'),
      playerProfile.vehicleId
    );
    fillCosmeticSelect(
      'garageBodyColor', 'paint', playerProfile.customization.bodyColor
    );
    fillCosmeticSelect(
      'garageNeonColor', 'neon', playerProfile.customization.neonColor
    );
    fillCosmeticSelect(
      'garageWheelStyle', 'wheels', playerProfile.customization.wheelStyle
    );
    fillCosmeticSelect(
      'garageLivery', 'liveries', playerProfile.customization.livery
    );
    fillCosmeticSelect(
      'garageSpoiler', 'spoilers', playerProfile.customization.spoiler
    );
    updateGarageStats();
    garageView = new GarageView(
      document.getElementById('garagePreview'),
      playerProfile,
      {
        availableVehicleIds: getOwnedVehicleIds(),
        onProfileChange: (profile) => {
          updatePlayerProfile(profile);
          updateGarageStats(profile.vehicleId);
        }
      }
    );
  }

  if (screenName === 'economy') {
    renderStore();
    garageView = new GarageView(
      document.getElementById('storePreviewCanvas'),
      {
        ...playerProfile,
        ...getWalletCustomization(playerWallet)
      },
      { availableVehicleIds: VEHICLES.map(({ id }) => id) }
    );
  }

  if (screenName === 'tracks') {
    renderTrackPreviews();
  }

  if (screenName === 'challenges') {
    renderChallenges();
  }

  if (screenName === 'championship') {
    renderChampionship();
  }

  if (screenName === 'stats') {
    renderPlayerProgression();
  }

  if (screenName === 'settings') {
    const quality = document.getElementById('graphicsQuality');
    const master = document.getElementById('masterVolume');
    const music = document.getElementById('musicVolume');
    const effects = document.getElementById('effectsVolume');
    const mute = document.getElementById('muteAudio');

    quality.value = playerProfile.quality;
    master.value = audioManager.settings.master;
    music.value = audioManager.settings.music;
    effects.value = audioManager.settings.effects;
    mute.checked = audioManager.settings.muted;
    document.getElementById('graphicsQualityDescription').textContent =
      `${getQualityProfile(playerProfile.quality).label}: resolución, sombras, distancia de dibujado y decoración ajustadas.`;
  }
}

uiContainer.addEventListener('change', (event) => {
  const { id, value, checked } = event.target;
  if (id === 'storeCategory') {
    renderStore();
  } else if (id === 'raceVehicle') {
    updatePlayerProfile({ vehicleId: value });
  } else if (id === 'raceTrack') {
    updatePlayerProfile({ selectedTrack: value });
    updateRaceTrackSummary();
  } else if (id === 'garageVehicle') {
    updatePlayerProfile({ vehicleId: value });
    garageView?.selectVehicle(value, false);
    updateGarageStats(value);
  } else if (id === 'garageBodyColor' || id === 'garageNeonColor' ||
      id === 'garageWheelStyle' || id === 'garageLivery' ||
      id === 'garageSpoiler') {
    const customization = {
      ...playerProfile.customization,
      bodyColor: document.getElementById('garageBodyColor').value,
      neonColor: document.getElementById('garageNeonColor').value,
      wheelStyle: document.getElementById('garageWheelStyle').value,
      livery: document.getElementById('garageLivery').value,
      spoiler: document.getElementById('garageSpoiler').value
    };
    if (garageView) {
      garageView.updateCustomization(customization);
    } else {
      updatePlayerProfile({ customization });
    }
  } else if (id === 'graphicsQuality') {
    const profile = applyRendererQuality(renderer, value);
    updatePlayerProfile({ quality: value });
    keyLight.castShadow = profile.shadows;
    document.getElementById('graphicsQualityDescription').textContent =
      `${profile.label}: resolución, sombras, distancia de dibujado y decoración ajustadas.`;
  } else if (id === 'masterVolume' || id === 'musicVolume' || id === 'effectsVolume') {
    audioManager.applySettings({
      master: Number(document.getElementById('masterVolume')?.value ?? audioManager.settings.master),
      music: Number(document.getElementById('musicVolume')?.value ?? audioManager.settings.music),
      effects: Number(document.getElementById('effectsVolume')?.value ?? audioManager.settings.effects),
      muted: document.getElementById('muteAudio')?.checked ?? audioManager.settings.muted
    });
  } else if (id === 'muteAudio') {
    audioManager.applySettings({
      muted: checked,
      master: Number(document.getElementById('masterVolume')?.value ?? audioManager.settings.master),
      music: Number(document.getElementById('musicVolume')?.value ?? audioManager.settings.music),
      effects: Number(document.getElementById('effectsVolume')?.value ?? audioManager.settings.effects)
    });
  }
  if (id.startsWith('race')) updateRaceConfigurationSummary();
});

function grantMilestoneExperience(rewardId, kind, description) {
  const granted = playerProgression.recordMilestone(
    rewardId,
    kind,
    kind === 'challenge'
      ? XP_REWARDS.challengeCompleted
      : kind === 'championship'
        ? XP_REWARDS.championshipWon
        : XP_REWARDS.missionCompleted,
    description
  );
  if (!granted &&
      !playerProgression.profile.rewardIds.includes(rewardId)) {
    console.error(`Unable to persist player progression reward "${rewardId}".`);
  }
}

function awardNewObjectiveExperience(previousState) {
  for (const challenge of CHALLENGES) {
    if (!previousState.challengeClaimed[challenge.id] &&
        progression.state.challengeClaimed[challenge.id]) {
      grantMilestoneExperience(
        `challenge:${challenge.id}`,
        'challenge',
        `Desafío: ${challenge.name}`
      );
    }
  }
  for (const mission of previousState.dailyMissions) {
    const current = progression.state.dailyMissions.find(
      ({ id }) => id === mission.id
    );
    if (!mission.claimed && current?.claimed) {
      const definition = DAILY_MISSION_POOL.find(
        ({ id }) => id === mission.id
      );
      grantMilestoneExperience(
        `daily:${progression.state.dailyDate}:${mission.id}`,
        'mission',
        `Misión diaria: ${definition?.name ?? mission.id}`
      );
    }
  }
}

function awardChampionshipExperience(cup) {
  if (cup?.status === 'completed' && cup.championIds.includes('player')) {
    grantMilestoneExperience(
      `championship:${cup.id}:champion`,
      'championship',
      'Campeón de NEON CUP'
    );
  }
}

function reconcileProgressionExperience() {
  for (const challenge of CHALLENGES) {
    if (progression.state.challengeClaimed[challenge.id]) {
      grantMilestoneExperience(
        `challenge:${challenge.id}`,
        'challenge',
        `Desafío: ${challenge.name}`
      );
    }
  }
  for (const mission of progression.state.dailyMissions) {
    if (!mission.claimed) continue;
    const definition = DAILY_MISSION_POOL.find(
      ({ id }) => id === mission.id
    );
    grantMilestoneExperience(
      `daily:${progression.state.dailyDate}:${mission.id}`,
      'mission',
      `Misión diaria: ${definition?.name ?? mission.id}`
    );
  }
  awardChampionshipExperience(progression.state.championship);
}

function handleGameEvent(event) {
  audioManager.handleRaceEvent(event);
  progression.wallet = playerWallet;
  const previousState = progression.state;
  const recorded = progression.recordEvent(event);
  if (recorded.duplicate) return;
  if (!recorded.accepted && !recorded.duplicate) {
    console.error('Rejected invalid race progression event.', event);
    return;
  }
  playerWallet = progression.wallet;

  if (!playerProgression.recordEvent(event)) {
    console.error('Unable to persist player progression event.', event);
    return;
  }
  if (recorded.recordImproved) {
    const rewardId = `record:${event.raceId}:${event.data.lap}`;
    if (!playerProgression.grantExperience(
      rewardId,
      XP_REWARDS.recordImproved,
      'Nuevo récord de vuelta'
    ) && !playerProgression.profile.rewardIds.includes(rewardId)) {
      console.error(`Unable to persist player progression reward "${rewardId}".`);
    }
  }
  awardNewObjectiveExperience(previousState);

  if (event.type === 'race_abandoned' && event.championshipId) {
    const result = progression.recordCupRace({
      raceId: event.raceId,
      trackId: event.trackId,
      championshipId: event.championshipId,
      abandoned: true
    });
    if (!result.accepted && !result.duplicate) {
      console.error('Unable to record the abandoned championship race.');
    }
    playerWallet = progression.wallet;
    awardChampionshipExperience(result.championship);
  }
}

function startChampionshipRace() {
  if (activeRace) return;
  if (progression.state.championship.status !== 'in_progress') {
    progression.beginChampionship();
  }
  const cup = progression.state.championship;
  const trackId = CHAMPIONSHIP_TRACKS[cup.roundIndex];
  if (!cup.id || !trackId) {
    console.error('The Neon Cup has no valid next round.');
    return;
  }
  startRace({
    trackId,
    laps: 1,
    rivalCount: 3,
    mode: 'local',
    championship: { id: cup.id, roundIndex: cup.roundIndex }
  });
}

function startRace(overrides = {}) {
  if (activeRace) return;

  const trackId = overrides.trackId ??
    document.getElementById('raceTrack')?.value ?? 'neon-city';
  const vehicleId = document.getElementById('raceVehicle')?.value ??
    playerProfile.vehicleId;
  const difficulty = document.getElementById('raceDifficulty')?.value ??
    'normal';
  const rivalCount = Number(overrides.rivalCount ??
    document.getElementById('raceRivals')?.value ?? 3);
  const laps = Number(overrides.laps ??
    document.getElementById('raceLaps')?.value ?? 3);
  if (!TRACKS.some((track) => track.id === trackId) ||
      !VEHICLES.some((vehicle) => vehicle.id === vehicleId) ||
      !isVehicleOwned(playerWallet, vehicleId) ||
      !['easy', 'normal', 'hard', 'expert'].includes(difficulty) ||
      ![0, 1, 2, 3].includes(rivalCount) ||
      ![1, 3, 5].includes(laps)) {
    console.error('Invalid quick-race configuration.');
    return;
  }

  updatePlayerProfile({
    vehicleId,
    selectedTrack: trackId
  });
  const simulationConfig = {
    mode: overrides.mode ??
      document.getElementById('raceSimulationMode')?.value ?? 'local',
    threads: Number(
      document.getElementById('raceSimulationThreads')?.value ?? 4
    ),
    processes: Number(
      document.getElementById('raceSimulationProcesses')?.value ?? 3
    ),
    laps,
    trackId,
    vehicleId,
    difficulty,
    rivalCount,
    quality: playerProfile.quality,
    customization: playerProfile.customization,
    upgrades: playerWallet.upgrades,
    championship: overrides.championship ?? null
  };

  sceneContainer.style.display = 'none';
  raceContainer.style.display = 'block';

  showScreen('race');
  audioManager.unlock();

  activeRace = new Race(
    raceContainer,
    simulationConfig,
    setBackendStatus,
    (raceResult) => {
      let reward = processRaceReward(playerWallet, raceResult);
      if (reward.ok && !reward.duplicate) {
        if (saveNeonWallet(reward.wallet)) {
          playerWallet = reward.wallet;
        } else {
          reward = {
            ...reward,
            ok: false,
            error: 'No se pudo guardar la recompensa en este navegador.'
          };
        }
      }
      let championship = null;
      if (raceResult.championship) {
        progression.wallet = playerWallet;
        const recorded = progression.recordCupRace({
          raceId: raceResult.raceId,
          trackId: raceResult.trackId,
          championshipId: raceResult.championship.id,
          completed: true,
          elapsedTime: raceResult.elapsedTime,
          participants: raceResult.participants
        });
        if (!recorded.accepted && !recorded.duplicate) {
          console.error('Unable to record the completed championship race.');
        }
        championship = recorded.championship;
        playerWallet = progression.wallet;
        awardChampionshipExperience(championship);
      }
      return { ...reward, championship };
    },
    handleGameEvent,
    audioManager
  );
}

function exitRace() {
  const returnToChampionship = Boolean(
    activeRace?.simulationConfig.championship
  );
  if (activeRace) {
    activeRace.destroy();
    activeRace = null;
  }
  audioManager.stopEngine();
  audioManager.stopMusic();
  audioManager.startMusic('menu');

  raceContainer.style.display = 'none';
  sceneContainer.style.display = 'block';

  showScreen(returnToChampionship ? 'championship' : 'home');
}

uiContainer.addEventListener('submit', (event) => {
  if (event.target.id !== 'playerAliasForm') return;
  event.preventDefault();
  const alias = new FormData(event.target).get('alias');
  if (!playerProgression.setAlias(alias)) {
    console.error('Unable to save player alias.');
    document.getElementById('playerAliasMessage').textContent =
      'No se pudo guardar el alias.';
    return;
  }
  renderPlayerProgression();
  document.getElementById('playerAliasMessage').textContent =
    'Alias guardado.';
});

uiContainer.addEventListener('click', (event) => {
  audioManager.unlock();

  const storeAction = event.target.closest('[data-shop-action]');
  if (storeAction) {
    handleStoreAction(
      storeAction.dataset.shopAction,
      storeAction.dataset.shopItemId
    );
    return;
  }

  const storeItem = event.target.closest('[data-shop-item]');
  if (storeItem) {
    const item = STORE_ITEMS.find(({ id }) =>
      id === storeItem.dataset.shopItem
    );
    if (item) previewStoreItem(item);
    return;
  }

  const garageSelection = event.target.closest('[data-garage-vehicle]');
  if (garageSelection && garageView) {
    const vehicleId = garageSelection.dataset.garageVehicle;
    document.getElementById('garageVehicle').value = vehicleId;
    garageView.selectVehicle(vehicleId);
    updateGarageStats(vehicleId);
    return;
  }

  const trackSelection = event.target.closest('[data-start-track]');
  if (trackSelection) {
    updatePlayerProfile({ selectedTrack: trackSelection.dataset.startTrack });
    showScreen('quickRace');
    return;
  }

  const navigationButton = event.target.closest('[data-screen]');

  if (navigationButton) {
    showScreen(navigationButton.dataset.screen);
    return;
  }

  if (event.target.closest('[data-back]')) {
    showScreen(previousScreen);
    return;
  }

  if (event.target.closest('#startRace')) {
    audioManager.unlock();
    startRace();
    return;
  }

  if (event.target.closest('#championshipAction')) {
    audioManager.unlock();
    startChampionshipRace();
    return;
  }

  if (event.target.closest('#playAgain')) {
    if (activeRace) {
      activeRace.reset();
    }
    return;
  }

  if (event.target.closest('#resetRace')) {
    if (activeRace) {
      activeRace.reset();
    }
    return;
  }

  if (event.target.closest('#exitRace')) {
    exitRace();
  }
});

migrateLegacyGarageOwnership();
showScreen('welcome');
audioManager.startMusic('menu');
animate();
backendPollState.delay = 3000;
backendPollState.attempts = 0;
checkBackendConnection();
scheduleBackendHealthCheck();
