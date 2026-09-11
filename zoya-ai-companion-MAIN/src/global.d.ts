/**
 * Global TypeScript declarations for window-level debug functions.
 * These are registered at runtime by the Zoya application for
 * browser-console debugging of Mint's facial animation.
 */

declare global {
  interface Window {
    /**
     * Trigger Mint's manual facial-bone sweep diagnostic.
     * Available after FBX loads and LipSyncController initializes bone mode.
     *
     * Usage in browser console:
     *   window.__testMintMouth()
     */
    __testMintMouth?: () => void;

    /**
     * Trigger Mint's bone-ranking diagnostic.
     * Tests all 12 facial bones × 6 rotations, measures displacement,
     * and prints ranked results to terminal.
     */
    __rankMintFaceBones?: () => void;

    /**
     * Trigger visual mouth-opening diagnostic.
     * Tests candidate facial bones at ±15° with visual overlay.
     */
    __findMouthOpening?: () => void;

    /**
     * Inspect the loaded Mint FBX mouth asset structure.
     */
    __inspectMouthAsset?: () => void;

    /**
     * Full facial rig diagnostic: hierarchy dump + axis test + coordinated mouth-open + jaw test.
     */
    __testFacialRig?: () => void;

    /**
     * Inspect the exact geometry/skeleton relationship of mouth, .001, and main mesh.
     */
    __inspectMintMouthGeom?: () => void;

    /**
     * Trigger the procedural mouth pose test (CLOSED → 25% → 50% → 75% → 100% → CLOSED).
     * Requires bone mode and auto-calibration to be complete.
     */
    __testMintMouthPose?: () => void;

    /**
     * DEV-only: request a Carlotta procedural animation state.
     * Returns true when the state was accepted ('idle' | 'listening' |
     * 'talking' | 'thinking'); registered by CarlottaAnimationController
     * after VRM init, dev builds only.
     */
    __carlottaAnimState?: (next: unknown) => boolean;

    /**
     * DEV-only: read the current Carlotta animation state and blend weight.
     */
    __carlottaAnimInfo?: () => { state: string; blend: number };

    /**
     * DEV-only: request a Carlotta procedural emotion layer value.
     * Returns true when accepted ('calm' | 'happy' | 'excited' | 'sad' |
     * 'angry', optional intensity 0..1 clamped). Independent from behavior.
     */
    __carlottaEmotion?: (next: unknown, intensity?: unknown) => boolean;

    /**
     * DEV-only: read the current Carlotta emotion layer value and intensity.
     */
    __carlottaEmotionInfo?: () => { emotion: string; targetEmotion: string; intensity: number };

    /**
     * DEV-only: pin one Carlotta facial expression (neutral/happy/angry/sad/
     * relaxed) to a fixed weight for visual capability discovery.
     * Rejects phonemes, blink/look, and unknown names (false).
     */
    __carlottaExpressionTest?: (name: unknown, weight?: unknown) => boolean;

    /**
     * DEV-only: clear the expression diagnostic override and zero controlled
     * weights (lip-sync aa / blink / look / body / emotion state untouched).
     */
    __carlottaExpressionReset?: () => void;

    /**
     * DEV-only: read runtime expression inventory, current values, override.
     */
    __carlottaExpressionInfo?: () => {
      available: string[];
      currentValues: Record<string, number>;
      override: { preset: string; weight: number } | null;
    };

    /**
     * DEV-only: set a multi-expression recipe (safe presets only, omitted=0,
     * weights clamped, independent values preserved). Rejects unknown /
     * phoneme / blink / look keys.
     */
    __carlottaExpressionRecipe?: (recipe: unknown) => boolean;

    /**
     * DEV-only: clear recipe + single override, zero controlled weights
     * (emotion/body/aa/blink/look untouched).
     */
    __carlottaExpressionRecipeReset?: () => void;

    /**
     * DEV-only: read recipe state ({active, recipe, available}).
     */
    __carlottaExpressionRecipeInfo?: () => {
      active: boolean;
      recipe: Record<string, number> | null;
      available: string[];
    };

    /**
     * DEV-only: start a procedural gesture (wave/greeting/goodbye/point/
     * shrug/clap/bow). Returns false for unknown names or missing bones.
     */
    __carlottaGestureStart?: (name: unknown) => boolean;

    /**
     * DEV-only: read gesture state ({name, phase, t}).
     */
    __carlottaGestureInfo?: () => { name: string | null; phase: string; t: number };

    /**
     * DEV-only: cancel the active gesture (blends back to base).
     */
    __carlottaGestureCancel?: () => void;

    /**
     * DEV-only: resolve an animation intent through the skill system
     * ({intent, source, skill, reason}). Read-only.
     */
    __carlottaSkillResolve?: (intent: unknown) => {
      intent: string;
      source: string;
      skill: unknown;
      reason: string;
    } | null;

    /**
     * DEV-only: resolve + dispatch an intent to the Carlotta procedural
     * controllers. Returns true when a procedural skill was activated.
     */
    __carlottaSkillDispatch?: (intent: unknown) => boolean;

    /**
     * DEV-only: probe retarget capability for a candidate ({compatible,
     * reasons, unmappedSlots}). Pure check, no motion, no downloads.
     */
    __carlottaSkillCanRetarget?: (request: unknown) => {
      compatible: boolean;
      reasons: string[];
      unmappedSlots: string[];
    };

    /**
     * DEV-only: pin one runtime-safe facial expression for capability
     * scanning (rejects phonemes/blink/look/unknown). Replaces any previous
     * single scan so only it is active.
     */
    __carlottaExpressionScan?: (name: unknown, weight?: unknown) => boolean;

    /**
     * DEV-only: clear the scan override, resume production follower.
     */
    __carlottaExpressionScanReset?: () => void;

    /**
     * DEV-only: multi-expression scan recipe (safe only, omitted=0,
     * independent weights, no normalization).
     */
    __carlottaExpressionScanRecipe?: (recipe: unknown) => boolean;

    /**
     * DEV-only: clear the scan recipe, resume production follower.
     */
    __carlottaExpressionScanRecipeReset?: () => void;

    /**
     * DEV-only: full scan report ({available, safe, phonemes, blink, look,
     * activeRecipe, currentValues}).
     */
    __carlottaExpressionScanInfo?: () => {
      available: string[];
      safe: string[];
      phonemes: string[];
      blink: string[];
      look: string[];
      activeRecipe: Record<string, number> | null;
      currentValues: Record<string, number>;
    };
  }
}

export {};
