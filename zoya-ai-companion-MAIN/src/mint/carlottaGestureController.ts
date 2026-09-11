import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { CARLOTTA_IDLE_MAX_DELTA } from './carlottaIdleController';
import { carlottaAnimationController } from './carlottaAnimationController';
import { isDevBuild } from './runtimeEnv';

/**
 * CarlottaGestureController — procedural one-shot gesture layer (Phase 2).
 *
 * Owns ONLY reserved arm/hand bones (plus spine/neck/head during `bow`,
 * via an explicit yield flag on the body controller — never simultaneously).
 * Body, emotion, expression, and lip-sync systems are otherwise untouched.
 *
 * Guarantees:
 * - Gestures are one-shot with deterministic timing: start → active →
 *   recovery → complete. Never loop.
 * - Every frame derives `quaternion = base * offset` (base captured AFTER
 *   the relaxed pose); a start/replace snapshot blends in, so no snapping.
 * - Cancellation/replacement blends back through a short recovery.
 * - Missing bones fail `start()` gracefully (false, nothing touched).
 * - Zero per-frame allocation (module scratch + fixed instance fields,
 *   bones resolved once at init).
 * - Frame-rate independent (delta-clamped clock, exponential blends).
 *
 * Local-frame conventions (verified against the relaxed pose): rest rotations
 * are identity and world-aligned (arms along ±X, facing +Z). Right arm down
 * is −Z, so raising the right arm is +Z (mirrored for the left arm); elbow
 * bend forward is −Y right / +Y left; arm swing forward is −Y right / +Y
 * left. All gesture offsets below are deltas from the captured relaxed base.
 */

export type CarlottaGestureName =
  | 'wave'
  | 'greeting'
  | 'goodbye'
  | 'point'
  | 'shrug'
  | 'clap'
  | 'bow';

export function isValidCarlottaGestureName(value: unknown): value is CarlottaGestureName {
  return (
    value === 'wave' ||
    value === 'greeting' ||
    value === 'goodbye' ||
    value === 'point' ||
    value === 'shrug' ||
    value === 'clap' ||
    value === 'bow'
  );
}

export type GesturePhase = 'idle' | 'active' | 'recovering';

type ArmBoneName =
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'leftHand'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'rightHand';

type TorsoBoneName = 'spine' | 'neck' | 'head';

type GestureBoneName = ArmBoneName | TorsoBoneName;

const ARM_BONES: ArmBoneName[] = [
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
];

const TORSO_BONES: TorsoBoneName[] = ['spine', 'neck', 'head'];

/** Smoothstep 0→1 over [a, b]. */
function ss(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Envelope: smooth rise over [a, b], hold, smooth fall over [c, d]. */
function seg(t: number, a: number, b: number, c: number, d: number): number {
  return ss(a, b, t) * (1 - ss(c, d, t));
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

interface ControlledBone {
  name: GestureBoneName;
  node: THREE.Object3D;
  base: THREE.Quaternion;
  /** Snapshot of the live offset when a gesture starts/replaces (blend-in). */
  from: THREE.Euler;
  /** Current recipe offset (written every active frame). */
  current: THREE.Euler;
}

interface GestureDef {
  duration: number;
  /** Bones this gesture may write (presence already verified at start). */
  writesTorso: boolean;
  eval: (t: number, out: Map<GestureBoneName, THREE.Euler>) => void;
}

/** Scratch map reused by recipe evaluators (never leaves the module). */
const _evalOut = new Map<GestureBoneName, THREE.Euler>();

/** Write a recipe offset into the scratch map (no allocation). */
function put(out: Map<GestureBoneName, THREE.Euler>, name: GestureBoneName, x: number, y: number, z: number): void {
  let e = out.get(name);
  if (!e) {
    e = new THREE.Euler();
    out.set(name, e);
  }
  e.set(x, y, z);
}

function evalWave(t: number, out: Map<GestureBoneName, THREE.Euler>): void {
  const raise = seg(t, 0, 0.5, 2.9, 3.4);
  const env = seg(t, 0.5, 0.8, 2.7, 3.0);
  const wave = Math.sin((t - 0.6) * Math.PI * 2 * 1.2);
  put(out, 'rightUpperArm', 0, 0, 1.05 * raise);
  put(out, 'rightLowerArm', 0, -0.25 + wave * 0.35 * env, 0);
  put(out, 'rightHand', 0, 0, 0.1 * wave * env);
}

function evalGreeting(t: number, out: Map<GestureBoneName, THREE.Euler>): void {
  const raise = seg(t, 0, 0.4, 1.6, 2.0);
  const env = seg(t, 0.4, 0.6, 1.4, 1.6);
  const sway = Math.sin((t - 0.4) * Math.PI * 2 * 0.5);
  put(out, 'rightUpperArm', 0, 0, 0.65 * raise);
  put(out, 'rightLowerArm', 0, -0.2 + sway * 0.3 * env, 0);
  put(out, 'rightHand', 0, 0, 0);
}

function evalGoodbye(t: number, out: Map<GestureBoneName, THREE.Euler>): void {
  const raise = seg(t, 0, 0.6, 3.2, 3.8);
  const env = seg(t, 0.6, 0.9, 3.0, 3.3);
  const wave = Math.sin((t - 0.7) * Math.PI * 2 * 1.0);
  put(out, 'rightUpperArm', 0, 0, 0.95 * raise);
  put(out, 'rightLowerArm', 0, -0.22 + wave * 0.32 * env, 0);
  put(out, 'rightHand', 0, 0, 0.08 * wave * env);
}

function evalPoint(t: number, out: Map<GestureBoneName, THREE.Euler>): void {
  const e = seg(t, 0, 0.5, 1.7, 2.2);
  put(out, 'rightUpperArm', -0.25 * e, -0.85 * e, 0.1 * e);
  put(out, 'rightLowerArm', 0, 0.12 * e, 0);
  put(out, 'rightHand', 0, -0.1 * e, 0);
}

function evalShrug(t: number, out: Map<GestureBoneName, THREE.Euler>): void {
  const e = seg(t, 0, 0.4, 1.2, 1.6);
  put(out, 'leftUpperArm', 0, 0, -0.3 * e);
  put(out, 'rightUpperArm', 0, 0, 0.3 * e);
  put(out, 'leftLowerArm', 0, 0.1 * e, 0);
  put(out, 'rightLowerArm', 0, -0.1 * e, 0);
}

function evalClap(t: number, out: Map<GestureBoneName, THREE.Euler>): void {
  const e = seg(t, 0, 0.5, 2.1, 2.6);
  const pulse = 0.75 + 0.25 * Math.sin((t - 0.6) * Math.PI * 2 * 1.25);
  const p = e * pulse;
  put(out, 'leftUpperArm', 0, 0.55 * p, 0);
  put(out, 'rightUpperArm', 0, -0.55 * p, 0);
  put(out, 'leftLowerArm', 0, 0.45 * p, 0);
  put(out, 'rightLowerArm', 0, -0.45 * p, 0);
}

function evalBow(t: number, out: Map<GestureBoneName, THREE.Euler>): void {
  const b = seg(t, 0, 0.7, 1.6, 2.3);
  put(out, 'spine', 0.32 * b, 0, 0);
  put(out, 'neck', 0.14 * b, 0, 0);
  put(out, 'head', 0.1 * b, 0, 0);
  put(out, 'leftUpperArm', -0.15 * b, 0, 0);
  put(out, 'rightUpperArm', -0.15 * b, 0, 0);
}

const GESTURES: Record<CarlottaGestureName, GestureDef> = {
  wave: { duration: 3.4, writesTorso: false, eval: evalWave },
  greeting: { duration: 2.0, writesTorso: false, eval: evalGreeting },
  goodbye: { duration: 3.8, writesTorso: false, eval: evalGoodbye },
  point: { duration: 2.2, writesTorso: false, eval: evalPoint },
  shrug: { duration: 1.6, writesTorso: false, eval: evalShrug },
  clap: { duration: 2.6, writesTorso: false, eval: evalClap },
  bow: { duration: 2.3, writesTorso: true, eval: evalBow },
};

/** Bones each gesture needs (checked at start; missing → clean false). */
const GESTURE_REQUIREMENTS: Record<CarlottaGestureName, GestureBoneName[]> = {
  wave: ['rightUpperArm', 'rightLowerArm', 'rightHand'],
  greeting: ['rightUpperArm', 'rightLowerArm', 'rightHand'],
  goodbye: ['rightUpperArm', 'rightLowerArm', 'rightHand'],
  point: ['rightUpperArm', 'rightLowerArm', 'rightHand'],
  shrug: ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'],
  clap: ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'],
  bow: ['spine', 'neck', 'head', 'leftUpperArm', 'rightUpperArm'],
};

/** Blend-in on start/replace and blend-out on recovery (seconds). */
const START_BLEND = 0.25;
const RECOVER_BLEND = 0.4;

export class CarlottaGestureController {
  private bones = new Map<GestureBoneName, ControlledBone>();
  private initialized = false;
  private active: CarlottaGestureName | null = null;
  private phase: GesturePhase = 'idle';
  private time = 0;
  private blendT = 1; // 0→1 start-blend progress
  private recoverT = 1; // 0→1 recovery progress
  private completed: CarlottaGestureName | null = null;
  /**
   * Bones this layer currently owns offsets on. Only owned bones are ever
   * written — torso bones stay body-driven unless the active recipe drives
   * them (bow), and released bones decay back here, never in the body layer.
   */
  private owned = new Set<GestureBoneName>();

  /** Resolve arm/hand (+ torso for bow) bones; capture relaxed bases. */
  public init(vrm: VRM): void {
    this.reset();
    const wanted: GestureBoneName[] = [...ARM_BONES, ...TORSO_BONES];
    for (const name of wanted) {
      const node = vrm.humanoid.getRawBoneNode(name);
      if (!node) {
        console.warn(`[CarloGesture] bone "${name}" missing — gestures needing it will refuse`);
        continue;
      }
      this.bones.set(name, {
        name,
        node,
        base: node.quaternion.clone(),
        from: new THREE.Euler(),
        current: new THREE.Euler(),
      });
    }
    this.initialized = this.bones.size > 0;
    console.log(`[CarloGesture] controller initialized (${this.bones.size}/${wanted.length} bones)`);
    this.registerDevHooks();
  }

  public getIsInitialized(): boolean {
    return this.initialized;
  }

  public getActive(): CarlottaGestureName | null {
    return this.active;
  }

  public getPhase(): GesturePhase {
    return this.phase;
  }

  /** Last fully completed gesture (cleared on next start/reset). */
  public getCompleted(): CarlottaGestureName | null {
    return this.completed;
  }

  /**
   * Start a gesture (replaces any active one via snapshot blend).
   * Returns false for unknown names or missing required bones.
   */
  public start(name: CarlottaGestureName): boolean {
    if (!isValidCarlottaGestureName(name)) return false;
    if (!this.initialized) return false;
    const required = GESTURE_REQUIREMENTS[name];
    for (const bone of required) {
      if (!this.bones.has(bone)) return false;
    }
    // Snapshot live offsets so a replace never snaps.
    for (const bone of this.bones.values()) {
      bone.from.copy(bone.current);
    }
    this.active = name;
    this.phase = 'active';
    this.time = 0;
    this.blendT = 0;
    this.completed = null;
    const def = GESTURES[name];
    // Own the torso yield exactly while a torso-writing gesture is active;
    // any other start (including replacing a bow) releases it.
    carlottaAnimationController.setBodyHold(def.writesTorso);
    if (isDevBuild()) {
      console.info(`[CarloGesture] start=${name} phase=active`);
    }
    return true;
  }

  /** Cancel the active gesture: blend back to base, then complete. */
  public cancel(): void {
    if (!this.active || this.phase !== 'active') return;
    for (const bone of this.bones.values()) {
      bone.from.copy(bone.current);
    }
    this.phase = 'recovering';
    this.recoverT = 0;
  }

  /** Restore bases, clear holds and state (unload path). */
  public reset(): void {
    for (const bone of this.bones.values()) {
      bone.node.quaternion.copy(bone.base);
      bone.current.set(0, 0, 0);
      bone.from.set(0, 0, 0);
    }
    this.bones.clear();
    this.initialized = false;
    this.active = null;
    this.phase = 'idle';
    this.time = 0;
    this.blendT = 1;
    this.recoverT = 1;
    this.completed = null;
    this.owned.clear();
    carlottaAnimationController.setBodyHold(false);
  }

  // DEV-only runtime diagnostics accumulator (2-second interval).
  private diagAcc = 0;

  /**
   * Advance the gesture layer. Call once per frame AFTER
   * `carlottaAnimationController.update()` (body first, arms last).
   */
  public update(delta: number): void {
    // DEV-only diagnostic: log gesture state every 2s.
    if (isDevBuild()) {
      this.diagAcc += delta;
      if (this.diagAcc >= 2) {
        this.diagAcc = 0;
        console.info(
          `[CarloGestDiag] init=${this.initialized} active=${this.active}` +
          ` phase=${this.phase} owned=${this.owned.size} bones=${this.bones.size}`
        );
      }
    }
    if (!this.initialized || !this.active) return;
    const def = GESTURES[this.active];
    const dt = Math.max(0, Math.min(delta, CARLOTTA_IDLE_MAX_DELTA));

    if (this.phase === 'active') {
      this.time += dt;
      if (this.blendT < 1) this.blendT = Math.min(1, this.blendT + dt / START_BLEND);
      const w = ss(0, 1, this.blendT);
      _evalOut.clear();
      def.eval(Math.min(this.time, def.duration), _evalOut);
      for (const bone of this.bones.values()) {
        const target = _evalOut.get(bone.name);
        if (target) {
          bone.current.set(
            bone.from.x * (1 - w) + target.x * w,
            bone.from.y * (1 - w) + target.y * w,
            bone.from.z * (1 - w) + target.z * w,
          );
          this.owned.add(bone.name);
        } else if (this.owned.has(bone.name)) {
          // Previously owned but no longer driven: release toward base.
          bone.current.set(
            bone.from.x * (1 - w),
            bone.from.y * (1 - w),
            bone.from.z * (1 - w),
          );
          if (Math.abs(bone.current.x) + Math.abs(bone.current.y) + Math.abs(bone.current.z) < 0.0005) {
            bone.current.set(0, 0, 0);
            this.owned.delete(bone.name);
            continue;
          }
        } else {
          continue;
        }
        _euler.copy(bone.current);
        _quat.setFromEuler(_euler);
        bone.node.quaternion.copy(bone.base).multiply(_quat);
      }
      if (this.time >= def.duration) {
        this.phase = 'recovering';
        this.recoverT = 0;
        for (const bone of this.bones.values()) {
          bone.from.copy(bone.current);
        }
      }
      return;
    }

    // recovering: blend owned snapshot back to base, then release + complete.
    this.recoverT = Math.min(1, this.recoverT + dt / RECOVER_BLEND);
    const w = 1 - ss(0, 1, this.recoverT);
    for (const bone of this.bones.values()) {
      if (!this.owned.has(bone.name)) continue;
      bone.current.set(bone.from.x * w, bone.from.y * w, bone.from.z * w);
      _euler.copy(bone.current);
      _quat.setFromEuler(_euler);
      bone.node.quaternion.copy(bone.base).multiply(_quat);
    }
    if (this.recoverT >= 1) {
      const done = this.active;
      this.active = null;
      this.phase = 'idle';
      this.completed = done;
      this.owned.clear();
      carlottaAnimationController.setBodyHold(false);
      if (isDevBuild()) {
        console.info(`[CarloGesture] gesture=${done} phase=complete`);
      }
    }
  }

  /** Temporary DEV-only hooks (validated start, info reader, cancel). */
  private registerDevHooks(): void {
    if (!isDevBuild()) return;
    try {
      const w = window as unknown as Record<string, unknown>;
      w.__carlottaGestureStart = (name: unknown): boolean =>
        typeof name === 'string' && this.start(name as CarlottaGestureName);
      w.__carlottaGestureInfo = (): {
        name: CarlottaGestureName | null;
        phase: GesturePhase;
        t: number;
      } => ({ name: this.active, phase: this.phase, t: Math.round(this.time * 100) / 100 });
      w.__carlottaGestureCancel = (): void => {
        this.cancel();
      };
    } catch {
      /* non-browser runtimes: hooks unavailable */
    }
  }
}

export const carlottaGestureController = new CarlottaGestureController();
