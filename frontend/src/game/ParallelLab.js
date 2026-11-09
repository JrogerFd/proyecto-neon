import { BackendClient } from './BackendClient.js';

const DEMO_VEHICLES = [
  {
    id: 0,
    x: 0,
    z: 0,
    speed: 2,
    direction: 0,
    collisionRadius: 1,
    active: true
  },
  {
    id: 1,
    x: 2.1,
    z: 0,
    speed: 0,
    direction: 0,
    collisionRadius: 1,
    active: true
  },
  {
    id: 2,
    x: -8,
    z: 0,
    speed: 3,
    direction: Math.PI / 2,
    collisionRadius: 1,
    active: true
  },
  {
    id: 3,
    x: 0,
    z: 10,
    speed: 4,
    direction: -Math.PI / 2,
    collisionRadius: 1,
    active: true
  }
];

function referenceMovement(vehicles, steps, deltaTime) {
  return vehicles.map((vehicle) => ({
    ...vehicle,
    x: vehicle.active
      ? vehicle.x + Math.cos(vehicle.direction) * vehicle.speed *
        deltaTime * steps
      : vehicle.x,
    z: vehicle.active
      ? vehicle.z + Math.sin(vehicle.direction) * vehicle.speed *
        deltaTime * steps
      : vehicle.z
  }));
}

function formatSeconds(value) {
  return `${(value * 1000).toFixed(3)} ms`;
}

function setConnectionStatus(element, status) {
  if (!element) return;
  element.dataset.state = status;
  element.textContent = status.toUpperCase();
}

export function mountParallelLab(
  root,
  {
    client = new BackendClient(),
    setStatus = () => {}
  } = {}
) {
  const statusElement = root.querySelector('#parallelLabStatus');
  const modeElement = root.querySelector('#parallelMode');
  const threadsElement = root.querySelector('#parallelThreads');
  const processesElement = root.querySelector('#parallelProcesses');
  const stepsElement = root.querySelector('#parallelSteps');
  const simulateButton = root.querySelector('#runParallelTest');
  const output = root.querySelector('#parallelResult');
  const localMessage = root.querySelector('#localModeMessage');
  let running = false;
  let requestSequence = 0;
  let activeController = null;
  let destroyed = false;

  const onModeChange = () => {
    const isLocal = modeElement.value === 'local';
    simulateButton.disabled = isLocal || running;
    localMessage.hidden = !isLocal;
    threadsElement.disabled = modeElement.value !== 'openmp';
    processesElement.disabled = modeElement.value !== 'mpi';
  };

  const onSimulate = async () => {
    if (running || modeElement.value === 'local') return;

    running = true;
    simulateButton.disabled = true;
    setConnectionStatus(statusElement, 'simulando');
    setStatus('simulating');
    output.textContent = 'Enviando el estado de prueba al motor C++…';

    const mode = modeElement.value;
    const steps = Number(stepsElement.value);
    const requestId = `lab-${Date.now()}-${++requestSequence}`;
    const request = {
      requestId,
      mode,
      steps,
      deltaTime: 1 / 60,
      vehicles: DEMO_VEHICLES.map((vehicle) => ({ ...vehicle }))
    };
    activeController = new AbortController();

    if (mode === 'openmp') {
      request.threads = Number(threadsElement.value);
    } else if (mode === 'mpi') {
      request.processes = Number(processesElement.value);
    }

    try {
      const result = await client.simulate(request, {
        signal: activeController.signal
      });
      if (destroyed) return;
      if (result.requestId !== requestId) {
        throw new Error('El backend respondió a una solicitud diferente');
      }

      renderResult(output, request, result);
      setConnectionStatus(statusElement, 'conectado');
      setStatus('connected');
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (destroyed) return;
      output.textContent = `Error: ${error.message}`;
      setConnectionStatus(statusElement, 'error');
      setStatus('error');
    } finally {
      running = false;
      activeController = null;
      if (!destroyed) onModeChange();
    }
  };

  const renderResult = (container, request, result) => {
    const reference = referenceMovement(
      request.vehicles,
      request.steps,
      request.deltaTime
    );
    const heading = document.createElement('p');
    heading.textContent =
      `Respuesta real del backend · ${result.mode.toUpperCase()} · ` +
      `${result.metrics.steps} pasos`;

    const table = document.createElement('table');
    table.className = 'parallel-results-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>ID</th>
          <th>C++ X/Z</th>
          <th>Referencia JS X/Z</th>
        </tr>
      </thead>
    `;
    const body = document.createElement('tbody');

    result.vehicles.forEach((vehicle) => {
      const expected = reference.find((item) => item.id === vehicle.id);
      const row = document.createElement('tr');
      const values = [
        String(vehicle.id),
        `${vehicle.x.toFixed(3)} / ${vehicle.z.toFixed(3)}`,
        `${expected.x.toFixed(3)} / ${expected.z.toFixed(3)}`
      ];
      values.forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    table.appendChild(body);

    const metrics = document.createElement('p');
    const execution = result.mode === 'mpi'
      ? `${result.processes} proceso(s), ` +
        `${result.nodes?.length ?? 0} nodo(s)` +
        (result.nodes?.length ? ` (${result.nodes.join(', ')})` : '')
      : result.mode === 'openmp'
        ? `${result.threads} hilo(s)`
        : '1 hilo';
    const parallelMetrics = [];
    if (Number.isFinite(result.metrics.speedup)) {
      parallelMetrics.push(`speedup ${result.metrics.speedup.toFixed(2)}×`);
    }
    if (Number.isFinite(result.metrics.efficiency)) {
      parallelMetrics.push(
        `eficiencia ${(result.metrics.efficiency * 100).toFixed(1)}%`
      );
    }
    if (Number.isFinite(result.metrics.communicationSeconds)) {
      parallelMetrics.push(
        `comunicación ${formatSeconds(result.metrics.communicationSeconds)}`
      );
    }
    if (Number.isFinite(result.metrics.serializationSeconds)) {
      parallelMetrics.push(
        `serialización ${formatSeconds(result.metrics.serializationSeconds)}`
      );
    }
    if (Number.isFinite(result.metrics.requestSeconds)) {
      parallelMetrics.push(
        `respuesta ${(result.metrics.requestSeconds * 1000).toFixed(2)} ms`
      );
    }
    metrics.textContent =
      `${execution} · movimiento ${formatSeconds(result.metrics.movementSeconds)}` +
      ` · colisiones ${formatSeconds(result.metrics.collisionSeconds)}` +
      ` · total ${formatSeconds(result.metrics.totalSeconds)}` +
      (parallelMetrics.length ? ` · ${parallelMetrics.join(' · ')}` : '');

    const collisions = document.createElement('p');
    collisions.textContent = result.collisionPairs.length
      ? `Pares detectados: ${result.collisionPairs
        .map((pair) => pair.join('–')).join(', ')}`
      : 'Sin colisiones en la última actualización';

    const note = document.createElement('p');
    note.textContent =
      'La columna de referencia aplica la ecuación de movimiento local; ' +
      'los resultados OpenMP/MPI de la tabla proceden únicamente del backend C++.';

    container.replaceChildren(heading, table, metrics, collisions, note);
  };

  modeElement.addEventListener('change', onModeChange);
  simulateButton.addEventListener('click', onSimulate);
  onModeChange();

  client.health()
    .then(() => {
      setConnectionStatus(statusElement, 'conectado');
      setStatus('connected');
    })
    .catch(() => {
      setConnectionStatus(statusElement, 'desconectado');
      setStatus('disconnected');
    });

  return {
    destroy() {
      destroyed = true;
      modeElement.removeEventListener('change', onModeChange);
      simulateButton.removeEventListener('click', onSimulate);
      if (activeController) {
        activeController.abort();
        client.health()
          .then(() => setStatus('connected'))
          .catch(() => setStatus('disconnected'));
      }
    }
  };
}
