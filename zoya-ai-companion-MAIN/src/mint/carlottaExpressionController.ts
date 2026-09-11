import type { VRM } from '@pixiv/three-vrm';
import {
  carlottaAnimationController,
  type CarlottaEmotion,
} from './carlottaAnimationController';
import { isDevBuild } from './runtimeEnv';

/**
 * CarlottaExpressionController — facial-expression follower for the
 * persistent body-emotion layer (Pass 4).
 *
 * Reads the EXISTING emotion semantics from CarlottaAnimationController
 * (target emotion + smoothed intensity) and mirrors them onto VRM facial
 * expression presets. It owns NO emotion state of its own: no second state
 * machine, no behavior control, no body bones.
 *
 * Coexistence rules (hard):
 * - Writes ONLY neutral/relaxed/happy/sad/angry. NEVER aa/ih/ou/ee/oh
 *   (lip-sync), blink*, or look* — those belong to other systems.
 * - Only ever calls expressionManager.setValue on controlled presets that
 *   were confirmed present at bind time.
 * - `update()` must run BEFORE `vrm.update(delta)` (same frame as lip-sync)
 *   so weights apply in the expression pass; body animation order untouched.
 *
 * Performance: smoothed weights in fixed fields (no per-frame allocation),
 * manager cached at bind, missing presets skipped, frame-rate independent
 * exponential smoothing (~1s feel, matching the body emotion layer).
 */

type ControlledPreset = 'neutral' | 'relaxed' | 'happy' | 'sad' | 'angry';

const CONTROLLED_PRESETS: ControlledPreset[] = ['neutral', 'relaxed', 'happy', 'sad', 'angry'];

/** Runtime presets permanently owned by other systems — never diagnosed. */
export const PHONEME_PRESETS: readonly string[] = ['aa', 'ih', 'ou', 'ee', 'oh'];
export const BLINK_PRESETS: readonly string[] = ['blink', 'blinkLeft', 'blinkRight'];
export const LOOK_PRESETS: readonly string[] = ['lookUp', 'lookDown', 'lookLeft', 'lookRight'];

/** Name-level safety: not a phoneme/blink/look preset. */
export function isSafeDiagnosticName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    !PHONEME_PRESETS.includes(name) &&
    !BLINK_PRESETS.includes(name) &&
    !LOOK_PRESETS.includes(name)
  );
}

/** Conservative starting weights per emotion (scaled by intensity). */
const EMOTION_PRESET_WEIGHTS: Record<CarlottaEmotion, Partial<Record<ControlledPreset, number>>> = {
  calm: { neutral: 0.3, relaxed: 0.25 },
  happy: { happy: 0.7 },
  excited: { happy: 0.9 },
  sad: { sad: 0.7 },
  angry: { angry: 0.7 },
};

/** Weight glide speed (~1s to settle, matching the body emotion feel). */
const WEIGHT_BLEND_SPEED = 2.5;

/** Default diagnostic test weight (matches the emotion mapping scale). */
const DIAGNOSTIC_DEFAULT_WEIGHT = 0.7;

/** Read runtime expression keys via the public manager getter (no internals). */
function readRuntimeExpressionKeys(
  manager: { expressionMap?: Record<string, unknown> } | null,
): string[] {
  try {
    if (manager?.expressionMap) return Object.keys(manager.expressionMap);
  } catch {
    /* fall through to empty */
  }
  return [];
}

interface ExpressionManagerLike {
  getExpression(name: string): unknown;
  setValue(name: string, weight: number): void;
}

class CarlottaExpressionController {
  private manager: ExpressionManagerLike | null = null;
  /**
   * Presence + smoothed weights, keyed dynamically. Always contains the
   * production controlled presets; any extra runtime-safe presets discovered
   * at bind are added. `writeList` is the stable per-frame iteration order
   * (controlled first, extras alphabetical) — built once at bind, never
   * per frame.
   */
  private present: Record<string, boolean> = {};
  private weights: Record<string, number> = {};
  private writeList: string[] = [];
  /** Runtime-discovered safe presets (excludes phonemes/blink/look). */
  private safePresets: string[] = [];
  private initialized = false;
  /**
   * DEV-only diagnostic override (capability discovery). While set, the
   * overridden preset is written at the fixed weight every frame instead of
   * following emotion; all other presets keep following emotion. Never
   * touched in production (no hook exists there to set it).
   */
  private diagOverride: { preset: string; weight: number } | null = null;
  /**
   * DEV-only multi-expression recipe (capability discovery). Partial map;
   * omitted safe expressions are 0. Takes precedence over the
   * single-expression override while active. Production path (null) is
   * untouched.
   */
  private diagRecipe: Record<string, number> | null = null;

  /** Bind to a loaded VRM; re-bind cleanly per model. */
  public init(vrm: VRM | null): void {
    this.reset();
    if (!vrm) return;
    const manager = vrm.expressionManager as unknown as ExpressionManagerLike | null;
    if (!manager) return;
    this.manager = manager;
    // Discover the runtime inventory; classify dynamically. Fall back to the
    // known controlled set when the manager exposes no key list.
    const runtimeKeys = readRuntimeExpressionKeys(
      manager as unknown as { expressionMap?: Record<string, unknown> },
    );
    const discovered = runtimeKeys.filter(isSafeDiagnosticName);
    const safe = discovered.length > 0 ? discovered : [...CONTROLLED_PRESETS];
    this.safePresets = [...CONTROLLED_PRESETS.filter((p) => safe.includes(p)),
      ...safe.filter((p) => !(CONTROLLED_PRESETS as string[]).includes(p)).sort()];
    for (const preset of this.safePresets) {
      let found = false;
      try {
        found = manager.getExpression(preset) != null;
      } catch {
        found = false;
      }
      this.present[preset] = found;
      this.weights[preset] = 0;
    }
    this.writeList = [...this.safePresets];
    this.initialized = true;
    this.reportScanInventory(runtimeKeys);
    this.registerDevHooks();
  }

  /**
   * DEV-only one-time scan report (bind time, never per frame).
   * Silent in production.
   */
  private reportScanInventory(runtimeKeys: string[]): void {
    if (!isDevBuild()) return;
    const inKeys = (...sets: readonly (readonly string[])[]): string[] =>
      runtimeKeys.filter((k) => sets.some((s) => s.includes(k)));
    console.info(
      `[CarlottaExpressionScan] safe: ${this.safePresets.join(', ') || '(none)'}\n` +
      `[CarlottaExpressionScan] phonemes: ${inKeys(PHONEME_PRESETS).join(', ') || '(none)'}\n` +
      `[CarlottaExpressionScan] blink: ${inKeys(BLINK_PRESETS).join(', ') || '(none)'}\n` +
      `[CarlottaExpressionScan] look: ${inKeys(LOOK_PRESETS).join(', ') || '(none)'}`
    );
  }

  /** Runtime-discovered safe presets (read-only copy). */
  public getSafePresets(): string[] {
    return [...this.safePresets];
  }

  /**
   * Temporary DEV-only diagnostic hooks (no permanent UI): single-expression
   * override, reset, and reader for manual capability discovery in dev
   * builds. Silent and unregistered in production.
   */
  private registerDevHooks(): void {
    if (!isDevBuild()) return;
    try {
      const w = window as unknown as Record<string, unknown>;
      w.__carlottaExpressionTest = (name: unknown, weight?: unknown): boolean =>
        this.setDiagnosticExpression(name, weight);
      w.__carlottaExpressionReset = (): void => {
        this.clearDiagnosticOverride();
      };
      w.__carlottaExpressionInfo = (): {
        available: string[];
        currentValues: Record<string, number>;
        override: { preset: string; weight: number } | null;
      } => this.getDiagnosticInfo();
      w.__carlottaExpressionRecipe = (recipe: unknown): boolean =>
        this.setDiagnosticRecipe(recipe);
      w.__carlottaExpressionRecipeReset = (): void => {
        this.clearDiagnosticRecipe();
      };
      w.__carlottaExpressionRecipeInfo = (): {
        active: boolean;
        recipe: Record<string, number> | null;
        available: string[];
      } => this.getDiagnosticRecipeInfo();
      w.__carlottaExpressionScan = (name: unknown, weight?: unknown): boolean =>
        this.setDiagnosticExpression(name, weight ?? DIAGNOSTIC_DEFAULT_WEIGHT);
      w.__carlottaExpressionScanReset = (): void => {
        this.clearDiagnosticOverride();
      };
      w.__carlottaExpressionScanRecipe = (recipe: unknown): boolean =>
        this.setDiagnosticRecipe(recipe);
      w.__carlottaExpressionScanRecipeReset = (): void => {
        this.clearDiagnosticRecipe();
      };
      w.__carlottaExpressionScanInfo = (): {
        available: string[];
        safe: string[];
        phonemes: string[];
        blink: string[];
        look: string[];
        activeRecipe: Record<string, number> | null;
        currentValues: Record<string, number>;
      } => this.getDiagnosticScanInfo();
    } catch {
      /* non-browser runtimes: hooks unavailable */
    }
  }

  /**
   * Zero all controlled weights and forget the manager (unload/switch).
   * Safe on a dying manager — failures are swallowed.
   */
  public reset(): void {
    if (this.manager) {
      for (const preset of this.writeList) {
        if (!this.present[preset]) continue;
        try {
          this.manager.setValue(preset, 0);
        } catch {
          /* manager torn down: stay silent */
        }
      }
    }
    this.manager = null;
    this.initialized = false;
    this.diagOverride = null;
    this.diagRecipe = null;
    this.safePresets = [];
    this.writeList = [];
    this.present = {};
    this.weights = {};
  }

  public getIsInitialized(): boolean {
    return this.initialized;
  }

  /**
   * DEV-only diagnostic: pin one facial preset to a fixed weight for visual
   * capability testing. Accepts any discovered-safe preset; rejects phonemes
   * (aa/ih/ou/ee/oh), blink/look, unknown/absent names (false, no state
   * touched). The override persists every frame until cleared; emotion/body
   * state is never modified.
   */
  public setDiagnosticExpression(name: unknown, weight: unknown): boolean {
    if (!isSafeDiagnosticName(name)) return false;
    if (!this.manager || !this.present[name]) return false;
    const w =
      typeof weight === 'number' && Number.isFinite(weight)
        ? Math.min(1, Math.max(0, weight))
        : DIAGNOSTIC_DEFAULT_WEIGHT;
    this.diagOverride = { preset: name, weight: w };
    if (isDevBuild()) {
      console.info(`[CarlottaExpressionTest] ${name} = ${w.toFixed(2)}`);
    }
    return true;
  }

  /**
   * DEV-only diagnostic: clear the override and snap controlled weights to
   * zero (single immediate write). Body emotion state is NOT disturbed —
   * subsequent frames resume emotion-following (zeros persist while the
   * default calm/0 emotion is active). Never touches aa/blink/look.
   */
  public clearDiagnosticOverride(): void {
    this.diagOverride = null;
    if (!this.manager) return;
    for (const preset of this.writeList) {
      if (!this.present[preset]) continue;
      this.weights[preset] = 0;
      try {
        this.manager.setValue(preset, 0);
      } catch {
        /* manager torn down: stay silent */
      }
    }
  }

  /**
   * DEV-only diagnostic: set a multi-expression recipe for visual
   * capability discovery. Accepts a plain object with any subset of the
   * discovered-safe presets; omitted safe presets are 0; values clamped
   * 0..1. Rejects unknown/phoneme/blink/look keys and non-finite values
   * (false, no state touched). Weights are NOT normalized — independent
   * values are preserved exactly. Emotion/body state never modified.
   */
  public setDiagnosticRecipe(input: unknown): boolean {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
    const record = input as Record<string, unknown>;
    const recipe: Record<string, number> = {};
    for (const key of Object.keys(record)) {
      if (!isSafeDiagnosticName(key)) return false;
      const value = record[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      recipe[key] = Math.min(1, Math.max(0, value));
    }
    this.diagRecipe = recipe;
    if (isDevBuild()) {
      console.info(`[CarlottaExpressionRecipe] ${JSON.stringify(recipe)}`);
    }
    return true;
  }

  /**
   * DEV-only diagnostic: clear recipe AND single override (full slate),
   * snap controlled weights to zero. Body emotion state untouched —
   * subsequent frames resume emotion-following. Never touches aa/blink/look.
   */
  public clearDiagnosticRecipe(): void {
    this.diagRecipe = null;
    this.clearDiagnosticOverride();
  }

  /** DEV-only diagnostic reader for the recipe state (no side effects). */
  public getDiagnosticRecipeInfo(): {
    active: boolean;
    recipe: Record<string, number> | null;
    available: string[];
  } {
    return {
      active: this.diagRecipe !== null,
      recipe: this.diagRecipe ? { ...this.diagRecipe } : null,
      available: this.getDiagnosticInfo().available,
    };
  }

  /**
   * DEV-only scan state: full safe-expression capability report for manual
   * discovery — runtime inventory classified into safe/phonemes/blink/look,
   * plus the live recipe state. Read-only; never writes anything.
   */
  public getDiagnosticScanInfo(): {
    available: string[];
    safe: string[];
    phonemes: string[];
    blink: string[];
    look: string[];
    activeRecipe: Record<string, number> | null;
    currentValues: Record<string, number>;
  } {
    const available = this.getDiagnosticInfo().available;
    return {
      available,
      safe: [...this.safePresets],
      phonemes: available.filter((k) => (PHONEME_PRESETS as readonly string[]).includes(k)),
      blink: available.filter((k) => (BLINK_PRESETS as readonly string[]).includes(k)),
      look: available.filter((k) => (LOOK_PRESETS as readonly string[]).includes(k)),
      activeRecipe: this.diagRecipe ? { ...this.diagRecipe } : null,
      currentValues: this.getWeights(),
    };
  }

  /** DEV-only diagnostic reader (no animation side effects). */
  public getDiagnosticInfo(): {
    available: string[];
    currentValues: Record<string, number>;
    override: { preset: string; weight: number } | null;
  } {
    let available: string[] = [];
    try {
      const manager = this.manager as unknown as {
        expressionMap?: Record<string, unknown>;
      } | null;
      if (manager?.expressionMap) available = Object.keys(manager.expressionMap);
    } catch {
      available = [];
    }
    if (available.length === 0) {
      available = CONTROLLED_PRESETS.filter((p) => this.present[p]);
    }
    return {
      available,
      currentValues: this.getWeights(),
      override: this.diagOverride ? { ...this.diagOverride } : null,
    };
  }

  /** Current smoothed weights (read-only copy, for diagnostics/tests). */
  public getWeights(): Record<string, number> {
    return { ...this.weights };
  }

  /**
   * Glide weights toward targets. Call BEFORE `vrm.update(delta)`. Iterates
   * only the stable bind-time write list (controlled first, extras after);
   * never touches phoneme/blink/look presets.
   */
  public update(delta: number): void {
    if (!this.manager || !this.initialized) return;
    const dt = Math.max(0, Math.min(delta, 0.1));
    const { targetEmotion, intensity } = carlottaAnimationController.getEmotion();
    const mapping = EMOTION_PRESET_WEIGHTS[targetEmotion] ?? {};
    const rate = 1 - Math.exp(-dt * WEIGHT_BLEND_SPEED);

    for (const preset of this.writeList) {
      if (!this.present[preset]) continue;
      // Diagnostic recipe wins for ALL presets while active (omitted = 0);
      // otherwise the single-expression override wins for its preset only;
      // otherwise the body emotion layer drives. Production (both null) unchanged.
      const target =
        this.diagRecipe !== null
          ? (this.diagRecipe[preset] ?? 0)
          : this.diagOverride?.preset === preset
            ? this.diagOverride.weight
            : ((mapping as Record<string, number>)[preset] ?? 0) * intensity;
      const next = this.weights[preset] + (target - this.weights[preset]) * rate;
      this.weights[preset] = Math.abs(target - next) < 0.001 ? target : next;
      try {
        this.manager.setValue(preset, this.weights[preset]);
      } catch {
        /* manager torn down mid-frame: stay silent */
      }
    }
  }
}

export const carlottaExpressionController = new CarlottaExpressionController();
