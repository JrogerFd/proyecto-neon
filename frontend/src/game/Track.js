import * as THREE from 'three';
import { getQualityProfile } from './QualityProfiles.js';
import { getTrackDefinition } from './TrackCatalog.js';

export const TRACK = Object.freeze({
  radius: 35,
  halfStraight: 45,
  width: 14,
  startZ: 0
});

const SAMPLE_COUNT = 600;
const curves = new Map();
const sampledTracks = new Map();
const trackLengths = new Map();

function elevationAt(progress, trackId) {
  const p = ((progress % 1) + 1) % 1;
  const wave = Math.sin(Math.PI * 2 * p);
  if (trackId === 'neon-city') {
    return 5.2 * Math.exp(-(((p - 0.16) / 0.055) ** 2)) +
      4.4 * Math.exp(-(((p - 0.43) / 0.06) ** 2)) +
      5.8 * Math.exp(-(((p - 0.68) / 0.045) ** 2)) -
      1.1 * Math.exp(-(((p - 0.84) / 0.045) ** 2));
  }
  if (trackId === 'cyber-desert') {
    return 2.7 * wave * wave * Math.sin(Math.PI * 4 * p) +
      4.3 * Math.exp(-(((p - 0.63) / 0.07) ** 2));
  }
  return 2.3 * wave * Math.sin(Math.PI * 8 * p) +
    5.8 * Math.exp(-(((p - 0.23) / 0.045) ** 2)) +
    6.6 * Math.exp(-(((p - 0.72) / 0.04) ** 2));
}

function bankAt(progress, trackId) {
  const p = ((progress % 1) + 1) % 1;
  const strength = trackId === 'plasma-circuit' ? 0.24 : 0.18;
  return strength * (
    Math.exp(-(((p - 0.25) / 0.08) ** 2)) -
    Math.exp(-(((p - 0.51) / 0.075) ** 2)) +
    0.7 * Math.exp(-(((p - 0.78) / 0.06) ** 2))
  );
}

function getCurve(trackId) {
  if (trackId === 'neon-city') return null;
  if (curves.has(trackId)) return curves.get(trackId);

  const definition = getTrackDefinition(trackId);
  const curve = new THREE.CatmullRomCurve3(
    definition.controls.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'catmullrom',
    0.35
  );
  curves.set(trackId, curve);
  return curve;
}

export function getTrackPoint(progress, trackId = 'neon-city') {
  const normalized = ((progress % 1) + 1) % 1;
  if (trackId !== 'neon-city') {
    const samples = getSampledTrack(trackId);
    const scaled = normalized * SAMPLE_COUNT;
    const index = Math.floor(scaled);
    const fraction = scaled - index;
    const first = samples[index];
    const second = samples[(index + 1) % SAMPLE_COUNT];
    return new THREE.Vector3(
      first.x + (second.x - first.x) * fraction,
      first.y + (second.y - first.y) * fraction,
      first.z + (second.z - first.z) * fraction
    );
  }

  const r = TRACK.radius;
  const h = TRACK.halfStraight;
  const straightLength = 2 * h;
  const curveLength = Math.PI * r;
  const totalLength = 2 * straightLength + 2 * curveLength;
  let distance = normalized * totalLength;

  if (distance < h) {
    return new THREE.Vector3(r, elevationAt(normalized, trackId), distance);
  }
  distance -= h;

  if (distance < curveLength) {
    const angle = distance / r;
    return new THREE.Vector3(
      r * Math.cos(angle),
      elevationAt(normalized, trackId),
      h + r * Math.sin(angle)
    );
  }
  distance -= curveLength;

  if (distance < straightLength) {
    return new THREE.Vector3(-r, elevationAt(normalized, trackId), h - distance);
  }
  distance -= straightLength;

  if (distance < curveLength) {
    const angle = Math.PI + distance / r;
    return new THREE.Vector3(
      r * Math.cos(angle),
      elevationAt(normalized, trackId),
      -h + r * Math.sin(angle)
    );
  }
  distance -= curveLength;
  return new THREE.Vector3(r, elevationAt(normalized, trackId), -h + distance);
}

function getSampledTrack(trackId) {
  if (sampledTracks.has(trackId)) return sampledTracks.get(trackId);
  const curve = getCurve(trackId);
  const samples = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
    const progress = index / SAMPLE_COUNT;
    const point = trackId === 'neon-city'
      ? getTrackPoint(progress, trackId)
      : curve.getPointAt(progress);
    point.y = elevationAt(progress, trackId);
    return point;
  });
  sampledTracks.set(trackId, samples);
  return samples;
}

export function getTrackTangent(progress, trackId = 'neon-city') {
  const before = getTrackPoint(progress - 0.0001, trackId);
  const after = getTrackPoint(progress + 0.0001, trackId);
  return after.sub(before).normalize();
}

export function getTrackSurface(progress, lateralOffset = 0, trackId = 'neon-city') {
  const point = getTrackPoint(progress, trackId);
  const tangent = getTrackTangent(progress, trackId);
  const horizontalLength = Math.hypot(tangent.x, tangent.z) || 1;
  const normal = new THREE.Vector3(
    tangent.z / horizontalLength,
    0,
    -tangent.x / horizontalLength
  );
  const bank = bankAt(progress, trackId);
  point.addScaledVector(normal, lateralOffset);
  point.y += lateralOffset * Math.sin(bank);
  return { point, tangent, bank };
}

export function getTrackLength(trackId = 'neon-city') {
  if (trackLengths.has(trackId)) return trackLengths.get(trackId);
  const samples = getSampledTrack(trackId);
  let length = 0;
  for (let index = 0; index < samples.length; index += 1) {
    length += samples[index].distanceTo(
      samples[(index + 1) % samples.length]
    );
  }
  trackLengths.set(trackId, length);
  return length;
}

export function getTrackBounds(trackId = 'neon-city') {
  const definition = getTrackDefinition(trackId);
  const samples = getSampledTrack(trackId);
  const halfWidth = definition.width / 2 + 8;
  const bounds = samples.reduce((result, point) => ({
    minX: Math.min(result.minX, point.x - halfWidth),
    maxX: Math.max(result.maxX, point.x + halfWidth),
    minZ: Math.min(result.minZ, point.z - halfWidth),
    maxZ: Math.max(result.maxZ, point.z + halfWidth)
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity
  });
  return bounds;
}

export function distanceToTrack(x, z, trackId = 'neon-city') {
  if (trackId === 'neon-city') {
    const r = TRACK.radius;
    const h = TRACK.halfStraight;
    if (z >= -h && z <= h) {
      return Math.min(Math.abs(x - r), Math.abs(x + r));
    }
    if (z > h) return Math.abs(Math.hypot(x, z - h) - r);
    return Math.abs(Math.hypot(x, z + h) - r);
  }

  const samples = getSampledTrack(trackId);
  let closestSquared = Infinity;
  for (let index = 0; index < samples.length; index += 1) {
    const start = samples[index];
    const end = samples[(index + 1) % samples.length];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const projection = THREE.MathUtils.clamp(
      ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared,
      0,
      1
    );
    const offsetX = x - start.x - dx * projection;
    const offsetZ = z - start.z - dz * projection;
    closestSquared = Math.min(
      closestSquared,
      offsetX * offsetX + offsetZ * offsetZ
    );
  }
  return Math.sqrt(closestSquared);
}

export function isOnTrack(x, z, trackId = 'neon-city') {
  return distanceToTrack(x, z, trackId) <=
    getTrackDefinition(trackId).width / 2;
}

function createTrackSurface(scene, trackId, quality) {
  const definition = getTrackDefinition(trackId);
  const profile = getQualityProfile(quality);
  const sampleCount = profile.id === 'low' ? 180 : profile.id === 'medium' ? 240 : 300;
  const vertices = [];
  const indices = [];
  const centerLine = [];
  const outer = [];
  const inner = [];

  for (let index = 0; index <= sampleCount; index += 1) {
    const progress = index / sampleCount;
    const { point, tangent } = getTrackSurface(progress, 0, trackId);
    const outerPoint = getTrackSurface(
      progress, definition.width / 2, trackId
    ).point;
    const innerPoint = getTrackSurface(
      progress, -definition.width / 2, trackId
    ).point;
    outerPoint.y += 0.02;
    innerPoint.y += 0.02;
    centerLine.push(point);
    outer.push(outerPoint);
    inner.push(innerPoint);
    vertices.push(
      outerPoint.x, outerPoint.y, outerPoint.z,
      innerPoint.x, innerPoint.y, innerPoint.z
    );
  }

  for (let index = 0; index < sampleCount; index += 1) {
    const first = index * 2;
    indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
  }

  const roadGeometry = new THREE.BufferGeometry();
  roadGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3)
  );
  roadGeometry.setIndex(indices);
  roadGeometry.computeVertexNormals();
  scene.add(new THREE.Mesh(
    roadGeometry,
    new THREE.MeshStandardMaterial({
      color: trackId === 'cyber-desert' ? 0x302820 : 0x171725,
      roughness: 0.78,
      metalness: trackId === 'plasma-circuit' ? 0.35 : 0.08,
      side: THREE.DoubleSide
    })
  ));
  createElevatedSupports(scene, trackId);

  const edgeMaterial = new THREE.MeshBasicMaterial({
    color: definition.accent
  });
  scene.add(new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(outer.slice(0, -1)),
    edgeMaterial
  ));
  scene.add(new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(inner.slice(0, -1)),
    new THREE.LineBasicMaterial({
      color: trackId === 'neon-city' ? 0xaa00ff : definition.accent
    })
  ));

  const barrierCount = Math.max(
    profile.id === 'low' ? 32 : 48,
    Math.floor((profile.id === 'low' ? 110 : 190) * profile.decorationDensity)
  );
  const barrierGeometry = new THREE.BoxGeometry(1.2, 1.15, 2.7);
  const barrierMaterial = new THREE.MeshStandardMaterial({
    color: 0x17152a,
    emissive: definition.accent,
    emissiveIntensity: 0.7,
    metalness: 0.7,
    roughness: 0.28
  });
  const barriers = new THREE.InstancedMesh(
    barrierGeometry,
    barrierMaterial,
    barrierCount * 2
  );
  const transform = new THREE.Object3D();
  let instance = 0;
  for (let index = 0; index < barrierCount; index += 1) {
    const progress = index / barrierCount;
    const point = getTrackPoint(progress, trackId);
    const tangent = getTrackTangent(progress, trackId);
    transform.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      tangent
    );
    for (const side of [-1, 1]) {
      const barrierPoint = getTrackSurface(
        progress,
        side * (definition.width / 2 + 1.25),
        trackId
      ).point;
      transform.position.set(
        barrierPoint.x,
        barrierPoint.y + 0.58,
        barrierPoint.z
      );
      transform.updateMatrix();
      barriers.setMatrixAt(instance, transform.matrix);
      barriers.setColorAt(
        instance,
        new THREE.Color(index % 2 ? definition.accent : 0x32174a)
      );
      instance += 1;
    }
  }
  barriers.instanceMatrix.needsUpdate = true;
  if (barriers.instanceColor) barriers.instanceColor.needsUpdate = true;
  scene.add(barriers);

  const start = getTrackPoint(0, trackId);
  const startTangent = getTrackTangent(0, trackId);
  const finish = new THREE.Mesh(
    new THREE.PlaneGeometry(definition.width, 2),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide
    })
  );
  finish.rotation.set(-Math.PI / 2, 0, 0);
  finish.rotation.y = Math.atan2(startTangent.x, startTangent.z);
  finish.position.copy(start);
  finish.position.y += 0.055;
  scene.add(finish);

  const checkpointGeometry = new THREE.BoxGeometry(
    definition.width,
    0.12,
    0.12
  );
  const checkpointMaterial = new THREE.MeshBasicMaterial({
    color: definition.accent
  });
  for (const progress of definition.checkpoints) {
    const gate = new THREE.Mesh(checkpointGeometry, checkpointMaterial);
    const point = getTrackSurface(progress, 0, trackId).point;
    const tangent = getTrackTangent(progress, trackId);
    gate.position.set(point.x, point.y + 0.15, point.z);
    gate.rotation.y = Math.atan2(tangent.x, tangent.z);
    scene.add(gate);
  }

  for (const zone of definition.zones) {
    addZoneSurface(scene, trackId, zone);
  }
  addTrackFeature(scene, trackId);
  createGroundAndScenery(scene, trackId, profile);
  return { trackId, definition, centerLine };
}

function createElevatedSupports(scene, trackId) {
  const definition = getTrackDefinition(trackId);
  const material = new THREE.MeshStandardMaterial({
    color: trackId === 'cyber-desert' ? 0x574331 : 0x15152a,
    metalness: 0.72,
    roughness: 0.35
  });
  const progressCount = trackId === 'plasma-circuit' ? 26 : 20;
  for (let index = 0; index < progressCount; index += 1) {
    const progress = (index + 0.5) / progressCount;
    const elevation = getTrackPoint(progress, trackId).y;
    if (elevation < 1.4) continue;
    for (const side of [-1, 1]) {
      const surface = getTrackSurface(
        progress,
        side * (definition.width / 2 + 0.9),
        trackId
      );
      const height = surface.point.y;
      if (height < 1.2) continue;
      const support = new THREE.Mesh(
        new THREE.BoxGeometry(0.72, height, 0.72),
        material
      );
      support.position.set(
        surface.point.x,
        height / 2,
        surface.point.z
      );
      support.rotation.y = Math.atan2(
        surface.tangent.x,
        surface.tangent.z
      );
      support.castShadow = true;
      scene.add(support);
    }
  }
}

function addZoneSurface(scene, trackId, zone) {
  const definition = getTrackDefinition(trackId);
  const segmentCount = 18;
  const positions = [];
  const indices = [];
  for (let index = 0; index <= segmentCount; index += 1) {
    const progress = zone.start +
      (zone.end - zone.start) * index / segmentCount;
    const halfWidth = definition.width * 0.42;
    const left = getTrackSurface(progress, halfWidth, trackId).point;
    const right = getTrackSurface(progress, -halfWidth, trackId).point;
    left.y += zone.type === 'ramp' ? 0.08 : 0.045;
    right.y += zone.type === 'ramp' ? 0.08 : 0.045;
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    if (index < segmentCount) {
      const current = index * 2;
      indices.push(current, current + 1, current + 2);
      indices.push(current + 1, current + 3, current + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const color = zone.type === 'sand'
    ? 0x9a7045
    : zone.type === 'boost'
      ? 0x00dffa
      : 0xff47d2;
  scene.add(new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: zone.type === 'sand' ? 0.04 : 0.85,
      roughness: 0.58,
      side: THREE.DoubleSide
    })
  ));

  if (zone.type === 'ramp') {
    const progress = (zone.start + zone.end) / 2;
    const point = getTrackSurface(progress, 0, trackId).point;
    const tangent = getTrackTangent(progress, trackId);
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(definition.width * 0.8, 0.42, 4),
      new THREE.MeshStandardMaterial({
        color: 0x26143f,
        emissive: color,
        emissiveIntensity: 0.9,
        metalness: 0.7,
        roughness: 0.25
      })
    );
    ramp.position.set(point.x, point.y + 0.22, point.z);
    ramp.rotation.set(-0.15, Math.atan2(tangent.x, tangent.z), 0);
    ramp.castShadow = true;
    scene.add(ramp);
  }
}

function addTrackFeature(scene, trackId) {
  const definition = getTrackDefinition(trackId);
  const progress = trackId === 'neon-city'
    ? 0.16
    : trackId === 'cyber-desert'
      ? 0.62
      : 0.82;
  const point = getTrackPoint(progress, trackId);
  const tangent = getTrackTangent(progress, trackId);
  const orientation = Math.atan2(tangent.x, tangent.z);
  const group = new THREE.Group();
  const structureMaterial = new THREE.MeshStandardMaterial({
    color: 0x15152a,
    metalness: 0.76,
    roughness: 0.24
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: definition.accent,
    emissive: definition.accent,
    emissiveIntensity: 1.5
  });
  const width = definition.width + 3;
  const uprightGeometry = new THREE.BoxGeometry(0.7, 7, 0.75);
  const beamGeometry = new THREE.BoxGeometry(width, 0.8, 0.9);
  for (const x of [-width / 2, width / 2]) {
    const upright = new THREE.Mesh(uprightGeometry, structureMaterial);
    upright.position.set(x, 3.2, 0);
    upright.castShadow = true;
    group.add(upright);
  }
  const beam = new THREE.Mesh(beamGeometry, structureMaterial);
  beam.position.y = 6.7;
  group.add(beam);
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.94, 0.12, 0.96),
    accentMaterial
  );
  strip.position.y = 6.25;
  group.add(strip);
  group.position.set(point.x, point.y, point.z);
  group.rotation.y = orientation;
  scene.add(group);

  if (trackId === 'neon-city') {
    const tunnelMaterial = new THREE.MeshStandardMaterial({
      color: 0x141326,
      emissive: definition.accent,
      emissiveIntensity: 0.38,
      metalness: 0.8
    });
    for (let index = 0; index < 7; index += 1) {
      const tunnelProgress = 0.76 + index * 0.012;
      const surface = getTrackSurface(tunnelProgress, 0, trackId);
      const tunnelFrame = new THREE.Group();
      const crossbar = new THREE.Mesh(
        new THREE.BoxGeometry(definition.width + 0.8, 0.55, 0.7),
        tunnelMaterial
      );
      crossbar.position.y = 5.2;
      tunnelFrame.add(crossbar);
      for (const side of [-1, 1]) {
        const support = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 5.2, 0.7),
          tunnelMaterial
        );
        support.position.set(
          side * (definition.width / 2 + 0.1),
          2.6,
          0
        );
        tunnelFrame.add(support);
      }
      tunnelFrame.position.copy(surface.point);
      tunnelFrame.rotation.set(
        Math.atan2(
          surface.tangent.y,
          Math.hypot(surface.tangent.x, surface.tangent.z)
        ),
        Math.atan2(surface.tangent.x, surface.tangent.z),
        surface.bank
      );
      scene.add(tunnelFrame);
    }
  }
}

function createGroundAndScenery(scene, trackId, profile) {
  const definition = getTrackDefinition(trackId);
  const bounds = getTrackBounds(trackId);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const width = Math.max(240, bounds.maxX - bounds.minX + 100);
  const depth = Math.max(240, bounds.maxZ - bounds.minZ + 100);
  const groundColor = trackId === 'cyber-desert' ? 0x33231a : 0x050510;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({
      color: groundColor,
      roughness: 0.95
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(centerX, -0.08, centerZ);
  scene.add(ground);

  const terrainGeometry = trackId === 'cyber-desert'
    ? new THREE.DodecahedronGeometry(1, 0)
    : new THREE.BoxGeometry(1, 1, 1);
  const terrainMaterial = new THREE.MeshStandardMaterial({
    color: trackId === 'cyber-desert' ? 0x73503a : 0x15152e,
    emissive: trackId === 'plasma-circuit' ? 0x251044 : 0x060610,
    roughness: 0.82,
    metalness: 0.2
  });
  const decorations = Math.floor((profile.id === 'low' ? 18 : 36) * profile.decorationDensity);
  const scenery = new THREE.InstancedMesh(
    terrainGeometry,
    terrainMaterial,
    decorations
  );
  const transform = new THREE.Object3D();
  const trackSamples = getSampledTrack(trackId);
  for (let index = 0; index < decorations; index += 1) {
    const progress = (index * 0.61803398875) % 1;
    const point = getTrackPoint(progress, trackId);
    const tangent = getTrackTangent(progress, trackId);
    const side = index % 2 ? 1 : -1;
    const offset = 15 + (index % 5) * 7;
    transform.position.set(
      point.x + tangent.z * side * offset,
      trackId === 'cyber-desert' ? 1.3 : 2 + (index % 7) * 1.8,
      point.z - tangent.x * side * offset
    );
    if (trackId === 'cyber-desert') {
      const scale = 1.8 + (index % 4) * 0.6;
      transform.scale.set(scale, scale * 0.9, scale * 1.1);
      transform.rotation.set(0, index * 1.7, 0);
    } else {
      const height = 8 + (index % 6) * 5;
      transform.scale.set(4 + (index % 3), height, 4 + (index % 3));
      transform.rotation.set(0, index * 0.37, 0);
    }
    transform.updateMatrix();
    scenery.setMatrixAt(index, transform.matrix);
  }
  scenery.instanceMatrix.needsUpdate = true;
  scene.add(scenery);

  const ambient = new THREE.HemisphereLight(
    trackId === 'cyber-desert' ? 0xffc475 : 0x96aaff,
    trackId === 'cyber-desert' ? 0x29170d : 0x110022,
    1.5
  );
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xe4f6ff, 2.4);
  keyLight.position.set(centerX + 15, 38, centerZ + 20);
  keyLight.castShadow = profile.shadows;
  keyLight.shadow.mapSize.set(
    profile.shadows ? profile.shadowMapSize : 256,
    profile.shadows ? profile.shadowMapSize : 256
  );
  keyLight.shadow.camera.near = 0.1;
  keyLight.shadow.camera.far = profile.fogFar;
  keyLight.shadow.camera.left = -40;
  keyLight.shadow.camera.right = 40;
  keyLight.shadow.camera.top = 40;
  keyLight.shadow.camera.bottom = -40;
  scene.add(keyLight);

  if (trackId !== 'cyber-desert') {
    const glow = new THREE.PointLight(
      new THREE.Color(definition.accent),
      90,
      160
    );
    const point = trackSamples[Math.floor(trackSamples.length * 0.18)];
    glow.position.set(point.x, 18, point.z);
    scene.add(glow);
  }
}

export function createTrack(scene, trackId = 'neon-city', quality = 'medium') {
  return createTrackSurface(scene, trackId, quality);
}
