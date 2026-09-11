import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { EffectivePerformanceQuality } from './performanceQuality';
import { isDevBuild } from './runtimeEnv';

/**
 * Runtime texture-quality tiers for the Carlotta VRM (Pass 2).
 *
 * Downscales ONLY the textures actually sampled by the loaded VRM materials
 * (collected as unique `material.map` entries, so shared textures are
 * processed exactly once). The original .vrm file is never modified.
 *
 * Safety properties:
 * - Same THREE.Texture object is kept; only `.image` is swapped + `needsUpdate`
 *   re-uploads it. No duplicate GPU textures, no texture disposal here
 *   (existing `carlottaVrmLoader.dispose()` still owns disposal), so no
 *   use-after-dispose and no double-dispose are possible.
 * - Original images are cached per VRM instance (WeakMap — collected with the
 *   VRM, never shared across loads), so Low→High restores full resolution
 *   without generational quality loss, and remounts start clean.
 * - Untouched: colorSpace, wrapping, filters, flipY, mipmaps (targets stay
 *   power-of-two), material assignments, transparency, geometry, skeleton.
 * - Runs only on VRM load / tier change — never per frame.
 */

const MAX_DIMENSION: Record<EffectivePerformanceQuality, number> = {
  high: Number.POSITIVE_INFINITY,
  medium: 1024,
  low: 512,
};

/**
 * Low-tier floor for alpha-sensitive maps (bound to at least one material
 * with transparency or alphaTest — e.g. the BLEND Face+/Eye+ overlays and
 * the MASK noseline/star layers, including maps shared with them).
 * Canvas resampling of alpha edges is the risk class behind Low-tier
 * black-region corruption; OPAQUE-only maps ignore alpha at upload and are
 * unaffected. Medium/High never go below this floor anyway.
 */
const LOW_ALPHA_SENSITIVE_FLOOR = 1024;

function capForTier(tier: EffectivePerformanceQuality, alphaSensitive: boolean): number {
  if (tier === 'low' && alphaSensitive) return LOW_ALPHA_SENSITIVE_FLOOR;
  return MAX_DIMENSION[tier];
}

interface SampledTexture {
  texture: THREE.Texture;
  /** True if any material sampling it uses transparency or alphaTest. */
  alphaSensitive: boolean;
}

/** Original decoded images per texture, scoped to one loaded VRM instance. */
const originalImages = new WeakMap<VRM, Map<THREE.Texture, THREE.Texture['image']>>();

function collectSampledTextures(vrm: VRM): SampledTexture[] {
  const unique = new Map<THREE.Texture, boolean>();
  vrm.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      const map = (mat as THREE.MeshBasicMaterial).map as THREE.Texture | null | undefined;
      if (!map || !map.image) continue;
      const material = mat as THREE.Material;
      const sensitive = material.transparent === true || material.alphaTest > 0;
      unique.set(map, (unique.get(map) ?? false) || sensitive);
    }
  });
  return [...unique.entries()].map(([texture, alphaSensitive]) => ({ texture, alphaSensitive }));
}

function imageDimensions(image: THREE.Texture['image']): { w: number; h: number } | null {
  const img = image as { width?: unknown; height?: unknown } | null;
  if (!img || typeof img.width !== 'number' || typeof img.height !== 'number') return null;
  if (img.width <= 0 || img.height <= 0) return null;
  return { w: img.width, h: img.height };
}

function downscaleImage(
  source: THREE.Texture['image'],
  w: number,
  h: number,
  targetMax: number,
): HTMLCanvasElement {
  const scale = targetMax / Math.max(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Approx RGBA8 bytes. Carlotta's sampled maps use Linear (non-mipmap)
 * minification, so no ×1.33 mipmap factor — clearly an estimate; actual GPU
 * memory is implementation-dependent.
 */
function estimateBytes(w: number, h: number): number {
  return Math.round(w * h * 4);
}

/**
 * Apply the texture tier to an already-loaded VRM. Idempotent per tier:
 * re-applying the same tier is a no-op for already-conforming textures.
 */
export function applyCarlottaTextureQuality(vrm: VRM, tier: EffectivePerformanceQuality): void {
  let cache = originalImages.get(vrm);
  if (!cache) {
    cache = new Map();
    originalImages.set(vrm, cache);
  }

  const textures = collectSampledTextures(vrm);
  let processed = 0;
  let restored = 0;
  let protectedCount = 0;
  let beforeBytes = 0;
  let afterBytes = 0;
  let maxBefore = 0;
  let maxAfter = 0;

  for (const { texture, alphaSensitive } of textures) {
    const targetMax = capForTier(tier, alphaSensitive);
    if (alphaSensitive && tier === 'low') protectedCount++;
    const original = cache.has(texture) ? cache.get(texture) : texture.image;
    if (!cache.has(texture)) cache.set(texture, texture.image);
    const dims = imageDimensions(original);
    if (!dims) continue;

    maxBefore = Math.max(maxBefore, dims.w, dims.h);
    beforeBytes += estimateBytes(dims.w, dims.h);

    if (Math.max(dims.w, dims.h) <= targetMax) {
      // Already conforming — but ensure a previous downscale is restored
      // when moving back up (e.g. Low → High).
      if (texture.image !== original) {
        texture.image = original;
        texture.needsUpdate = true;
        restored++;
      }
      const cur = imageDimensions(texture.image);
      if (cur) {
        maxAfter = Math.max(maxAfter, cur.w, cur.h);
        afterBytes += estimateBytes(cur.w, cur.h);
      }
      continue;
    }

    texture.image = downscaleImage(original, dims.w, dims.h, targetMax);
    texture.needsUpdate = true;
    processed++;
    const cur = imageDimensions(texture.image);
    if (cur) {
      maxAfter = Math.max(maxAfter, cur.w, cur.h);
      afterBytes += estimateBytes(cur.w, cur.h);
    }
  }

  if (isDevBuild()) {
    console.info(
      `[ZoyaQuality] textures tier=${tier} sampled=${textures.length} ` +
      `downscaled=${processed} restored=${restored} protected=${protectedCount} ` +
      `maxDim=${maxBefore}→${maxAfter} ` +
      `estVRAM=${(beforeBytes / 1048576).toFixed(1)}→${(afterBytes / 1048576).toFixed(1)}MB`
    );
  }
}
