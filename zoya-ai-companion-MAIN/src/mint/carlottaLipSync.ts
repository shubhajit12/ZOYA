import type { VRM } from '@pixiv/three-vrm';
import type { VisemeFrame } from '../types';
import { audioAnalyser } from '../voice/audioAnalyser';
import { isDevBuild } from './runtimeEnv';

/**
 * CarlottaLipSync — the ONE lip-sync system for the Carlotta VRM (Pass 3).
 *
 * Signal path (all pre-existing, reused — nothing duplicated):
 *   TTS Web Audio playback → audioAnalyser (single cached AnalyserNode)
 *   → getVisemeFrame() polled in the render loop → this module
 *   → VRM expressionManager 'aa' (mouth-open) weight.
 *
 * Separate systems, never merged:
 * - THIS module drives the FACE (VRM 'aa' expression only).
 * - CarlottaAnimationController `talking` drives the BODY.
 * - Emotion layer drives BODY POSTURE. None of them touch each other.
 *
 * Motion shaping: speech-energy latch with hysteresis + short hold (bridges
 * phoneme gaps without freezing open across sentences), separate
 * attack/release smoothing (no raw-amplitude jitter), hard silence decay,
 * weights clamped 0..1 (scaled below maximum). Only the 'aa' expression is
 * ever written — blink/lookAt/other expressions are never touched.
 *
 * Performance: cached manager reference, no per-frame allocation, no audio
 * objects created here, no hierarchy traversal per frame.
 */

// VRM0 preset `a` is remapped to the VRM1 runtime name `aa` by the
// installed three-vrm loader — that is the key the manager registers.
const MOUTH_PRESET = 'aa';

/** Speech-energy latch threshold (viseme mouthOpen units, 0..1). */
const SPEECH_THRESHOLD = 0.03;
/** Hold speaking-active briefly after energy drops (seconds). */
const RELEASE_HOLD = 0.3;
/** Attack time constant (seconds) — mouth opens responsively. */
const ATTACK_TAU = 0.1;
/** Release time constant (seconds) — mouth settles smoothly, no snap. */
const RELEASE_TAU = 0.18;
/** Output scale — strong speech stays visibly below the hard maximum. */
const OUTPUT_SCALE = 0.9;

interface MouthExpressionManager {
  getExpression(name: string): unknown;
  setValue(name: string, weight: number): void;
}

class CarlottaLipSync {
  private manager: MouthExpressionManager | null = null;
  private hasMouth = false;
  private loggedNoMouth = false;
  private level = 0; // smoothed mouth weight actually applied
  private holdTimer = 0; // release-hold countdown while latched
  private latched = false;
  private heldEnergy = 0; // speech energy sustained across the hold gap
  private diagTimer = 0; // throttled DEV diagnostic cadence (seconds)

  /** Bind to a loaded VRM (call after load; re-bind cleanly per model). */
  public bind(vrm: VRM | null): void {
    this.reset();
    if (!vrm) return;
    const manager = vrm.expressionManager as unknown as MouthExpressionManager | null;
    if (!manager) return;
    this.manager = manager;
    this.hasMouth = manager.getExpression(MOUTH_PRESET) != null;
    this.loggedNoMouth = false;
  }

  /** Forget the bound VRM (call on unload/switch). Never writes to a dead manager. */
  public reset(): void {
    this.manager = null;
    this.hasMouth = false;
    this.loggedNoMouth = false;
    this.level = 0;
    this.holdTimer = 0;
    this.latched = false;
    this.heldEnergy = 0;
    this.diagTimer = 0;
  }

  /**
   * Advance one frame. Call BEFORE `vrm.update(delta)` so the weight applies
   * in the same frame's expression pass.
   *
   * `speechActive` is the App-level TTS speaking flag (for DEV diagnostics
   * only — the mouth target is driven purely by analyser energy so pauses
   * and silence always close the mouth even mid-utterance).
   */
  public update(viseme: VisemeFrame, delta: number, speechActive = false): void {
    if (!this.manager || !this.hasMouth) {
      if (this.manager && !this.hasMouth && !this.loggedNoMouth) {
        this.loggedNoMouth = true;
        console.warn(`[CarloLipSync] mouth preset '${MOUTH_PRESET}' missing — lip-sync idle`);
      }
      return;
    }

    const dt = Math.max(0, Math.min(delta, 0.1));
    const raw = Number.isFinite(viseme.mouthOpen) ? Math.min(1, Math.max(0, viseme.mouthOpen)) : 0;

    // Latch with hysteresis + short hold: bridges phoneme gaps (target keeps
    // the last speech energy), releases across real pauses/silence instead
    // of snapping.
    if (raw > SPEECH_THRESHOLD) {
      this.latched = true;
      this.holdTimer = RELEASE_HOLD;
      this.heldEnergy = raw;
    } else if (this.holdTimer > 0) {
      this.holdTimer -= dt;
    } else {
      this.latched = false;
    }

    const target = this.latched ? Math.min(1, this.heldEnergy * 1.1) * OUTPUT_SCALE : 0;
    const tau = target > this.level ? ATTACK_TAU : RELEASE_TAU;
    this.level += (target - this.level) * (1 - Math.exp(-dt / tau));
    if (Math.abs(target - this.level) < 0.0005) this.level = target;

    try {
      this.manager.setValue(MOUTH_PRESET, this.level);
    } catch {
      /* expression manager torn down mid-frame: stay silent */
    }

    // Throttled DEV-only signal trace (~0.5s cadence, only while speech is
    // flagged active or the mouth is engaged). Answers: is getVisemeFrame()
    // called, what energy/threshold/held/weight resulted, and what the live
    // analyser tap itself sees. Silent in production.
    if (isDevBuild()) {
      this.diagTimer += dt;
      if (this.diagTimer >= 0.5 && (speechActive || this.latched || this.level > 0.001)) {
        this.diagTimer = 0;
        const snap = audioAnalyser.getSignalSnapshot();
        console.info(
          `[CarloLipSync] speech=${speechActive} mouthOpen=${raw.toFixed(3)} ` +
          `thresh=${SPEECH_THRESHOLD} crossed=${raw > SPEECH_THRESHOLD} ` +
          `held=${this.heldEnergy.toFixed(3)} level=${this.level.toFixed(3)} ` +
          `analyser=${snap.analyserReady} fft=${snap.fftSize} bins=${snap.binCount} ` +
          `peak=${snap.peakByte} mean=${snap.meanByte.toFixed(1)}`
        );
      }
    }
  }

  public getLevel(): number {
    return this.level;
  }
}

export const carlottaLipSync = new CarlottaLipSync();
