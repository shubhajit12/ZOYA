/**
 * Centralized performance quality system for Zoya (Carlotta low-end audit follow-up).
 *
 * Two concepts (kept deliberately separate):
 * - User setting: 'auto' | 'high' | 'medium' | 'low' (persisted in UserSettings)
 * - Effective runtime quality: 'high' | 'medium' | 'low' (actually applied)
 *
 * If the user selects Auto, a lightweight capability detector picks the
 * effective tier. Manual High/Medium/Low is always respected and never
 * overridden. Detection is cheap, synchronous and non-invasive: no benchmark,
 * no GPU stress, no large temporary allocations. Unknown signals fall back
 * to 'medium' (conservative by design).
 *
 * Profile fields for future phases (textureQuality, springBoneQuality) are
 * declared here for extensibility but are NOT applied anywhere yet.
 */

export type PerformanceQualitySetting = 'auto' | 'high' | 'medium' | 'low';
export type EffectivePerformanceQuality = 'high' | 'medium' | 'low';

export interface QualityProfile {
  /** Hard cap for renderer pixel ratio. Effective ratio is always
   *  min(devicePixelRatio, pixelRatioCap). */
  pixelRatioCap: number;
  /** Applied at WebGLRenderer creation only (cannot be toggled safely later). */
  antialias: boolean;
  /** Shadow-map work. Currently no shadow casters exist, so all tiers are off. */
  shadowsEnabled: boolean;
  /**
   * Render/update frame-rate target. 0 = uncapped (display-limited rAF).
   * Otherwise the loop renders at most this many frames/second, passing
   * accumulated delta to updates so motion stays correct (no slow-motion).
   */
  targetFps: number;
  /** Reserved for a future phase — NOT applied. */
  springBoneQuality: 'full' | 'reduced';
  /** Texture max-dimension tier, applied by carlottaTextureQuality. */
  textureQuality: 'full' | 'medium' | 'low';
  /**
   * Maximum VRM spring-bone simulation updates per second. 0 = uncapped
   * (every rendered frame). Spring-bone runs on its own accumulator so it
   * can update less frequently than the render loop without slow-motion.
   * Hair/dress still move; they just interpolate between physics steps.
   *
   * Carlotta has 392 spring-bone nodes (Hair: 126, Bust: 26, Dress: 240).
   * Throttling to 20 Hz on Low halves simulation cost vs 30 Hz rendering.
   */
  springBoneUpdateFps: number;
}

export const QUALITY_PROFILES: Record<EffectivePerformanceQuality, QualityProfile> = {
  high: {
    pixelRatioCap: 2.0,
    antialias: true,
    shadowsEnabled: false,
    targetFps: 0,
    springBoneQuality: 'full',
    textureQuality: 'full',
    springBoneUpdateFps: 0, // uncapped — full quality
  },
  medium: {
    // Low-resource Medium: keep the same lightweight 1x pixel ratio and
    // disabled antialiasing policy as Low. High remains the only tier with
    // the higher-resolution/AA renderer configuration.
    pixelRatioCap: 1.0,
    antialias: false,
    shadowsEnabled: false,
    targetFps: 60,
    springBoneQuality: 'full',
    textureQuality: 'medium',
    springBoneUpdateFps: 0, // uncapped — preserve hair/dress quality at 60 FPS
  },
  low: {
    pixelRatioCap: 1.0,
    antialias: false,
    shadowsEnabled: false,
    targetFps: 30,
    springBoneQuality: 'reduced',
    textureQuality: 'low',
    springBoneUpdateFps: 20, // throttle to 20 Hz (vs 30 Hz render) — ~33% CPU reduction
  },
};

export function isValidQualitySetting(value: unknown): value is PerformanceQualitySetting {
  return value === 'auto' || value === 'high' || value === 'medium' || value === 'low';
}

/**
 * Lightweight first-launch capability estimate. Conservative thresholds;
 * returns 'medium' whenever information is unavailable or anything throws.
 */
export function detectEffectiveQuality(): EffectivePerformanceQuality {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return 'medium';
    }
    const nav = navigator as Navigator & { deviceMemory?: unknown };
    const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null;
    const deviceMemory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
    const dpr = typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : null;
    const ua = typeof nav.userAgent === 'string' ? nav.userAgent : '';
    const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);

    // Clearly constrained devices → low.
    if (cores !== null && cores <= 2) return 'low';
    if (deviceMemory !== null && deviceMemory <= 3) return 'low';
    if (isMobile && (cores === null || cores < 6)) return 'low';

    // Clearly capable desktop-class devices → high.
    if (!isMobile && cores !== null && cores >= 8 && (deviceMemory === null || deviceMemory >= 6)) {
      return 'high';
    }

    // High-DPR small screens without strong signals stay conservative.
    if (dpr !== null && dpr >= 3 && (cores === null || cores < 8)) {
      return 'medium';
    }

    return 'medium';
  } catch {
    return 'medium';
  }
}

/** Resolve the profile actually applied for a user setting. */
export function resolveEffectiveQuality(setting: PerformanceQualitySetting): EffectivePerformanceQuality {
  if (setting === 'high' || setting === 'medium' || setting === 'low') {
    return setting;
  }
  return detectEffectiveQuality();
}

/** Effective pixel ratio for a tier on this device (never exceeds the cap). */
export function effectivePixelRatioFor(tier: EffectivePerformanceQuality): number {
  const cap = QUALITY_PROFILES[tier].pixelRatioCap;
  const dpr = typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
    ? window.devicePixelRatio
    : 1;
  return Math.min(dpr || 1, cap);
}

/**
 * Tiered frame pacer: caps rendered frames/second to cut render + update
 * cost on weak hardware. Zero per-frame allocation; pure time math.
 *
 * Usage: feed every rAF delta; when `render` is false, skip all updates
 * AND the render for this tick (but still request the next frame). When
 * true, advance the app by the returned accumulated `dt` so motion,
 * smoothing, and audio-driven systems stay correct (no slow-motion).
 * Backlog beyond a few intervals is dropped (brief slow-motion beats an
 * allocation/GC spiral after tab hitches).
 */
export class FramePacer {
  private targetFps = 0;
  private acc = 0;

  public setTargetFps(fps: number): void {
    this.targetFps = Number.isFinite(fps) && fps > 0 ? fps : 0;
    this.acc = 0;
  }

  public getTargetFps(): number {
    return this.targetFps;
  }

  public accumulate(rawDt: number): { render: boolean; dt: number } {
    const dt = Number.isFinite(rawDt) && rawDt > 0 ? Math.min(rawDt, 0.25) : 0;
    if (this.targetFps <= 0) return { render: true, dt };
    const interval = 1 / this.targetFps;
    this.acc += dt;
    if (this.acc < interval) return { render: false, dt: 0 };
    // Consume backlog but never more than a few intervals (spiral guard).
    const consumed = Math.min(this.acc, interval * 4);
    this.acc -= consumed;
    if (this.acc > interval * 4) this.acc = 0;
    return { render: true, dt: consumed };
  }
}
