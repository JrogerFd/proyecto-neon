import * as THREE from 'three';

export const QUALITY_PROFILES = Object.freeze({
  low: Object.freeze({
    id: 'low',
    label: 'Bajo',
    pixelRatio: 0.75,
    shadows: false,
    shadowMapSize: 512,
    decorationDensity: 0.35,
    maxParticles: 24,
    fogFar: 115,
    drawCallBudget: 420,
    toneMappingExposure: 1.02,
    shadowDistance: 28
  }),
  medium: Object.freeze({
    id: 'medium',
    label: 'Medio',
    pixelRatio: 1,
    shadows: true,
    shadowMapSize: 1024,
    decorationDensity: 0.65,
    maxParticles: 64,
    fogFar: 175,
    drawCallBudget: 720,
    toneMappingExposure: 1.15,
    shadowDistance: 42
  }),
  high: Object.freeze({
    id: 'high',
    label: 'Alto',
    pixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    decorationDensity: 1,
    maxParticles: 128,
    fogFar: 250,
    drawCallBudget: 1200,
    toneMappingExposure: 1.25,
    shadowDistance: 64
  })
});

export function getQualityProfile(id = 'medium') {
  return QUALITY_PROFILES[id] ?? QUALITY_PROFILES.medium;
}

export function applyRendererQuality(renderer, profileId) {
  const profile = getQualityProfile(profileId);
  renderer.setPixelRatio(
    Math.min(globalThis.devicePixelRatio || 1, profile.pixelRatio)
  );
  renderer.shadowMap.enabled = profile.shadows;
  const compatibleShadowType = THREE.PCFSoftShadowMap ?? THREE.PCFShadowMap;
  if (compatibleShadowType) {
    renderer.shadowMap.type = compatibleShadowType;
  }
  renderer.shadowMap.needsUpdate = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = profile.toneMappingExposure;
  if (renderer.shadowMap) {
    renderer.shadowMap.autoUpdate = profile.shadows;
  }
  if (renderer.info) {
    renderer.info.autoReset = true;
  }
  return profile;
}

export function getRendererPerformanceSnapshot(renderer) {
  if (!renderer?.info) return null;
  const memory = renderer.info.memory ?? {};
  return {
    renderCalls: renderer.info.render?.calls ?? 0,
    geometries: memory.geometries ?? 0,
    textures: memory.textures ?? 0,
    frame: renderer.info.render?.frame ?? 0
  };
}
