import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM } from '@pixiv/three-vrm';
import { isDevBuild } from './runtimeEnv';

/**
 * CarlottaVRMLoader — isolated VRM0 loader for the Carlotta migration (Phase 2).
 *
 * Side-by-side with the existing Mint FBX loader (`fbxLoader.ts`).
 * Does NOT touch Mint rendering, lip-sync, animation, camera, Groq, or TTS.
 *
 * Loading path: GLTFLoader + VRMLoaderPlugin (VRM0 `VRM` extension).
 * Result VRM exposes: scene, humanoid, expressionManager, lookAt, meta.
 */

export interface LoadedCarlottaModel {
  vrm: VRM;
  gltf: GLTF;
}

export const CARLOTTA_EXPRESSION_PRESETS = [
  'neutral', 'a', 'i', 'u', 'e', 'o', 'blink', 'blink_l', 'blink_r',
  'joy', 'angry', 'sorrow', 'fun', 'lookup', 'lookdown', 'lookleft', 'lookright',
] as const;

export type CarlottaExpressionPreset = (typeof CARLOTTA_EXPRESSION_PRESETS)[number];

const MTOON_NO_SHADOW_SHIFT = 2.0;

function disableMToonShading(model: LoadedCarlottaModel): void {
  model.vrm.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      const mtoon = mat as unknown as { shadingShiftFactor?: unknown };
      if (typeof mtoon.shadingShiftFactor !== 'number') continue;
      mtoon.shadingShiftFactor = MTOON_NO_SHADOW_SHIFT;
    }
  });
}

function disableMToonMatCapForPerfTest(model: LoadedCarlottaModel): void {
  if (!isDevBuild()) return;
  let cleared = 0;
  model.vrm.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      const mtoon = mat as unknown as { matcapTexture?: unknown };
      if (!('matcapTexture' in (mat as object))) continue;
      if (mtoon.matcapTexture === null || mtoon.matcapTexture === undefined) continue;
      try {
        mtoon.matcapTexture = null;
        cleared++;
      } catch {
        /* never break loading */
      }
    }
  });
  console.info(`[ZoyaMatCapTest] matcap textures cleared: materials=${cleared}`);
}

function diagnoseCarlottaMaterials(model: LoadedCarlottaModel): void {
  if (!isDevBuild()) return;
  const stats = { meshes: 0, materials: 0, mtoon: 0, transparent: 0, alphaTest: 0, maps: 0, normalMaps: 0, emissiveMaps: 0, shadeTextures: 0, rimLighting: 0, matcap: 0, outlines: 0 };
  model.vrm.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    stats.meshes++;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      stats.materials++;
      const mat = material as THREE.Material & Record<string, unknown>;
      if ('shadingShiftFactor' in mat || 'shadingToonyFactor' in mat) stats.mtoon++;
      if (mat.transparent === true) stats.transparent++;
      if (typeof mat.alphaTest === 'number' && mat.alphaTest > 0) stats.alphaTest++;
      if (mat.map) stats.maps++;
      if (mat.normalMap) stats.normalMaps++;
      if (mat.emissiveMap) stats.emissiveMaps++;
      if (mat.shadeTexture || mat.shadingTexture || mat.shadeMultiplyTexture) stats.shadeTextures++;
      if (mat.rimLightingMixFactor !== undefined || mat.rimColor !== undefined || mat.rimMultiplyTexture !== undefined) stats.rimLighting++;
      if (mat.matcapTexture !== undefined || mat.matcapFactor !== undefined || mat.matcap !== undefined) stats.matcap++;
      if (mat.outlineWidthMode !== undefined || mat.outlineWidthFactor !== undefined || mat.outlineWidthMultiplyTexture !== undefined) stats.outlines++;
    }
  });
  console.log('[ZoyaMToonDiagnostic]', stats);
}

function createLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return loader;
}

function extractVrm(gltf: GLTF, source: string): LoadedCarlottaModel {
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) {
    throw new Error(`[CarlottaVRM] No VRM found in "${source}". VRMLoaderPlugin did not produce userData.vrm — file may not be VRM0.`);
  }
  logExpressionInventory(vrm, source);
  return { vrm, gltf };
}

function logExpressionInventory(vrm: VRM, source: string): void {
  if (!isDevBuild()) return;
  try {
    const manager = vrm.expressionManager as unknown as { presetExpressionMap?: Record<string, unknown>; customExpressionMap?: Record<string, unknown> } | null;
    const presets = manager ? Object.keys(manager.presetExpressionMap ?? {}) : [];
    const customs = manager ? Object.keys(manager.customExpressionMap ?? {}) : [];
    console.info(`[CarloExpressions] source="${source}" available presets: [${presets.join(', ')}]`);
    console.info(`[CarloExpressions] source="${source}" available custom expressions: [${customs.join(', ')}]`);
  } catch {
    /* inventory must never break loading */
  }
}

/**
 * Carlotta is a VRM0 character authored facing -Z. ZOYA's existing camera is
 * on +Z and therefore sees the character's back unless the VRM root is turned
 * 180 degrees around Y. Keep this correction on the VRM root so humanoid bone
 * local axes, procedural idle, gestures, expressions, and lip-sync are untouched.
 */
function orientCarlottaForZoya(model: LoadedCarlottaModel): void {
  model.vrm.scene.rotation.set(0, Math.PI, 0);
  model.vrm.scene.updateMatrixWorld(true);
}

export class CarlottaVRMLoader {
  public async loadVRMFromUrl(url: string): Promise<LoadedCarlottaModel> {
    const loader = createLoader();
    const gltf = await loader.loadAsync(url);
    console.log(`[CarlottaVRM] VRM loaded from: ${url}`);
    const model = extractVrm(gltf, url);
    orientCarlottaForZoya(model);
    disableMToonShading(model);
    disableMToonMatCapForPerfTest(model);
    diagnoseCarlottaMaterials(model);
    return model;
  }

  public async loadVRMFromFile(file: File): Promise<LoadedCarlottaModel> {
    const loader = createLoader();
    const url = URL.createObjectURL(file);
    try {
      const gltf = await loader.loadAsync(url);
      console.log(`[CarlottaVRM] Parsed uploaded file: ${file.name}`);
      const model = extractVrm(gltf, file.name);
      orientCarlottaForZoya(model);
      disableMToonShading(model);
      disableMToonMatCapForPerfTest(model);
      diagnoseCarlottaMaterials(model);
      return model;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  public listExpressions(model: LoadedCarlottaModel): Record<string, number> {
    const manager = model.vrm.expressionManager;
    if (!manager) return {};
    const out: Record<string, number> = {};
    for (const preset of CARLOTTA_EXPRESSION_PRESETS) {
      const expr = manager.getExpression(preset);
      if (expr) out[preset] = manager.getValue(preset);
    }
    return out;
  }

  public update(model: LoadedCarlottaModel, delta: number): void {
    model.vrm.update(delta);
  }

  public dispose(model: LoadedCarlottaModel): void {
    model.vrm.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
      if (geometry) geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of materials) {
        const m = mat as THREE.Material & { map?: THREE.Texture | null; dispose?: () => void };
        if (m.map) m.map.dispose();
        if (typeof m.dispose === 'function') m.dispose();
      }
    });
  }
}

export const carlottaVrmLoader = new CarlottaVRMLoader();
