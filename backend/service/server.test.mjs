import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import { test } from 'node:test';
import { resolve } from 'node:path';
import {
  createApiServer,
  createProcessRunner,
} from './server.mjs';

const bridgePath = resolve('backend/build/neon_rush_api');
const validRequest = {
  requestId: 'test-1',
  mode: 'sequential',
  steps: 2,
  deltaTime: 0.016,
  vehicles: [
    { id: 17, x: 0, z: 0, speed: 0, direction: 0, active: true },
    { id: 3, x: 1, z: 0, speed: 0, direction: 0, active: true },
  ],
};

function resultFor(request) {
  return {
    mode: request.mode,
    processes: request.processes,
    threads: request.threads,
    steps: request.steps,
    movementSeconds: 0.001,
    collisionSeconds: 0.002,
    communicationSeconds: request.mode === 'mpi' ? 0.003 : 0,
    totalSeconds: 0.004,
    processCpuSeconds: 0.002,
    processPeakRssBytes: 1024 * 1024,
    collisions: 1,
    vehicles: request.vehicles,
    collisionPairs: [[3, 17]],
    nodes: request.mode === 'mpi'
      ? Array.from({ length: request.processes }, (_, index) => `node${index + 1}`)
      : [],
    ...(request.mode === 'sequential' ? {} : {
      referenceTotalSeconds: 0.005,
      speedup: 1.25,
      efficiency: 1.25 / (request.mode === 'mpi' ? request.processes : request.threads),
    }),
  };
}

async function startServer(options = {}) {
  const server = createApiServer({ port: 0, ...options });
  if (!server.listening) await once(server, 'listening');
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => server.shutdown(),
  };
}

async function post(baseUrl, body, headers = {}) {
  return fetch(`${baseUrl}/api/simulate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('health endpoint and Vite CORS policy', async () => {
  const app = await startServer();
  try {
    const health = await fetch(`${app.baseUrl}/api/health`, {
      headers: { origin: 'http://localhost:5173' },
    });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    assert.equal(
      health.headers.get('access-control-allow-origin'),
      'http://localhost:5173',
    );
    const denied = await fetch(`${app.baseUrl}/api/health`, {
      headers: { origin: 'https://example.com' },
    });
    assert.equal(denied.status, 403);
    const preflight = await fetch(`${app.baseUrl}/api/simulate`, {
      method: 'OPTIONS',
      headers: { origin: 'http://127.0.0.1:5173' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get('access-control-allow-origin'),
      'http://127.0.0.1:5173',
    );
  } finally {
    await app.close();
  }
});

test('valid sequential request returns updated vehicles, pairs and timings', async () => {
  let received;
  const app = await startServer({
    runner: async (request) => {
      received = request;
      return resultFor(request);
    },
  });
  try {
    const response = await post(app.baseUrl, validRequest);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.requestId, 'test-1');
    assert.equal(body.mode, 'sequential');
    assert.equal(body.processes, 1);
    assert.equal(body.threads, 1);
    assert.deepEqual(body.collisionPairs, [[3, 17]]);
    assert.equal(body.vehicles.length, 2);
    assert.equal(body.metrics.steps, 2);
    assert.equal(body.metrics.collisions, 1);
    assert.ok(body.metrics.requestSeconds >= 0);
    assert.ok(body.metrics.serializationSeconds >= 0);
    assert.equal(body.metrics.processCpuSeconds, 0.002);
    assert.equal(body.metrics.processPeakRssBytes, 1024 * 1024);
    assert.equal(received.vehicles[0].collisionRadius, 1);
  } finally {
    await app.close();
  }
});

test('strict validation rejects malformed, unsafe and oversized requests', async () => {
  const app = await startServer();
  try {
    const cases = [
      ['not json', 400],
      [{ ...validRequest, steps: 0 }, 400],
      [{ ...validRequest, deltaTime: 0.11 }, 400],
      [{ ...validRequest, mode: 'other' }, 400],
      [{ ...validRequest, vehicles: [
        ...validRequest.vehicles,
        { ...validRequest.vehicles[0] },
      ] }, 400],
      [{ ...validRequest, vehicles: [
        { ...validRequest.vehicles[0], speed: -1 },
      ] }, 400],
      [{ ...validRequest, extra: true }, 400],
    ];
    for (const [body, status] of cases) {
      const response = await post(app.baseUrl, body);
      assert.equal(response.status, status);
      assert.equal(typeof (await response.json()).error.code, 'string');
    }
    const oversized = await post(
      app.baseUrl,
      JSON.stringify({ padding: 'x'.repeat(70 * 1024) }),
    );
    assert.equal(oversized.status, 413);
    const wrongType = await post(app.baseUrl, JSON.stringify(validRequest), {
      'content-type': 'text/plain',
    });
    assert.equal(wrongType.status, 415);
  } finally {
    await app.close();
  }
});

test('only one simulation runs at a time', async () => {
  let began;
  let release;
  const started = new Promise((resolvePromise) => { began = resolvePromise; });
  const gate = new Promise((resolvePromise) => { release = resolvePromise; });
  const app = await startServer({
    runner: async (request) => {
      began();
      await gate;
      return resultFor(request);
    },
  });
  try {
    const first = post(app.baseUrl, validRequest);
    await started;
    const conflict = await post(app.baseUrl, { ...validRequest, requestId: 'second' });
    assert.equal(conflict.status, 409);
    release();
    assert.equal((await first).status, 200);
  } finally {
    release();
    await app.close();
  }
});

test('client disconnect aborts the injected executor and releases the slot', async () => {
  let calls = 0;
  let runnerStarted;
  let aborted;
  const started = new Promise((resolvePromise) => { runnerStarted = resolvePromise; });
  const abortObserved = new Promise((resolvePromise) => { aborted = resolvePromise; });
  const app = await startServer({
    runner: (request, { signal }) => {
      calls += 1;
      if (calls > 1) return Promise.resolve(resultFor(request));
      runnerStarted();
      return new Promise((resolvePromise, rejectPromise) => {
        signal.addEventListener('abort', () => {
          aborted();
          rejectPromise(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
        }, { once: true });
      });
    },
  });
  const controller = new AbortController();
  try {
    const disconnected = fetch(`${app.baseUrl}/api/simulate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validRequest),
      signal: controller.signal,
    });
    await started;
    controller.abort();
    await assert.rejects(disconnected);
    await abortObserved;
    const next = await post(app.baseUrl, { ...validRequest, requestId: 'next' });
    assert.equal(next.status, 200);
  } finally {
    await app.close();
  }
});

test('backend failures return a stable error response', async () => {
  const app = await startServer({
    runner: async () => { throw new Error('private backend detail'); },
  });
  try {
    const response = await post(app.baseUrl, validRequest);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'simulation_failed',
        message: 'Simulation backend failed.',
      },
    });
  } finally {
    await app.close();
  }
});

test('built C++ bridge round-trips exact IDs, collisions and OpenMP reference', {
  skip: !existsSync(bridgePath),
}, async () => {
  const runner = createProcessRunner({ bridgePath });
  const openmpRequest = {
    ...validRequest,
    mode: 'openmp',
    threads: 2,
  };
  const result = await runner(
    {
      ...openmpRequest,
      processes: 1,
      vehicles: openmpRequest.vehicles.map((vehicle) => ({
        ...vehicle,
        collisionRadius: 1,
      })),
    },
    { signal: new AbortController().signal },
  );
  assert.deepEqual(result.vehicles.map(({ id }) => id), [17, 3]);
  assert.deepEqual(result.collisionPairs, [[3, 17]]);
  assert.equal(result.steps, 2);
  assert.equal(result.threads, 2);
  assert.ok(result.referenceTotalSeconds >= 0);
  assert.ok(result.speedup >= 0);
  assert.ok(result.serializationSeconds >= 0);
});
