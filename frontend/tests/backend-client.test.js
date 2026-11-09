import assert from 'node:assert/strict';
import test from 'node:test';
import { BackendClient } from '../src/game/BackendClient.js';

test('health uses the configured local API endpoint', async () => {
  let request;
  const client = new BackendClient({
    baseUrl: 'http://localhost:4174/',
    fetchImplementation: async (...args) => {
      request = args;
      return {
        ok: true,
        json: async () => ({ status: 'ok' })
      };
    }
  });

  assert.deepEqual(await client.health(), { status: 'ok' });
  assert.equal(request[0], 'http://localhost:4174/api/health');
  assert.equal(request[1].method, 'GET');
});

test('simulation posts JSON and returns the backend response', async () => {
  const payload = {
    requestId: 'frontend-test-1',
    mode: 'sequential',
    steps: 1,
    deltaTime: 1 / 60,
    vehicles: []
  };
  const response = { requestId: payload.requestId, vehicles: [] };
  const client = new BackendClient({
    fetchImplementation: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:4174/api/simulate');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), payload);
      return { ok: true, json: async () => response };
    }
  });

  assert.deepEqual(await client.simulate(payload), response);
});

test('simulation exposes explicit backend errors', async () => {
  const client = new BackendClient({
    fetchImplementation: async () => ({
      ok: false,
      status: 422,
      json: async () => ({
        error: { message: 'invalid vehicle state' }
      })
    })
  });

  await assert.rejects(
    client.simulate({}),
    /invalid vehicle state/
  );
});
