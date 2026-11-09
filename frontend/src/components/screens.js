// ========================================
// NEON RUSH - SISTEMA DE PANTALLAS
// ========================================
import { VEHICLES } from '../game/VehicleCatalog.js';
import { TRACKS } from '../game/TrackCatalog.js';

const vehicleOptions = VEHICLES.map(({ id, name }) =>
  `<option value="${id}">${name}</option>`
).join('');
const trackOptions = TRACKS.map(({ id, name }) =>
  `<option value="${id}">${name}</option>`
).join('');
const trackCards = TRACKS.map((track) => `
  <article class="game-card track-card" data-track-card="${track.id}">
    <div class="track-preview" data-track-preview="${track.id}"></div>
    <h2>${track.name}</h2>
    <p>${track.description}</p>
    <span>Dificultad: ${track.difficulty}</span>
    <button class="primary" data-start-track="${track.id}">
      PREPARAR CARRERA
    </button>
  </article>
`).join('');

export const screens = {
  welcome: `
    <div class="screen welcome-screen">
      <h1 class="logo">NEON RUSH</h1>
      <p class="subtitle">THE FUTURE OF RACING</p>

      <div class="menu">
        <button class="primary" data-screen="home">
          ▶ JUGAR
        </button>

        <button data-screen="settings">
          ⚙ CONFIGURACIÓN
        </button>

        <button data-screen="about">
          ⓘ ACERCA DEL JUEGO
        </button>
      </div>

      <p class="footer">NEON RUSH | VERSIÓN 0.1</p>
    </div>
  `,

  home: `
    <div class="screen home-screen">
      <h1 class="section-title">NEON RUSH</h1>
      <p class="section-subtitle">MENÚ PRINCIPAL</p>

      <div class="menu-grid">
        <button data-screen="quickRace">🏁 CARRERA RÁPIDA</button>
        <button data-screen="championship">🏆 CAMPEONATO</button>
        <button data-screen="garage">🚗 MI GARAJE</button>
        <button data-screen="economy">🪙 TIENDA Y MONEDERO</button>
        <button data-screen="tracks">🛣️ CIRCUITOS</button>
        <button data-screen="challenges">🎯 DESAFÍOS</button>
        <button data-screen="stats">📊 ESTADÍSTICAS</button>
        <button data-screen="laboratory">💻 LABORATORIO PARALELO</button>
        <button data-screen="settings">⚙ CONFIGURACIÓN</button>
      </div>

      <button class="back-btn" data-screen="welcome">
        ← SALIR AL INICIO
      </button>
    </div>
  `,

  quickRace: `
    <div class="screen content-screen">
      <h1 class="section-title">🏁 CARRERA RÁPIDA</h1>
      <p>Prepara tu próxima carrera.</p>

      <div class="game-panel">
        <label for="raceVehicle">Vehículo</label>
        <select id="raceVehicle">${vehicleOptions}</select>

        <label for="raceTrack">Circuito</label>
        <select id="raceTrack">${trackOptions}</select>
        <div class="race-track-summary" id="raceTrackSummary"></div>

        <label for="raceDifficulty">Dificultad</label>
        <select id="raceDifficulty">
          <option value="easy">Fácil</option>
          <option value="normal">Normal</option>
          <option value="hard">Difícil</option>
          <option value="expert">Experto</option>
        </select>

        <label for="raceRivals">Rivales</label>
        <select id="raceRivals">
          <option value="0">Sin rivales</option>
          <option value="1">1 rival</option>
          <option value="2">2 rivales</option>
          <option value="3" selected>3 rivales</option>
        </select>

        <label for="raceLaps">Vueltas</label>
        <select id="raceLaps">
          <option value="1">1 vuelta</option>
          <option value="3" selected>3 vueltas</option>
          <option value="5">5 vueltas</option>
        </select>

        <label for="raceSimulationMode">Motor de simulación</label>
        <select id="raceSimulationMode">
          <option value="local">Local JavaScript</option>
          <option value="sequential">C++ secuencial (experimental)</option>
          <option value="openmp">C++ OpenMP (experimental)</option>
          <option value="mpi">C++ MPI / Docker (experimental)</option>
        </select>

        <label for="raceSimulationThreads">Hilos OpenMP</label>
        <select id="raceSimulationThreads">
          <option value="2">2 hilos</option>
          <option value="4" selected>4 hilos</option>
        </select>

        <label for="raceSimulationProcesses">Procesos MPI</label>
        <select id="raceSimulationProcesses">
          <option value="1">1 proceso</option>
          <option value="2">2 procesos</option>
          <option value="3" selected>3 procesos</option>
        </select>

        <p class="note">
          C++ secuencial/OpenMP integran la posición del jugador; los controles,
          aceleración, dirección, rivales, obstáculos y colisiones siguen en
          JavaScript. MPI queda en sombra por su latencia. Si el backend falla,
          la carrera continúa con movimiento local.
        </p>

        <p id="raceConfigurationSummary" class="note" aria-live="polite"></p>
        <button class="primary" id="startRace">
          ▶ INICIAR CARRERA
        </button>
      </div>

      <button class="back-btn" data-screen="home">
        ← VOLVER
      </button>
    </div>
  `,

  championship: `
    <div class="screen content-screen">
      <h1 class="section-title">🏆 NEON CUP</h1>
      <p class="section-subtitle">TRES CIRCUITOS · UNA CLASIFICACIÓN</p>
      <div id="championshipContent"></div>
      <button class="back-btn" data-screen="home">← VOLVER</button>
    </div>
  `,

  garage: `
    <div class="screen content-screen">
      <h1 class="section-title">🚗 MI GARAJE</h1>
      <p>Seis modelos funcionales; el modelo seleccionado es el mismo que usa la carrera.</p>

      <div class="garage-layout">
        <div class="garage-showroom">
          <div id="garagePreview" aria-label="Vista 3D del vehículo"></div>
          <p class="note">Arrastra para girar · rueda del ratón para acercar</p>
          <div id="garageVehicleList" class="garage-vehicle-list"></div>
        </div>

        <div class="game-panel garage-controls">
          <label for="garageVehicle">Vehículo</label>
          <select id="garageVehicle">${vehicleOptions}</select>
          <div id="garageStats" class="garage-stats"></div>

          <h2>Personalización</h2>
          <label for="garageBodyColor">Carrocería</label>
          <select id="garageBodyColor"></select>
          <label for="garageNeonColor">Neón</label>
          <select id="garageNeonColor"></select>
          <label for="garageWheelStyle">Llantas</label>
          <select id="garageWheelStyle">
            <option value="turbine">Turbina</option>
            <option value="split">Radios dobles</option>
            <option value="disc">Disco</option>
          </select>
          <label for="garageLivery">Diseño</label>
          <select id="garageLivery">
            <option value="none">Sin diseño</option>
            <option value="racing-stripe">Franjas de competición</option>
            <option value="circuit-lines">Líneas laterales</option>
          </select>
          <label for="garageSpoiler">Alerón</label>
          <select id="garageSpoiler">
            <option value="factory">De fábrica</option>
            <option value="none">Sin alerón</option>
            <option value="small">Compacto</option>
            <option value="large">Competición</option>
          </select>

          <h2>Mejoras instaladas</h2>
          <p id="garageUpgrades" class="note"></p>
        </div>
      </div>

      <button class="back-btn" data-screen="home">← VOLVER</button>
    </div>
  `,

  tracks: `
    <div class="screen content-screen">
      <h1 class="section-title">🛣️ CIRCUITOS</h1>
      <p>Vistas de recorrido generadas desde la misma geometría de carrera.</p>
      <div class="cards">${trackCards}</div>

      <button class="back-btn" data-screen="home">← VOLVER</button>
    </div>
  `,

  economy: `
    <div class="screen content-screen">
      <h1 class="section-title">🪙 NEON COINS</h1>
      <section class="wallet-summary" aria-label="Monedero Neon Coins">
        <div><span>Saldo actual</span><strong id="walletBalance">0 NC</strong></div>
        <div><span>Monedas ganadas</span><strong id="walletEarned">0 NC</strong></div>
        <div><span>Monedas gastadas</span><strong id="walletSpent">0 NC</strong></div>
      </section>
      <p id="walletRewardRules" class="note"></p>
      <div class="game-panel">
        <label for="storeCategory">Categoría</label>
        <select id="storeCategory"></select>
        <div class="store-preview-layout">
          <div>
            <div id="storePreviewCanvas" aria-label="Vista previa 3D del artículo"></div>
            <p id="storePreviewDetail" class="note">Selecciona un artículo para previsualizarlo.</p>
          </div>
          <p id="storeMessage" class="store-message" aria-live="polite"></p>
        </div>
        <div id="storeGrid" class="store-grid"></div>
      </div>
      <div class="game-panel">
        <h2>Historial de movimientos</h2>
        <ol id="walletHistory" class="wallet-history"></ol>
      </div>
      <p class="note">
        El monedero se guarda localmente en este navegador; no está protegido
        frente a modificaciones del almacenamiento del dispositivo.
      </p>
      <button class="back-btn" data-screen="home">← VOLVER</button>
    </div>
  `,

  challenges: `
    <div class="screen content-screen">
      <h1 class="section-title">🎯 DESAFÍOS</h1>
      <p class="section-subtitle">PROGRESO VINCULADO A TUS CARRERAS REALES</p>
      <div id="dailyMissionContent"></div>
      <div id="challengeContent"></div>
      <button class="back-btn" data-screen="home">← VOLVER</button>
    </div>
  `,

  stats: `
    <div class="screen content-screen">
      <h1 class="section-title">📊 PERFIL DEL PILOTO</h1>
      <p class="section-subtitle">EXPERIENCIA · ESTADÍSTICAS · RÉCORDS</p>
      <div id="playerProgressionContent"></div>
      <button class="back-btn" data-screen="home">← VOLVER</button>
    </div>
  `,

  laboratory: `
    <div class="screen content-screen">
      <h1 class="section-title">💻 LABORATORIO PARALELO</h1>
      <p>Prueba el motor C++ con estados de vehículos enviados desde el navegador.</p>

      <div class="game-panel parallel-lab">
        <div class="parallel-lab-heading">
          <strong>CONEXIÓN BACKEND</strong>
          <span id="parallelLabStatus" class="backend-connection" data-state="desconectado">
            DESCONECTADO
          </span>
        </div>

        <label for="parallelMode">Modo de prueba</label>
        <select id="parallelMode">
          <option value="local">Local JavaScript (carrera actual)</option>
          <option value="sequential">C++ secuencial</option>
          <option value="openmp">C++ OpenMP</option>
          <option value="mpi">C++ MPI / Docker</option>
        </select>

        <label for="parallelThreads">Hilos OpenMP</label>
        <select id="parallelThreads">
          <option value="2">2 hilos</option>
          <option value="4" selected>4 hilos</option>
        </select>

        <label for="parallelProcesses">Procesos MPI</label>
        <select id="parallelProcesses">
          <option value="1">1 proceso</option>
          <option value="2">2 procesos</option>
          <option value="3" selected>3 procesos (tres contenedores)</option>
        </select>

        <label for="parallelSteps">Pasos de la prueba (1–120)</label>
        <input id="parallelSteps" type="number" min="1" max="120" value="10">

        <p id="localModeMessage">
          La carrera permanece en modo local JavaScript. No se envían cálculos
          al backend desde la física principal.
        </p>
        <button class="primary" id="runParallelTest">
          ▶ ENVIAR ESTADO DE PRUEBA A C++
        </button>
        <div id="parallelResult" class="parallel-result" aria-live="polite">
          El resultado del motor aparecerá aquí.
        </div>
      </div>

      <button class="back-btn" data-screen="home">← VOLVER</button>
    </div>
  `,

  settings: `
    <div class="screen content-screen">
      <h1 class="section-title">⚙ CONFIGURACIÓN</h1>

      <div class="game-panel">
        <label for="masterVolume">Volumen general</label>
        <input type="range" id="masterVolume" min="0" max="100" value="70">

        <label for="musicVolume">Volumen de música</label>
        <input type="range" id="musicVolume" min="0" max="100" value="70">

        <label for="effectsVolume">Efectos de sonido</label>
        <input type="range" id="effectsVolume" min="0" max="100" value="80">

        <label for="muteAudio">
          <input type="checkbox" id="muteAudio"> Silenciar audio
        </label>

        <label for="graphicsQuality">Calidad gráfica</label>
        <select id="graphicsQuality">
          <option value="low">Bajo</option>
          <option value="medium">Medio</option>
          <option value="high">Alto</option>
        </select>
        <p id="graphicsQualityDescription" class="note"></p>

        <p>Controles: W, A, S, D y flechas</p>
        <p>Turbo: Espacio</p>
        <p>Pausa: ESC</p>
        <p>La simulación de carrera utiliza actualmente el modo local JavaScript.</p>
      </div>

      <button class="back-btn" data-back>← VOLVER</button>
    </div>
  `,

  about: `
    <div class="screen content-screen">
      <h1 class="section-title">ⓘ ACERCA DE NEON RUSH</h1>

      <div class="game-panel">
        <p>Videojuego de carreras arcade 3D.</p>
        <p>Proyecto de TEL420 - Sistemas Paralelos.</p>
        <p>Universidad Autónoma Juan Misael Saracho.</p>
        <p>Desarrollado con Three.js, C++, OpenMP y OpenMPI.</p>
        <p class="note">
          El motor C++ puede probarse desde el laboratorio paralelo. La carrera
          principal continúa utilizando física local JavaScript.
        </p>
      </div>

      <button class="back-btn" data-back>← VOLVER</button>
    </div>
  `,

  race: `
    <div class="race-screen">
      <div id="collisionFlash"></div>
      <div class="race-hud">
        <div class="hud-item">
          <span>NEON RUSH</span>
          <strong>FÍSICA LOCAL JS</strong>
          <small id="raceBackendStatus" class="backend-connection" data-state="desconectado">
            BACKEND DESCONECTADO
          </small>
          <small id="raceBackendMetrics" class="race-backend-metrics"></small>
        </div>

        <div class="hud-item">
          <span>VELOCIDAD</span>
          <strong><span id="speedValue">0</span> km/h</strong>
        </div>
      </div>

      
      <div class="lap-counter">
        🏁 VUELTA <span id="lapValue">1/3</span>
      </div>

      <div class="race-extra-hud">
        <div class="race-timer">
          ⏱ TIEMPO: <span id="raceTime">00:00</span>
        </div>

        <div class="nitro-panel">
          <span>⚡ NITRO</span>
          <div class="nitro-bar">
            <div id="nitroFill"></div>
          </div>
        </div>
      </div>

      <button class="race-reset" id="resetRace">
        ↻ REINICIAR
      </button>

      <div class="race-controls">
        W / ↑ Acelerar · S / ↓ Frenar o retroceder
        <br>
        A / ← Girar izquierda · D / → Girar derecha
      </div>

      <button class="race-exit" id="exitRace">
        ← VOLVER AL MENÚ
      </button>
    </div>
  `,
};
