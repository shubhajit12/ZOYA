import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import {
  CARLOTTA_BREATH_SPEED,
  CARLOTTA_IDLE_MAX_DELTA,
  CONTROLLED_BONES,
  computeCarlottaIdleOffset,
  type IdleBoneName,
} from './carlottaIdleController';
import { isDevBuild } from './runtimeEnv';

/**
 * CarlottaAnimationController — foundation of context-aware procedural
 * animation for the Carlotta VRM (Pass 1: idle / listening / talking /
 * thinking; designed for later states without architectural rewrites).
 *
 * Pipeline: safe intent → controller → procedural state → local bone
 * rotations → VRM. A future AI layer may only supply a CarlottaAnimationState
 * value — never bones, rotations, or numeric parameters.
 *
 * Guarantees (mirroring the proven idle controller):
 * - Sole writer of the 6 upper-body bones (spine, chest, neck, head,
 *   shoulders). Eyes, spring/physics bones, fingers, hips/legs untouched.
 * - Base quaternions captured AFTER the relaxed pose (init order in
 *   MintRenderer is unchanged); every frame writes
 *   `quaternion = base * offset`, never accumulated.
 * - Zero per-frame allocation (module scratch Euler/Quaternion, bones
 *   resolved once at init, missing bones skipped with a warning).
 * - Frame-rate independent (delta-clamped time + exponential blending).
 */

export type CarlottaAnimationState = 'idle' | 'listening' | 'talking' | 'thinking';

export function isValidCarlottaAnimationState(value: unknown): value is CarlottaAnimationState {
  return value === 'idle' || value === 'listening' || value === 'talking' || value === 'thinking';
}

/**
 * Persistent emotion layer (Pass 2). Independent from behavior: changing
 * emotion never resets behavior and vice versa. Unknown values are rejected
 * without touching bones.
 */
export type CarlottaEmotion = 'calm' | 'happy' | 'excited' | 'sad' | 'angry';

export function isValidCarlottaEmotion(value: unknown): value is CarlottaEmotion {
  return (
    value === 'calm' ||
    value === 'happy' ||
    value === 'excited' ||
    value === 'sad' ||
    value === 'angry'
  );
}

/** Blend speed toward a newly requested state (~1s to settle). */
const BLEND_SPEED = 3.5;

/** Emotion crossfade speed (~1.2s to settle, inside the 0.8–1.5s band). */
const EMOTION_BLEND_SPEED = 2.5;

interface ControlledBone {
  name: IdleBoneName;
  node: THREE.Object3D;
  base: THREE.Quaternion;
}

const _idleEuler = new THREE.Euler();
const _stateEuler = new THREE.Euler();
const _emotionEuler = new THREE.Euler();
const _emotionTargetEuler = new THREE.Euler();
const _offsetQuat = new THREE.Quaternion();

/** Per-bone state recipes (idle handled by blending weight, not here). */
function computeActiveOffset(
  state: Exclude<CarlottaAnimationState, 'idle'>,
  bone: IdleBoneName,
  t: number,
  breath: number,
  out: THREE.Euler,
): void {
  switch (state) {
    case 'listening': {
      switch (bone) {
        case 'head':
          out.set(
            Math.sin(t * 0.34 + 1.0) * 0.008,
            0.035 + Math.sin(t * 0.5) * 0.012,
            Math.sin(t * 0.21 + 0.4) * 0.006,
          );
          break;
        case 'neck':
          out.set(
            Math.sin(t * 0.34 + 1.4) * 0.004,
            Math.sin(t * 0.5 + 0.3) * 0.005,
            0,
          );
          break;
        case 'chest':
          out.set(Math.sin(breath) * 0.006 - 0.008, 0, 0);
          break;
        case 'spine':
          out.set(Math.sin(t * 0.29 + 0.8) * 0.004, 0, 0);
          break;
        case 'leftShoulder':
        case 'rightShoulder':
          out.set(Math.sin(breath - 0.7) * 0.004, 0, 0);
          break;
      }
      break;
    }
    case 'talking': {
      // Phrase envelope (~14s swell/lull) keeps motion conversational with
      // natural pauses instead of constant repetitive nodding.
      const phrase = 0.5 + 0.5 * Math.sin(t * 0.43 + 0.7);
      switch (bone) {
        case 'head':
          out.set(
            Math.sin(t * 1.1) * 0.02 * phrase + Math.sin(t * 2.3 + 1.3) * 0.008 * phrase,
            Math.sin(t * 0.67 + 0.5) * 0.025 * phrase,
            Math.sin(t * 0.91 + 2.2) * 0.008 * phrase,
          );
          break;
        case 'neck':
          out.set(
            Math.sin(t * 1.1 + 0.4) * 0.01 * phrase,
            Math.sin(t * 0.67 + 0.9) * 0.008 * phrase,
            0,
          );
          break;
        case 'chest':
          out.set(
            Math.sin(breath) * 0.012 + Math.sin(t * 0.9) * 0.006 * phrase,
            0,
            Math.sin(t * 0.53 + 0.2) * 0.005 * phrase,
          );
          break;
        case 'spine':
          out.set(Math.sin(t * 0.47 + 1.1) * 0.006 * phrase, 0, 0);
          break;
        case 'leftShoulder':
          out.set(Math.sin(breath - 0.5) * 0.008 + Math.sin(t * 0.83) * 0.004 * phrase, 0, 0);
          break;
        case 'rightShoulder':
          out.set(Math.sin(breath - 0.9) * 0.008 + Math.sin(t * 0.79 + 0.6) * 0.004 * phrase, 0, 0);
          break;
      }
      break;
    }
    case 'thinking': {
      switch (bone) {
        case 'head':
          out.set(
            Math.sin(t * 0.17 + 2.0) * 0.012,
            Math.sin(t * 0.13 + 1.0) * 0.012,
            0.03 + Math.sin(t * 0.21) * 0.01,
          );
          break;
        case 'neck':
          out.set(
            Math.sin(t * 0.17 + 2.4) * 0.005,
            0,
            0.008 + Math.sin(t * 0.21 + 0.5) * 0.004,
          );
          break;
        case 'chest':
          out.set(Math.sin(breath) * 0.006, 0, Math.sin(t * 0.19 + 0.7) * 0.004);
          break;
        case 'spine':
          out.set(Math.sin(t * 0.15 + 1.3) * 0.004, 0, 0);
          break;
        case 'leftShoulder':
        case 'rightShoulder':
          out.set(Math.sin(breath - 0.7) * 0.003, 0, 0);
          break;
      }
      break;
    }
  }
}

/**
 * Per-bone emotion recipes. Posture bias + slow deterministic variation
 * (never a bare sine loop); all peaks within the per-emotion degree bounds.
 * Shoulder roll uses mirrored signs so L/R move symmetrically. Same 6
 * approved bones only — no eyes, fingers, hips, springs, or face.
 */
function computeEmotionOffset(
  emotion: CarlottaEmotion,
  bone: IdleBoneName,
  t: number,
  breath: number,
  out: THREE.Euler,
): void {
  switch (emotion) {
    case 'calm': {
      // Near-neutral baseline: faint head drift only, no second breathing.
      switch (bone) {
        case 'head':
          out.set(Math.sin(t * 0.23 + 0.6) * 0.002, Math.sin(t * 0.19) * 0.002, 0);
          break;
        default:
          out.set(0, 0, 0);
          break;
      }
      break;
    }
    case 'happy': {
      switch (bone) {
        case 'head':
          out.set(-0.012 + Math.sin(t * 0.53) * 0.006, Math.sin(t * 0.47 + 0.8) * 0.006, 0);
          break;
        case 'neck':
          out.set(-0.006 + Math.sin(t * 0.53 + 0.4) * 0.003, 0, 0);
          break;
        case 'chest':
          out.set(-0.008 + Math.sin(breath) * 0.003, 0, Math.sin(t * 0.41 + 0.5) * 0.003);
          break;
        case 'spine':
          out.set(0, 0, Math.sin(t * 0.4) * 0.004);
          break;
        case 'leftShoulder':
          out.set(0, 0, 0.008 + Math.sin(t * 0.45 + 0.2) * 0.003);
          break;
        case 'rightShoulder':
          out.set(0, 0, -0.008 - Math.sin(t * 0.45 + 0.2) * 0.003);
          break;
      }
      break;
    }
    case 'excited': {
      switch (bone) {
        case 'head':
          out.set(
            -0.016 + Math.sin(t * 0.9) * 0.01,
            Math.sin(t * 0.71 + 0.3) * 0.012,
            Math.sin(t * 0.83 + 1.1) * 0.006,
          );
          break;
        case 'neck':
          out.set(-0.008 + Math.sin(t * 0.9 + 0.4) * 0.004, 0, 0);
          break;
        case 'chest':
          out.set(-0.012 + Math.sin(breath) * 0.005, 0, Math.sin(t * 0.66 + 0.9) * 0.005);
          break;
        case 'spine':
          out.set(0, 0, Math.sin(t * 0.62 + 0.4) * 0.006);
          break;
        case 'leftShoulder':
          out.set(Math.sin(t * 0.77) * 0.005, 0, 0.012 + Math.sin(t * 0.58 + 0.3) * 0.005);
          break;
        case 'rightShoulder':
          out.set(Math.sin(t * 0.73 + 0.8) * 0.005, 0, -0.012 - Math.sin(t * 0.58 + 0.3) * 0.005);
          break;
      }
      break;
    }
    case 'sad': {
      switch (bone) {
        case 'head':
          out.set(0.018 + Math.sin(t * 0.16) * 0.006, Math.sin(t * 0.14 + 0.7) * 0.005, 0);
          break;
        case 'neck':
          out.set(0.008 + Math.sin(t * 0.16 + 0.5) * 0.003, 0, 0);
          break;
        case 'chest':
          out.set(0.01 + Math.sin(t * 0.15 + 1.0) * 0.004, 0, 0);
          break;
        case 'spine':
          out.set(0.006 + Math.sin(t * 0.15 + 0.6) * 0.003, 0, 0);
          break;
        case 'leftShoulder':
        case 'rightShoulder':
          out.set(0.006 + Math.sin(t * 0.15 + 0.9) * 0.003, 0, 0);
          break;
      }
      break;
    }
    case 'angry': {
      switch (bone) {
        case 'head':
          out.set(0.008 + Math.sin(t * 1.3) * 0.002, Math.sin(t * 0.61 + 0.4) * 0.004, 0);
          break;
        case 'neck':
          out.set(0.004 + Math.sin(t * 1.3 + 0.5) * 0.002, 0, 0);
          break;
        case 'chest':
          out.set(-0.01 + Math.sin(breath) * 0.003, 0, 0);
          break;
        case 'spine':
          out.set(-0.004, 0, 0);
          break;
        case 'leftShoulder':
          out.set(0, 0, -0.006 + Math.sin(t * 1.1 + 0.2) * 0.002);
          break;
        case 'rightShoulder':
          out.set(0, 0, 0.006 - Math.sin(t * 1.1 + 0.2) * 0.002);
          break;
      }
      break;
    }
  }
}
export class CarlottaAnimationController {
  private bones: ControlledBone[] = [];
  private time = 0;
  private initialized = false;
  private state: CarlottaAnimationState = 'idle';
  private blend = 0; // 0 = pure idle foundation, 1 = full active state
  private stateLogged = false;
  // Persistent emotion layer (independent from behavior state/blend).
  private emotion: CarlottaEmotion = 'calm';
  private targetEmotion: CarlottaEmotion = 'calm';
  private emotionBlend = 1; // 0 = previous emotion, 1 = settled on emotion
  private emotionIntensity = 0; // smoothed 0..1, scales emotion offsets
  private targetIntensity = 0;
  /**
   * Body-yield flag for the gesture layer (`bow` only). While set, the
   * spine/neck/head writes below are skipped so exactly one writer drives
   * them. Default off — zero effect on existing behavior.
   */
  private bodyHold = false;

  /**
   * Resolve bones via the humanoid API and capture base quaternions.
   * Must run AFTER applyCarlottaRelaxedPose (same order the idle
   * controller always used) — never captures the T-pose.
   */
  public init(vrm: VRM): void {
    this.bones = [];
    this.time = 0;
    this.state = 'idle';
    this.blend = 0;
    this.stateLogged = false;
    this.emotion = 'calm';
    this.targetEmotion = 'calm';
    this.emotionBlend = 1;
    this.emotionIntensity = 0;
    this.targetIntensity = 0;
    this.bodyHold = false;

    for (const name of CONTROLLED_BONES) {
      const node = vrm.humanoid.getRawBoneNode(name);
      if (!node) {
        console.warn(`[CarloAnimState] bone "${name}" missing — skipping (no guess made)`);
        continue;
      }
      this.bones.push({ name, node, base: node.quaternion.clone() });
    }

    this.initialized = this.bones.length > 0;
    console.log(
      `[CarloAnimState] controller initialized (${this.bones.length}/${CONTROLLED_BONES.length} bones): ` +
        (this.initialized ? this.bones.map((b) => b.name).join(', ') : 'ANIMATION DISABLED'),
    );
    this.registerDevHooks();
  }

  /** Request a state; invalid values are rejected (AI-safety boundary). */
  public setState(next: CarlottaAnimationState): void {
    if (!isValidCarlottaAnimationState(next)) return;
    if (this.state === next) return;
    this.state = next;
    if (isDevBuild()) {
      console.info(`[CarloAnimState] → ${next}`);
    }
  }

  public getState(): CarlottaAnimationState {
    return this.state;
  }

  /**
   * Request an emotion with intensity 0..1 (clamped; non-finite → 0).
   * Invalid emotions are rejected (returns false) without touching bones.
   * Independent from behavior: never resets state/blend and vice versa.
   */
  public setEmotion(emotion: CarlottaEmotion, intensity = 0.5): boolean {
    if (!isValidCarlottaEmotion(emotion)) return false;
    const clamped = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
    if (emotion !== this.targetEmotion) {
      // Crossfade from the currently effective emotion, not from calm.
      this.emotion = this.getEffectiveEmotion();
      this.targetEmotion = emotion;
      this.emotionBlend = 0;
    }
    this.targetIntensity = clamped;
    if (isDevBuild()) {
      console.info(`[CarloEmotion] → ${emotion} @ ${clamped}`);
    }
    return true;
  }

  public getEmotion(): { emotion: CarlottaEmotion; targetEmotion: CarlottaEmotion; intensity: number } {
    return {
      emotion: this.getEffectiveEmotion(),
      targetEmotion: this.targetEmotion,
      intensity: Math.round(this.emotionIntensity * 1000) / 1000,
    };
  }

  private getEffectiveEmotion(): CarlottaEmotion {
    return this.emotionBlend >= 1 ? this.targetEmotion : this.emotion;
  }

  public getIsInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Yield spine/neck/head writes to the gesture layer (bow only).
   * The gesture controller sets this around bow playback and always clears
   * it (including on reset paths); default off.
   */
  public setBodyHold(hold: boolean): void {
    this.bodyHold = hold;
  }

  /** Restore captured base pose (used when the VRM is unloaded). */
  public reset(): void {
    for (const bone of this.bones) {
      bone.node.quaternion.copy(bone.base);
    }
    this.bones = [];
    this.initialized = false;
    this.state = 'idle';
    this.blend = 0;
    this.stateLogged = false;
    this.emotion = 'calm';
    this.targetEmotion = 'calm';
    this.emotionBlend = 1;
    this.emotionIntensity = 0;
    this.targetIntensity = 0;
    this.bodyHold = false;
  }

  // DEV-only runtime diagnostics accumulator (2-second interval).
  private diagAcc = 0;
  private diagBoneWrites = 0;

  /** Advance animation. Call once per frame AFTER `vrm.update(delta)`. */
  public update(delta: number): void {
    if (!this.initialized) return;
    if (!this.stateLogged) {
      this.stateLogged = true;
      console.log('[CarloAnimState] animation active');
    }

    // DEV-only diagnostic: log state every 2s to trace idle regression.
    if (isDevBuild()) {
      this.diagAcc += delta;
      if (this.diagAcc >= 2) {
        this.diagAcc = 0;
        console.info(
          `[CarloAnimDiag] state=${this.state} blend=${this.blend.toFixed(3)}` +
          ` bodyHold=${this.bodyHold} time=${this.time.toFixed(2)}` +
          ` emotion=${this.getEffectiveEmotion()} emotionI=${this.emotionIntensity.toFixed(3)}` +
          ` bones=${this.bones.length} writes=${this.diagBoneWrites}`
        );
        this.diagBoneWrites = 0;
      }
    }

    this.time += Math.min(delta, CARLOTTA_IDLE_MAX_DELTA);
    const t = this.time;
    const breath = t * CARLOTTA_BREATH_SPEED;

    // Frame-rate independent blend toward the requested state.
    const target = this.state === 'idle' ? 0 : 1;
    this.blend += (target - this.blend) * (1 - Math.exp(-delta * BLEND_SPEED));
    if (Math.abs(target - this.blend) < 0.001) this.blend = target;
    const w = this.blend;

    // Emotion crossfade + intensity smoothing (independent from behavior).
    this.emotionBlend += (1 - this.emotionBlend) * (1 - Math.exp(-delta * EMOTION_BLEND_SPEED));
    if (this.emotionBlend > 0.999) this.emotionBlend = 1;
    if (this.emotionBlend >= 1) this.emotion = this.targetEmotion;
    this.emotionIntensity +=
      (this.targetIntensity - this.emotionIntensity) * (1 - Math.exp(-delta * EMOTION_BLEND_SPEED));
    if (Math.abs(this.targetIntensity - this.emotionIntensity) < 0.001) {
      this.emotionIntensity = this.targetIntensity;
    }
    const ew = this.emotionBlend;
    const ei = this.emotionIntensity;

    for (const bone of this.bones) {
      // Yielded to the gesture layer (bow only): exactly one writer drives
      // these bones. All other bones — and all behavior/emotion math —
      // continue untouched.
      if (this.bodyHold && (bone.name === 'spine' || bone.name === 'neck' || bone.name === 'head')) {
        continue;
      }
      computeCarlottaIdleOffset(bone.name, t, _idleEuler);
      if (w <= 0 || this.state === 'idle') {
        _stateEuler.copy(_idleEuler);
      } else {
        computeActiveOffset(this.state, bone.name, t, breath, _stateEuler);
        _stateEuler.set(
          _idleEuler.x * (1 - w) + _stateEuler.x * w,
          _idleEuler.y * (1 - w) + _stateEuler.y * w,
          _idleEuler.z * (1 - w) + _stateEuler.z * w,
        );
      }
      // Emotion layer: crossfade previous→target emotion, scaled by
      // smoothed intensity (0 contributes nothing — idle stays identical).
      if (ei > 0.0005) {
        computeEmotionOffset(this.emotion, bone.name, t, breath, _emotionEuler);
        if (ew < 1) {
          computeEmotionOffset(this.targetEmotion, bone.name, t, breath, _emotionTargetEuler);
          _emotionEuler.set(
            _emotionEuler.x * (1 - ew) + _emotionTargetEuler.x * ew,
            _emotionEuler.y * (1 - ew) + _emotionTargetEuler.y * ew,
            _emotionEuler.z * (1 - ew) + _emotionTargetEuler.z * ew,
          );
        }
        _stateEuler.set(
          _stateEuler.x + _emotionEuler.x * ei,
          _stateEuler.y + _emotionEuler.y * ei,
          _stateEuler.z + _emotionEuler.z * ei,
        );
      }
      _offsetQuat.setFromEuler(_stateEuler);
      bone.node.quaternion.copy(bone.base).multiply(_offsetQuat);
      if (isDevBuild()) this.diagBoneWrites++;
    }
  }

  /**
   * Temporary DEV-only test hooks (no permanent UI): validated setter plus
   * a state reader, so each state can be verified visually in dev builds.
   * Silent in production.
   */
  private registerDevHooks(): void {
    if (!isDevBuild()) return;
    try {
      const w = window as unknown as Record<string, unknown>;
      w.__carlottaAnimState = (next: unknown): boolean => {
        if (!isValidCarlottaAnimationState(next)) return false;
        this.setState(next);
        return true;
      };
      w.__carlottaAnimInfo = (): { state: CarlottaAnimationState; blend: number } => ({
        state: this.state,
        blend: Math.round(this.blend * 1000) / 1000,
      });
      w.__carlottaEmotion = (next: unknown, intensity?: unknown): boolean => {
        if (!isValidCarlottaEmotion(next)) return false;
        const level = typeof intensity === 'number' ? intensity : 0.5;
        return this.setEmotion(next, level);
      };
      w.__carlottaEmotionInfo = (): {
        emotion: CarlottaEmotion;
        targetEmotion: CarlottaEmotion;
        intensity: number;
      } => this.getEmotion();
    } catch {
      /* non-browser runtimes: hooks unavailable */
    }
  }
}

export const carlottaAnimationController = new CarlottaAnimationController();
