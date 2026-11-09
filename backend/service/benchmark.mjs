import os from 'node:os';
import { performance } from 'node:perf_hooks';

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, value] = argument.replace(/^--/, '').split('=');
    return [key, value];
  }),
);
const repetitions = Number(options.repetitions ?? 5);
const vehicleCount = Number(options.vehicles ?? 64);
const steps = Number(options.steps ?? 120);
const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:4174')
  .replace(/\/+$/, '');
if (!Number.isInteger(repetitions) || repetitions < 1 ||
    !Number.isInteger(vehicleCount) || vehicleCount < 1 ||
    vehicleCount > 64 || !Number.isInteger(steps) ||
    steps < 1 || steps > 120) {
  throw new Error('Use repetitions >= 1, vehicles 1..64, and steps 1..120.');
}

const executionModes = [
  { mode: 'sequential', workers: 1 },
  { mode: 'openmp', workers: 1 },
  { mode: 'openmp', workers: 2 },
  { mode: 'openmp', workers: 4 },
  { mode: 'mpi', workers: 1 },
  { mode: 'mpi', workers: 2 },
  { mode: 'mpi', workers: 3 },
];
const vehicles = Array.from({ length: vehicleCount }, (_, id) => ({
  id,
  x: (id % 8) * 1.25,
  z: Math.floor(id / 8) * 1.25,
  speed: 1 + (id % 7) * 0.2,
  direction: (id % 16) * Math.PI / 8,
  collisionRadius: 1,
  active: true,
}));

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}

function statistics(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) {
    return { n: 0, median: null, mean: null, p95: null };
  }
  return {
    n: finiteValues.length,
    median: median(finiteValues),
    mean: finiteValues.reduce((sum, value) => sum + value, 0) /
      finiteValues.length,
    p95: percentile(finiteValues, 0.95),
  };
}

async function simulate(config, repetition) {
  const requestId = `phase6-${config.mode}-${config.workers}-${repetition}`;
  const request = {
    requestId,
    mode: config.mode,
    steps,
    deltaTime: 1 / 60,
    vehicles,
  };
  if (config.mode === 'openmp') request.threads = config.workers;
  if (config.mode === 'mpi') request.processes = config.workers;

  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/simulate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await response.json();
  const responseMs = performance.now() - started;
  if (!response.ok) {
    throw new Error(
      `${config.mode}/${config.workers} returned HTTP ${response.status}: ` +
      `${body.error?.message ?? 'unknown error'}`,
    );
  }
  if (body.requestId !== requestId || body.mode !== config.mode ||
      body.vehicles.length !== vehicleCount) {
    throw new Error('API returned inconsistent simulation metadata.');
  }
  return {
    responseMs,
    metrics: body.metrics,
    vehicles: body.vehicles,
    collisionPairs: body.collisionPairs,
    nodes: body.nodes ?? [],
  };
}

function stateSignature(result) {
  return JSON.stringify({
    vehicles: [...result.vehicles]
      .sort((a, b) => a.id - b.id)
      .map(({ id, x, z, speed, direction, active }) => ({
        id, x, z, speed, direction, active,
      })),
    collisionPairs: result.collisionPairs,
  });
}

function summarize(config, samples, sequentialTotalSeconds) {
  const metrics = (key) => median(samples.map((sample) => sample.metrics[key]));
  const metricStats = (key, scale = 1) => statistics(
    samples.map((sample) => sample.metrics[key] * scale),
  );
  const httpLatencyMs = statistics(samples.map((sample) => sample.responseMs));
  const kernelTotalMs = metricStats('totalSeconds', 1000);
  const movementMs = metricStats('movementSeconds', 1000);
  const collisionMs = metricStats('collisionSeconds', 1000);
  const communicationMs = metricStats('communicationSeconds', 1000);
  const serializationMs = metricStats('serializationSeconds', 1000);
  const processCpuSeconds = metricStats('processCpuSeconds');
  const processPeakRssMiB = statistics(
    samples.map((sample) =>
      sample.metrics.processPeakRssBytes / 1024 / 1024),
  );
  const kernelSeconds = metrics('totalSeconds');
  const speedup = sequentialTotalSeconds / kernelSeconds;
  return {
    mode: config.mode,
    workers: config.workers,
    repetitions: samples.length,
    httpLatencyMs,
    cppTotalMs: kernelTotalMs,
    movementMs,
    collisionMs,
    mpiCommunicationMs: communicationMs,
    serializationMs,
    processCpuSeconds,
    processCpuPercentOfOneCoreMedian:
      kernelSeconds > 0
        ? processCpuSeconds.median / kernelSeconds * 100
        : null,
    processPeakRssMiB,
    effectiveSerialRequestHz:
      1000 / Math.max(
        config.mode === 'mpi' ? 500 : 100,
        httpLatencyMs.median,
      ),
    speedup,
    efficiency: speedup / config.workers,
    collisions: samples[0].metrics.collisions,
    nodes: [...new Set(samples.flatMap((sample) => sample.nodes))],
  };
}

const results = new Map();
let referenceSignature;
for (let repetition = 0; repetition < repetitions; repetition += 1) {
  for (const config of executionModes) {
    const sample = await simulate(config, repetition);
    const signature = stateSignature(sample);
    if (referenceSignature === undefined) {
      referenceSignature = signature;
    } else if (signature !== referenceSignature) {
      throw new Error(
        `${config.mode}/${config.workers} diverged from the sequential ` +
        `reference on repetition ${repetition + 1}.`,
      );
    }
    const key = `${config.mode}/${config.workers}`;
    if (!results.has(key)) results.set(key, []);
    results.get(key).push(sample);
  }
}

const sequentialSamples = results.get('sequential/1');
const sequentialTotalSeconds = median(
  sequentialSamples.map((sample) => sample.metrics.totalSeconds),
);
const rows = executionModes.map((config) =>
  summarize(config, results.get(`${config.mode}/${config.workers}`),
    sequentialTotalSeconds));

console.log(JSON.stringify({
  scenario: {
    vehicles: vehicleCount,
    steps,
    deltaTime: 1 / 60,
    repetitions,
    matchingStatesAndCollisionPairs: true,
    host: {
      platform: process.platform,
      architecture: process.arch,
      logicalCpus: os.availableParallelism(),
      totalMemoryBytes: os.totalmem(),
    },
    notes: [
        'HTTP latency is client wall time; C++ timings exclude HTTP process startup.',
        'CPU seconds and peak RSS are measured inside the C++ process (MPI reports the maximum rank).',
        'effectiveSerialRequestHz is the theoretical cadence with the configured interval; it is not an FPS claim.',
    ],
  },
  results: rows,
}, null, 2));
