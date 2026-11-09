import * as THREE from 'three';
import { getVehicle } from './VehicleCatalog.js';

const PROFILE_SEGMENTS = 8;
const SHARED_GEOMETRIES = Object.freeze({
  tire: new THREE.CylinderGeometry(0.43, 0.43, 0.27, 24),
  rim: new THREE.CylinderGeometry(0.275, 0.275, 0.285, 24),
  cap: new THREE.CylinderGeometry(0.19, 0.19, 0.29, 20),
  hub: new THREE.SphereGeometry(0.085, 12, 8),
  spoke: new THREE.BoxGeometry(0.045, 0.39, 0.055),
  arch: new THREE.TorusGeometry(0.53, 0.085, 8, 24, Math.PI),
  counterweight: new THREE.CylinderGeometry(0.1, 0.16, 0.38, 12),
  wheelAxis: new THREE.CylinderGeometry(0.09, 0.1, 0.22, 12)
});

const SHARED_MATERIALS = Object.freeze({
  tire: new THREE.MeshStandardMaterial({
    color: 0x11131b,
    roughness: 0.86,
    metalness: 0.12
  }),
  rim: new THREE.MeshStandardMaterial({
    color: 0x8492a8,
    metalness: 0.88,
    roughness: 0.22
  }),
  spoke: new THREE.MeshStandardMaterial({
    color: 0xd5e0ef,
    metalness: 0.8,
    roughness: 0.23
  }),
  hub: new THREE.MeshStandardMaterial({
    color: 0x00d9f5,
    metalness: 0.65,
    roughness: 0.2
  }),
  arch: new THREE.MeshStandardMaterial({
    color: 0x111522,
    metalness: 0.75,
    roughness: 0.28
  })
});

function profileGeometry(stations) {
  const positions = [];
  const indices = [];
  for (const [z, width, bottom, top] of stations) {
    const points = [
      [-width * 0.72, bottom],
      [-width, bottom + 0.16],
      [-width, top - 0.12],
      [-width * 0.72, top],
      [width * 0.72, top],
      [width, top - 0.12],
      [width, bottom + 0.16],
      [width * 0.72, bottom]
    ];
    for (const [x, y] of points) positions.push(x, y, z);
  }
  for (let station = 0; station < stations.length - 1; station += 1) {
    for (let segment = 0; segment < PROFILE_SEGMENTS; segment += 1) {
      const current = station * PROFILE_SEGMENTS + segment;
      const next = station * PROFILE_SEGMENTS +
        ((segment + 1) % PROFILE_SEGMENTS);
      const after = current + PROFILE_SEGMENTS;
      const afterNext = next + PROFILE_SEGMENTS;
      indices.push(current, next, after, next, afterNext, after);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeProfile(vehicle, stations, widthScale, heightScale = 1) {
  const halfWidth = vehicle.width / 2;
  return stations.map(([zRatio, widthRatio, bottom, top]) => [
    zRatio * vehicle.length,
    halfWidth * widthRatio * widthScale,
    bottom,
    top * heightScale
  ]);
}

function addMesh(parent, geometry, material, position = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addWheel(car, vehicle, x, z, style) {
  const pivot = new THREE.Group();
  pivot.position.set(x, vehicle.rideHeight + 0.03, z);
  car.add(pivot);
  const spin = new THREE.Group();
  pivot.add(spin);

  const tire = addMesh(spin, SHARED_GEOMETRIES.tire, SHARED_MATERIALS.tire, [0, 0, 0]);
  tire.rotation.z = Math.PI / 2;

  const rim = addMesh(spin, SHARED_GEOMETRIES.rim, SHARED_MATERIALS.rim);
  rim.rotation.z = Math.PI / 2;

  if (style === 'disc') {
    const cap = addMesh(
      spin,
      SHARED_GEOMETRIES.cap,
      new THREE.MeshStandardMaterial({
        color: 0x263244,
        metalness: 0.9,
        roughness: 0.18
      })
    );
    cap.rotation.z = Math.PI / 2;
  } else {
    const spokeCount = style === 'split' ? 10 : 6;
    for (let index = 0; index < spokeCount; index += 1) {
      const angle = index * Math.PI * 2 / spokeCount;
      const spoke = addMesh(spin, SHARED_GEOMETRIES.spoke, SHARED_MATERIALS.spoke);
      spoke.position.set(0, Math.sin(angle) * 0.12, Math.cos(angle) * 0.12);
      spoke.rotation.x = angle;
    }
  }

  const hub = addMesh(spin, SHARED_GEOMETRIES.hub, SHARED_MATERIALS.hub);
  hub.scale.set(0.55, 1, 1);
  return { pivot, spin, tireRadius: 0.43 };
}

export function createCar(vehicleId = 'neon-starter', options = {}) {
  const vehicle = getVehicle(vehicleId);
  const customization = options.customization ?? {};
  const bodyColor = options.bodyColor ?? customization.bodyColor ??
    vehicle.bodyColor;
  const neonColor = options.neonColor ?? customization.neonColor ??
    options.colorHex ?? vehicle.neonColor;
  const wheelStyle = customization.wheelStyle ?? 'turbine';
  const spoilerStyle = customization.spoiler === 'factory'
    ? vehicle.spoiler
    : customization.spoiler ?? vehicle.spoiler;
  const car = new THREE.Group();
  car.name = `vehicle-${vehicle.id}`;
  car.userData.vehicleId = vehicle.id;
  car.userData.wheelAssemblies = [];
  car.userData.frontWheels = [];
  car.userData.brakeLights = [];
  car.userData.nitroLights = [];
  car.userData.wheelbase = vehicle.wheelbase;

  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: bodyColor,
    metalness: 0.7,
    roughness: 0.24,
    clearcoat: 0.85,
    clearcoatRoughness: 0.2
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: 0x111522,
    metalness: 0.75,
    roughness: 0.28
  });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x07121e,
    metalness: 0.52,
    roughness: 0.1,
    clearcoat: 1,
    transparent: true,
    opacity: 0.94
  });
  const neonMaterial = new THREE.MeshStandardMaterial({
    color: neonColor,
    emissive: neonColor,
    emissiveIntensity: 1.8,
    metalness: 0.28,
    roughness: 0.22
  });
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: 0xcdfbff,
    emissive: 0x65efff,
    emissiveIntensity: 2.6
  });
  const brakeMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a0712,
    emissive: 0xff142e,
    emissiveIntensity: 0.22
  });

  const halfLength = vehicle.length / 2;
  const bodyStations = [
    [-0.5, vehicle.noseWidth, vehicle.rideHeight, vehicle.rideHeight + 0.13],
    [-0.38, 0.39, vehicle.rideHeight, 0.74],
    [-0.16, 0.48, vehicle.rideHeight, 0.78],
    [0.2, 0.5, vehicle.rideHeight, 0.73],
    [0.4, vehicle.tailWidth * 0.5, vehicle.rideHeight, 0.82],
    [0.5, vehicle.tailWidth * 0.43, vehicle.rideHeight, 0.7]
  ];
  addMesh(
    car,
    profileGeometry(makeProfile(vehicle, bodyStations, 1)),
    bodyMaterial
  );

  const cabinStart = vehicle.cabinOffset - vehicle.cabinLength / 2;
  const cabinEnd = vehicle.cabinOffset + vehicle.cabinLength / 2;
  const cabin = new THREE.Group();
  cabin.position.z = vehicle.cabinOffset;
  const cabinStations = [
    [-0.5, 0.78, 0.72, vehicle.cabinHeight * 0.86],
    [-0.28, 1, 0.74, vehicle.cabinHeight],
    [0.25, 0.98, 0.74, vehicle.cabinHeight],
    [0.5, 0.75, 0.72, vehicle.cabinHeight * 0.88]
  ].map(([z, width, bottom, top]) => [
    z * vehicle.cabinLength,
    vehicle.cabinWidth * width,
    bottom,
    top
  ]);
  addMesh(cabin, profileGeometry(cabinStations), bodyMaterial);
  const glassStations = [
    [-0.34, 0.78, 0.83, vehicle.cabinHeight * 0.85],
    [-0.2, 0.91, 0.84, vehicle.cabinHeight * 0.94],
    [0.2, 0.9, 0.84, vehicle.cabinHeight * 0.94],
    [0.35, 0.72, 0.82, vehicle.cabinHeight * 0.84]
  ].map(([z, width, bottom, top]) => [
    z * vehicle.cabinLength,
    vehicle.cabinWidth * width,
    bottom,
    top
  ]);
  addMesh(cabin, profileGeometry(glassStations), glassMaterial);
  car.add(cabin);

  const windshield = addMesh(
    car,
    new THREE.BoxGeometry(vehicle.cabinWidth * 1.55, 0.035, 0.66),
    glassMaterial,
    [0, vehicle.cabinHeight * 0.82, cabinStart + 0.38]
  );
  windshield.rotation.x = -0.25;
  const rearGlass = addMesh(
    car,
    new THREE.BoxGeometry(vehicle.cabinWidth * 1.45, 0.035, 0.48),
    glassMaterial,
    [0, vehicle.cabinHeight * 0.8, cabinEnd - 0.28]
  );
  rearGlass.rotation.x = 0.3;

  const hood = addMesh(
    car,
    new THREE.BoxGeometry(
      vehicle.width * vehicle.noseWidth * 0.84,
      0.07,
      vehicle.length * 0.22
    ),
    bodyMaterial,
    [0, 0.76, -halfLength * 0.32]
  );
  hood.rotation.x = 0.035;

  const skirtGeometry = new THREE.BoxGeometry(0.1, 0.16, vehicle.wheelbase);
  for (const side of [-1, 1]) {
    addMesh(
      car,
      skirtGeometry,
      trimMaterial,
      [side * (vehicle.width * 0.47), vehicle.rideHeight + 0.13, 0.02]
    );
    const accent = addMesh(
      car,
      new THREE.BoxGeometry(0.055, 0.045, vehicle.wheelbase * 0.83),
      neonMaterial,
      [side * (vehicle.width * 0.49), vehicle.rideHeight + 0.2, 0.02]
    );
    accent.userData.isNeon = true;
  }

  const wheelZ = vehicle.wheelbase / 2;
  const wheelX = vehicle.width * vehicle.wheelOffset / 2;
  const wheelPositions = [
    [-wheelX, -wheelZ, true],
    [wheelX, -wheelZ, true],
    [-wheelX, wheelZ, false],
    [wheelX, wheelZ, false]
  ];
  for (const [x, z, isFront] of wheelPositions) {
    const assembly = addWheel(car, vehicle, x, z, wheelStyle);
    car.userData.wheelAssemblies.push(assembly);
    if (isFront) car.userData.frontWheels.push(assembly);

    const arch = new THREE.Mesh(
      SHARED_GEOMETRIES.arch,
      SHARED_MATERIALS.arch
    );
    arch.rotation.y = Math.PI / 2;
    arch.position.set(x * 0.96, vehicle.rideHeight + 0.04, z);
    car.add(arch);
  }

  const noseZ = -halfLength + 0.04;
  for (const side of [-1, 1]) {
    addMesh(
      car,
      new THREE.BoxGeometry(0.48, 0.11, 0.12),
      lampMaterial,
      [side * vehicle.width * 0.3, 0.68, noseZ]
    );
    const brake = addMesh(
      car,
      new THREE.BoxGeometry(0.5, 0.12, 0.1),
      brakeMaterial,
      [side * vehicle.width * 0.31, 0.67, halfLength - 0.02]
    );
    car.userData.brakeLights.push(brake.material);
  }

  const frontBumper = addMesh(
    car,
    new THREE.BoxGeometry(vehicle.width * 0.88, 0.17, 0.22),
    trimMaterial,
    [0, 0.43, -halfLength + 0.08]
  );
  frontBumper.rotation.x = -0.08;
  addMesh(
    car,
    new THREE.BoxGeometry(vehicle.width * 0.8, 0.12, 0.2),
    trimMaterial,
    [0, 0.42, halfLength - 0.06]
  );

  const diffuser = addMesh(
    car,
    new THREE.BoxGeometry(vehicle.width * 0.72, 0.15, 0.46),
    trimMaterial,
    [0, 0.35, halfLength - 0.24]
  );
  diffuser.rotation.x = 0.12;
  for (const x of [-0.25, 0, 0.25]) {
    addMesh(
      car,
      SHARED_GEOMETRIES.wheelAxis,
      new THREE.MeshStandardMaterial({
        color: 0x9ca6b7,
        metalness: 0.92,
        roughness: 0.25
      }),
      [x, 0.49, halfLength - 0.08]
    ).rotation.x = Math.PI / 2;
  }

  if (options.livery === 'racing-stripe' ||
      customization.livery === 'racing-stripe') {
    for (const x of [-0.17, 0.17]) {
      addMesh(
        car,
        new THREE.BoxGeometry(0.075, 0.025, vehicle.length * 0.75),
        neonMaterial,
        [x, 0.79, 0]
      );
    }
  } else if (options.livery === 'circuit-lines' ||
      customization.livery === 'circuit-lines') {
    for (const side of [-1, 1]) {
      addMesh(
        car,
        new THREE.BoxGeometry(0.035, 0.035, vehicle.length * 0.68),
        neonMaterial,
        [side * vehicle.width * 0.4, 0.68, 0.03]
      );
    }
  }

  if (spoilerStyle !== 'none') {
    const wingWidth = spoilerStyle === 'large'
      ? vehicle.width * 1.12
      : vehicle.width * 0.84;
    const wingZ = halfLength - 0.48;
    for (const x of [-wingWidth * 0.34, wingWidth * 0.34]) {
      addMesh(
        car,
        new THREE.BoxGeometry(0.07, 0.52, 0.08),
        trimMaterial,
        [x, 0.94, wingZ]
      );
    }
    addMesh(
      car,
      new THREE.BoxGeometry(wingWidth, 0.1, 0.32),
      bodyMaterial,
      [0, 1.2, wingZ]
    );
    addMesh(
      car,
      new THREE.BoxGeometry(wingWidth * 0.82, 0.055, 0.08),
      neonMaterial,
      [0, 1.14, wingZ + 0.08]
    );
  }

  for (const x of [-0.23, 0.23]) {
    const exhaust = addMesh(
      car,
      SHARED_GEOMETRIES.counterweight,
      new THREE.MeshBasicMaterial({
        color: neonColor,
        transparent: true,
        opacity: 0
      }),
      [x, 0.48, halfLength + 0.12]
    );
    exhaust.rotation.x = Math.PI / 2;
    car.userData.nitroLights.push(exhaust.material);
  }

  return car;
}

export function updateCarVisuals(
  car,
  { delta = 0, speed = 0, steering = 0, braking = false, nitro = false } = {}
) {
  if (!car?.userData?.wheelAssemblies) return;
  const distancePerSecond = Math.abs(speed) * 60;
  for (const wheel of car.userData.wheelAssemblies) {
    wheel.spin.rotation.x -= distancePerSecond * delta / wheel.tireRadius;
  }
  for (const wheel of car.userData.frontWheels) {
    wheel.pivot.rotation.y = steering * 0.35;
  }
  for (const material of car.userData.brakeLights) {
    material.emissiveIntensity = braking ? 2.5 : 0.22;
  }
  for (const material of car.userData.nitroLights) {
    material.opacity = nitro ? 0.94 : 0;
  }
  car.scale.y = 1 + (nitro ? 0.018 : 0);
}
