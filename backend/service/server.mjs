import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../..');
const defaultBridgePath = resolve(repositoryRoot, 'backend/build/neon_rush_api');
const defaultClusterScript = resolve(
  repositoryRoot,
  'infrastructure/mpi-cluster/scripts/cluster.sh',
);
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
const maximumBodyBytes = 64 * 1024;
const maximumOutputBytes = 1024 * 1024;
const maximumVehicles = 64;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(response, status, value, origin) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (origin && allowedOrigins.has(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  const body = JSON.stringify(value);
  response.writeHead(status, headers);
  response.end(body);
}

function requestError(status, code, message) {
  return new HttpError(status, code, message);
}

async function readJsonBody(request, signal) {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBodyBytes) {
    throw requestError(413, 'request_too_large', 'Request body exceeds 64 KiB.');
  }
  const chunks = [];
  let length = 0;
  let tooLarge = false;
  try {
    for await (const chunk of request) {
      if (signal.aborted) {
        throw new DOMException('Client disconnected', 'AbortError');
      }
      length += chunk.length;
      if (length > maximumBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
        continue;
      }
      if (!tooLarge) chunks.push(chunk);
    }
  } catch (error) {
    if (signal.aborted || error.name === 'AbortError') throw error;
    throw error;
  }
  if (signal.aborted) throw new DOMException('Client disconnected', 'AbortError');
  if (tooLarge) {
    throw requestError(413, 'request_too_large', 'Request body exceeds 64 KiB.');
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const parseStart = performance.now();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw requestError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  return { value, serializationSeconds: (performance.now() - parseStart) / 1000 };
}

function objectWithOnlyKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw requestError(400, 'invalid_request', `${label} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw requestError(400, 'invalid_request', `Unexpected ${label} field: ${key}.`);
    }
  }
}

function requireInteger(value, minimum, maximum, field) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw requestError(
      400,
      'invalid_request',
      `${field} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
}

function requireFinite(value, minimum, maximum, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) ||
      value < minimum || value > maximum) {
    throw requestError(400, 'invalid_request', `${field} is outside its allowed range.`);
  }
}

function validateRequest(value) {
  objectWithOnlyKeys(
    value,
    new Set([
      'requestId',
      'mode',
      'threads',
      'processes',
      'steps',
      'deltaTime',
      'vehicles',
    ]),
    'request',
  );
  if (typeof value.requestId !== 'string' ||
      value.requestId.length < 1 || value.requestId.length > 128) {
    throw requestError(400, 'invalid_request', 'requestId must be a non-empty string of at most 128 characters.');
  }
  if (!['sequential', 'openmp', 'mpi'].includes(value.mode)) {
    throw requestError(400, 'invalid_request', 'mode must be sequential, openmp, or mpi.');
  }
  requireInteger(value.steps, 1, 120, 'steps');
  requireFinite(value.deltaTime, 0, 0.1, 'deltaTime');
  if (!Array.isArray(value.vehicles) || value.vehicles.length > maximumVehicles) {
    throw requestError(400, 'invalid_request', `vehicles must be an array of at most ${maximumVehicles} items.`);
  }
  const ids = new Set();
  const vehicles = value.vehicles.map((vehicle, index) => {
    objectWithOnlyKeys(
      vehicle,
      new Set(['id', 'x', 'z', 'speed', 'direction', 'collisionRadius', 'active']),
      `vehicles[${index}]`,
    );
    requireInteger(vehicle.id, 0, 0xffff_ffff, `vehicles[${index}].id`);
    if (ids.has(vehicle.id)) {
      throw requestError(400, 'invalid_request', `vehicles[${index}].id must be unique.`);
    }
    ids.add(vehicle.id);
    requireFinite(vehicle.x, -1.0e9, 1.0e9, `vehicles[${index}].x`);
    requireFinite(vehicle.z, -1.0e9, 1.0e9, `vehicles[${index}].z`);
    requireFinite(vehicle.speed, 0, 1.0e6, `vehicles[${index}].speed`);
    requireFinite(vehicle.direction, -1.0e12, 1.0e12, `vehicles[${index}].direction`);
    if (vehicle.collisionRadius !== undefined) {
      requireFinite(
        vehicle.collisionRadius,
        1.0e-4,
        1.0e6,
        `vehicles[${index}].collisionRadius`,
      );
    }
    if (typeof vehicle.active !== 'boolean') {
      throw requestError(400, 'invalid_request', `vehicles[${index}].active must be a boolean.`);
    }
    return {
      id: vehicle.id,
      x: vehicle.x,
      z: vehicle.z,
      speed: vehicle.speed,
      direction: vehicle.direction,
      collisionRadius: vehicle.collisionRadius ?? 1,
      active: vehicle.active,
    };
  });

  const threads = value.threads === undefined ? 1 : value.threads;
  const processes = value.processes === undefined ? 3 : value.processes;
  if (value.threads !== undefined) requireInteger(threads, 1, 4, 'threads');
  if (value.processes !== undefined) requireInteger(processes, 1, 3, 'processes');
  if (value.mode !== 'openmp' && value.threads !== undefined) {
    throw requestError(400, 'invalid_request', 'threads is only valid for openmp mode.');
  }
  if (value.mode !== 'mpi' && value.processes !== undefined) {
    throw requestError(400, 'invalid_request', 'processes is only valid for mpi mode.');
  }
  return {
    requestId: value.requestId,
    mode: value.mode,
    threads: value.mode === 'openmp' ? threads : 1,
    processes: value.mode === 'mpi' ? processes : 1,
    steps: value.steps,
    deltaTime: value.deltaTime,
    vehicles,
  };
}

function makeProtocol(request) {
  const mode = request.mode;
  const threadCount = mode === 'openmp' ? request.threads : 1;
  const rows = request.vehicles.map((vehicle) => [
    vehicle.id,
    vehicle.x,
    vehicle.z,
    vehicle.speed,
    vehicle.direction,
    vehicle.collisionRadius,
    vehicle.active ? 1 : 0,
  ].join(' '));
  return [
    `NRAPI1 ${mode} ${request.steps} ${request.deltaTime} ${request.vehicles.length} ${threadCount}`,
    ...rows,
    '',
  ].join('\n');
}

function parseBridgeOutput(stdout, request) {
  const lines = stdout.trimEnd().split('\n');
  const header = lines.shift()?.trim().split(/\s+/);
  if (!header || header.length !== 19 || header[0] !== 'NRAPI1') {
    throw new Error('C++ bridge returned an invalid response header.');
  }
  const [
    , mode, processesText, threadsText, stepsText, movementText,
    collisionText, communicationText, totalText, collisionsText,
    processCpuText, processPeakRssBytesText,
    vehicleCountText, pairCountText, nodeCountText, referenceFlagText,
    referenceTotalText, speedupText, efficiencyText,
  ] = header;
  const integers = [
    processesText, threadsText, stepsText, collisionsText,
    vehicleCountText, pairCountText, nodeCountText, referenceFlagText,
  ].map(Number);
  const [processes, threads, steps, collisions, vehicleCount, pairCount, nodeCount, hasReference] = integers;
  const numbers = [
    movementText, collisionText, communicationText, totalText,
    processCpuText, referenceTotalText, speedupText, efficiencyText,
  ].map(Number);
  const processPeakRssBytes = Number(processPeakRssBytesText);
  if (mode !== request.mode || processes !== request.processes ||
      threads !== request.threads || steps !== request.steps ||
      !integers.every(Number.isSafeInteger) ||
      !numbers.every(Number.isFinite) ||
      !Number.isSafeInteger(processPeakRssBytes) ||
      processPeakRssBytes < 0 ||
      vehicleCount !== request.vehicles.length ||
      vehicleCount > maximumVehicles || pairCount < 0 ||
      pairCount > maximumVehicles * (maximumVehicles - 1) / 2 ||
      nodeCount !== (request.mode === 'mpi' ? processes : 0) ||
      hasReference !== (request.mode === 'sequential' ? 0 : 1)) {
    throw new Error('C++ bridge returned inconsistent result metadata.');
  }
  if (numbers.slice(0, 5).some((number) => number < 0) ||
      numbers.slice(4).some((number) => number < 0)) {
    throw new Error('C++ bridge returned negative timing or comparison metrics.');
  }
  const expectedLines = vehicleCount + pairCount + nodeCount + 1;
  if (lines.length !== expectedLines) {
    throw new Error('C++ bridge returned an incomplete result.');
  }
  const vehicleRowsEnd = vehicleCount;
  const vehicles = [];
  for (let index = 0; index < vehicleRowsEnd; index += 1) {
    const fields = lines[index].trim().split(/\s+/);
    if (fields.length !== 8 || fields[0] !== 'V') {
      throw new Error('C++ bridge returned an invalid vehicle row.');
    }
    const [id, x, z, speed, direction, collisionRadius, active] = fields.slice(1).map(Number);
    if (![id, x, z, speed, direction, collisionRadius, active].every(Number.isFinite) ||
        !Number.isSafeInteger(id) || ![0, 1].includes(active)) {
      throw new Error('C++ bridge returned invalid vehicle values.');
    }
    vehicles.push({
      id, x, z, speed, direction, collisionRadius, active: active === 1,
    });
  }
  const collisionPairs = [];
  for (let index = 0; index < pairCount; index += 1) {
    const fields = lines[vehicleCount + index].trim().split(/\s+/);
    if (fields.length !== 3 || fields[0] !== 'P') {
      throw new Error('C++ bridge returned an invalid collision pair.');
    }
    const first = Number(fields[1]);
    const second = Number(fields[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(second) ||
        first >= second) {
      throw new Error('C++ bridge returned invalid collision pair IDs.');
    }
    collisionPairs.push([first, second]);
  }
  const nodes = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const fields = lines[vehicleCount + pairCount + index].trim().split(/\s+/);
    if (fields.length !== 2 || fields[0] !== 'N' ||
        !/^[A-Za-z0-9._-]{1,253}$/.test(fields[1])) {
      throw new Error('C++ bridge returned an invalid MPI rank placement.');
    }
    nodes.push(fields[1]);
  }
  if (lines.at(-1)?.trim() !== 'END') {
    throw new Error('C++ bridge response is missing its terminator.');
  }
  const sourceIds = new Set(request.vehicles.map(({ id }) => id));
  if (vehicles.some(({ id }) => !sourceIds.has(id)) ||
      new Set(vehicles.map(({ id }) => id)).size !== sourceIds.size) {
    throw new Error('C++ bridge changed or duplicated vehicle IDs.');
  }
  const sourceVehicles = new Map(request.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  for (const vehicle of vehicles) {
    const source = sourceVehicles.get(vehicle.id);
    if (vehicle.speed !== source.speed || vehicle.direction !== source.direction ||
        vehicle.collisionRadius !== source.collisionRadius ||
        vehicle.active !== source.active || vehicle.speed < 0 ||
        vehicle.collisionRadius <= 0) {
      throw new Error('C++ bridge changed immutable vehicle properties.');
    }
  }
  const pairKeys = new Set();
  for (const [first, second] of collisionPairs) {
    const key = `${first}:${second}`;
    if (!sourceIds.has(first) || !sourceIds.has(second) || pairKeys.has(key)) {
      throw new Error('C++ bridge returned unknown or duplicate collision pairs.');
    }
    pairKeys.add(key);
  }
  return {
    mode,
    processes,
    threads,
    steps,
    movementSeconds: numbers[0],
    collisionSeconds: numbers[1],
    communicationSeconds: numbers[2],
    totalSeconds: numbers[3],
    processCpuSeconds: numbers[4],
    processPeakRssBytes,
    collisions,
    vehicles,
    collisionPairs,
    nodes,
    ...(hasReference ? {
      referenceTotalSeconds: numbers[5],
      speedup: numbers[6],
      efficiency: numbers[7],
    } : {}),
  };
}

function terminateChild(child) {
  if (!child.pid) return;
  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    child.kill('SIGTERM');
  }
}

export function createProcessRunner({
  bridgePath = process.env.NEON_RUSH_API_BRIDGE || defaultBridgePath,
  clusterScript = process.env.NEON_RUSH_CLUSTER_SCRIPT || defaultClusterScript,
  timeoutMs = 60_000,
} = {}) {
  return (request, { signal }) => new Promise((resolvePromise, rejectPromise) => {
    const preparationStart = performance.now();
    const protocol = makeProtocol(request);
    const protocolPreparationSeconds =
      (performance.now() - preparationStart) / 1000;
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let stopping = false;
    let killTimer;
    let timedOut = false;
    let terminationError = null;
    const command = request.mode === 'mpi' ? clusterScript : bridgePath;
    const args = request.mode === 'mpi'
      ? ['api', String(request.processes)]
      : ['--mode', request.mode];
    try {
      child = spawn(command, args, {
        cwd: repositoryRoot,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (error) {
      rejectPromise(error);
      return;
    }
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error?.name !== 'AbortError') clearTimeout(killTimer);
      signal.removeEventListener('abort', onAbort);
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };
    const onAbort = (timeoutError = false) => {
      if (stopping) return;
      stopping = true;
      if (timeoutError) timedOut = true;
      terminateChild(child);
      killTimer = setTimeout(() => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { /* The process may already have exited. */ }
      }, 1000);
    };
    const timeout = setTimeout(() => {
      onAbort(true);
    }, timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > maximumOutputBytes) {
        terminationError = new Error('C++ bridge output exceeded its size limit.');
        terminateChild(child);
        if (!killTimer) {
          killTimer = setTimeout(() => {
            try {
              if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
              else child.kill('SIGKILL');
            } catch { /* The process may already have exited. */ }
          }, 1000);
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > maximumOutputBytes) {
        stderr = stderr.slice(-maximumOutputBytes);
      }
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (settled) return;
      if (timedOut) {
        finish(Object.assign(new Error('Simulation timed out.'), { code: 'simulation_timeout' }));
        return;
      }
      if (signal.aborted) {
        finish(Object.assign(new Error('Simulation was cancelled.'), { name: 'AbortError' }));
        return;
      }
      if (terminationError) {
        finish(terminationError);
        return;
      }
      if (code !== 0) {
        finish(new Error(stderr.trim() || `C++ bridge exited with code ${code}.`));
        return;
      }
      try {
        const parseStart = performance.now();
        const result = parseBridgeOutput(stdout, request);
        result.serializationSeconds = protocolPreparationSeconds +
          (performance.now() - parseStart) / 1000;
        finish(null, result);
      } catch (error) {
        finish(error);
      }
    });
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') finish(error);
    });
    if (signal.aborted) {
      onAbort();
      return;
    }
    child.stdin.end(protocol);
  });
}

export function createApiServer({
  runner = createProcessRunner(),
  host = '127.0.0.1',
  port = 4174,
} = {}) {
  let activeController = null;
  const server = createHttpServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      sendJson(response, 403, {
        error: { code: 'origin_not_allowed', message: 'This origin is not allowed.' },
      });
      return;
    }
    if (origin) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('vary', 'Origin');
    }
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    const path = new URL(request.url, `http://${host}`).pathname;
    if (request.method === 'GET' && path === '/api/health') {
      sendJson(response, 200, { status: 'ok' }, origin);
      return;
    }
    if (path !== '/api/simulate') {
      sendJson(response, 404, {
        error: { code: 'not_found', message: 'Route not found.' },
      }, origin);
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, {
        error: { code: 'method_not_allowed', message: 'Use POST for this route.' },
      }, origin);
      return;
    }
    if (activeController) {
      sendJson(response, 409, {
        error: { code: 'simulation_busy', message: 'Another simulation is active.' },
      }, origin);
      return;
    }

    const controller = new AbortController();
    activeController = controller;
    const started = performance.now();
    const abortOnDisconnect = () => {
      if (!response.writableEnded) controller.abort();
    };
    request.once('aborted', abortOnDisconnect);
    response.once('close', abortOnDisconnect);
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
        throw requestError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
      }
      const { value, serializationSeconds: jsonParseSeconds } =
        await readJsonBody(request, controller.signal);
      const normalized = validateRequest(value);
      if (controller.signal.aborted) {
        throw new DOMException('Client disconnected', 'AbortError');
      }
      const result = await runner(normalized, { signal: controller.signal });
      if (controller.signal.aborted || response.destroyed) return;
      const serializationSeconds =
        jsonParseSeconds + (result.serializationSeconds ?? 0);
      const output = {
        requestId: normalized.requestId,
        mode: normalized.mode,
        processes: result.processes,
        threads: result.threads,
        vehicles: result.vehicles,
        collisionPairs: result.collisionPairs,
        metrics: {
          movementSeconds: result.movementSeconds,
          collisionSeconds: result.collisionSeconds,
          communicationSeconds: result.communicationSeconds,
          totalSeconds: result.totalSeconds,
          processCpuSeconds: result.processCpuSeconds,
          processPeakRssBytes: result.processPeakRssBytes,
          serializationSeconds,
          requestSeconds: 0,
          steps: result.steps,
          collisions: result.collisions,
          ...(result.referenceTotalSeconds !== undefined ? {
            referenceTotalSeconds: result.referenceTotalSeconds,
            speedup: result.speedup,
            efficiency: result.efficiency,
          } : {}),
        },
        ...(normalized.mode === 'mpi' ? { nodes: result.nodes } : {}),
      };
      const serializationStart = performance.now();
      let body = JSON.stringify(output);
      output.metrics.serializationSeconds +=
        (performance.now() - serializationStart) / 1000;
      output.metrics.requestSeconds = (performance.now() - started) / 1000;
      body = JSON.stringify(output);
      if (!response.destroyed) {
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          ...(origin ? {
            'access-control-allow-origin': origin,
            vary: 'Origin',
          } : {}),
        });
        response.end(body);
      }
    } catch (error) {
      if (controller.signal.aborted || response.destroyed ||
          error.name === 'AbortError') return;
      const status = error instanceof HttpError
        ? error.status
        : error.code === 'simulation_timeout' ? 504 : 502;
      const code = error instanceof HttpError
        ? error.code
        : error.code === 'simulation_timeout' ? 'simulation_timeout' : 'simulation_failed';
      const message = error instanceof HttpError
        ? error.message
        : error.code === 'simulation_timeout'
          ? 'Simulation exceeded the execution time limit.'
          : 'Simulation backend failed.';
      sendJson(response, status, { error: { code, message } }, origin);
    } finally {
      request.removeListener('aborted', abortOnDisconnect);
      response.removeListener('close', abortOnDisconnect);
      if (activeController === controller) activeController = null;
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Backend service cannot bind ${host}:${port}: address in use.`);
    } else {
      console.error('Backend service error:', error.message);
    }
  });
  server.shutdown = () => {
    activeController?.abort();
    return new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => error ? rejectPromise(error) : resolvePromise());
    });
  };
  server.listen(port, host);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createApiServer();
  const shutdown = () => {
    server.shutdown().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.on('listening', () => {
    console.log(`Neon Rush API listening at http://${server.address().address}:${server.address().port}`);
  });
}
