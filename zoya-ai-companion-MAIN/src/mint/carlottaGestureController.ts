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

function ss(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function seg(t: number, a: number, b: number, c: number, d: number): number {
  return ss(a, b, t) * (1 - ss(c, d, t));
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

interface ControlledBone {
  name: GestureBoneName;
  node: THREE.Object3D;
  base: THREE.Quaternion;
  from: THREE.Euler;
  current: THREE.Euler;
}

interface GestureDef {
  duration: number;
  writesTorso: boolean;
  eval: (t: number, out: Map<GestureBoneName, THREE.Euler>) => void;
}

const _evalOut = new Map<GestureBoneName, THREE.Euler>();

function put(out: Map<GestureBoneName, THREE.Euler>, name: GestureBoneName, x: number, y: number, z: number): void {
  let e = out.get(name);
  if (!e) {
    e = new THREE.Euler();
    out.set(name, e);
  }
  e.set(x, y, z);
}

function evalWave(t: number, out: Map<GestureBoneName, THREE.Euler>): void {
  const raise = seg(t, 0, 0.45, 2.9, 3.4);
  const env = seg(t, 0.45, 0.7, 2.7, 3.0);
  const wave = Math.sin((t - 0.55) * Math.PI * 2 * 1.35);
  put(out, 'rightUpperArm', 0, 0, 1.05 * raise);
  put(out, 'rightLowerArm', 0, -0.30 + wave * 0.42 * env, 0);
  put(out, 'rightHand', 0, 0, 0.14 * wave * env);
}

function evalGreeting(t: number, out: Map<GestureBoneName, THREE.Euler>): void {
  const raise = seg(t, 0, 0.35, 1.55, 1.9);
  const env = seg(t, 0.35, 0.55, 1.35, 1.65);
  const sway = Math.sin((t - 0.35) * Math.PI * 2 * 0.65);
  put(out, 'rightUpperArm', 0, 0, 0.75 * raise);
  put(out, 'rightLowerArm', 0, -0.30 + sway * 0.38 * env, 0);
  put(out, 'rightHand', 0, 0, 0.12 * sway * env);
}

function evalGoodbye(t: number, out: Map<GestureBoneName, THREE.Euler>): void {
  const raise = seg(t, 0, 0.5, 3.25, 3.8);
  const env = seg(t, 0.5, 0.8, 3.0, 3.35);
  const wave = Math.sin((t - 0.65) * Math.PI * 2 * 1.15);
  put(out, 'rightUpperArm', 0, 0, 1.05 * raise);
  put(out, 'rightLowerArm', 0, -0.30 + wave * 0.48 * env, 0);
  put(out, 'rightHand', 0, 0, 0.16 * wave * env);
}

function evalPoint(t: number, out: Map<GestureBoneName, THREE.Euler>): void {
  const e = seg(t, 0, 0.45, 1.65, 2.15);
  put(out, 'rightUpperArm', -0.28 * e, -0.95 * e, 0.12 * e);
  put(out, 'rightLowerArm', 0, 0.18 * e, 0);
  put(out, 'rightHand', 0, -0.14 * e, 0);
}

function evalShrug(t: number, out: Map<GestureBoneName, THREE.Euler>): void {
  const e = seg(t, 0, 0.32, 1.15, 1.55);
  const settle = Math.sin(t * Math.PI * 2 * 1.2) * 0.04 * e;
  put(out, 'leftUpperArm', 0, 0, (-0.72 + settle) * e);
  put(out, 'rightUpperArm', 0, 0, (0.72 + settle) * e);
  put(out, 'leftLowerArm', 0, 0.20 * e, 0);
  put(out, 'rightLowerArm', 0, -0.20 * e, 0);
}

function evalClap(t: number, out: Map<GestureBoneName, THREE.Euler>): void {
  const e = seg(t, 0, 0.35, 2.15, 2.6);
  const cycle = Math.sin((t - 0.35) * Math.PI * 2 * 1.75);
  const close = 0.5 + 0.5 * cycle;
  const open = 1 - close;
  const fore = 0.22 + 0.78 * close;
  put(out, 'leftUpperArm', 0, (0.22 * open + 0.78 * close) * e, -0.18 * e);
  put(out, 'rightUpperArm', 0, -(0.22 * open + 0.78 * close) * e, 0.18 * e);
  put(out, 'leftLowerArm', 0, (0.18 * open + 0.62 * fore) * e, -0.08 * e);
  put(out, 'rightLowerArm', 0, -(0.18 * open + 0.62 * fore) * e, 0.08 * e);
  put(out, 'leftHand', 0, 0.10 * close * e, -0.05 * e);
  put(out, 'rightHand', 0, -0.10 * close * e, 0.05 * e);
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
  greeting: { duration: 1.9, writesTorso: false, eval: evalGreeting },
  goodbye: { duration: 3.8, writesTorso: false, eval: evalGoodbye },
  point: { duration: 2.15, writesTorso: false, eval: evalPoint },
  shrug: { duration: 1.55, writesTorso: false, eval: evalShrug },
  clap: { duration: 2.6, writesTorso: false, eval: evalClap },
  bow: { duration: 2.3, writesTorso: true, eval: evalBow },
};

const GESTURE_REQUIREMENTS: Record<CarlottaGestureName, GestureBoneName[]> = {
  wave: ['rightUpperArm', 'rightLowerArm', 'rightHand'],
  greeting: ['rightUpperArm', 'rightLowerArm', 'rightHand'],
  goodbye: ['rightUpperArm', 'rightLowerArm', 'rightHand'],
  point: ['rightUpperArm', 'rightLowerArm', 'rightHand'],
  shrug: ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'],
  clap: ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'],
  bow: ['spine', 'neck', 'head', 'leftUpperArm', 'rightUpperArm'],
};

const START_BLEND = 0.25;
const RECOVER_BLEND = 0.4;

export class CarlottaGestureController {
  private bones = new Map<GestureBoneName, ControlledBone>();
  private initialized = false;
  private active: CarlottaGestureName | null = null;
  private phase: GesturePhase = 'idle';
  private time = 0;
  private blendT = 1;
  private recoverT = 1;
  private completed: CarlottaGestureName | null = null;
  private owned = new Set<GestureBoneName>();

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

  public getIsInitialized(): boolean { return this.initialized; }
  public getActive(): CarlottaGestureName | null { return this.active; }
  public getPhase(): GesturePhase { return this.phase; }
  public getCompleted(): CarlottaGestureName | null { return this.completed; }

  public start(name: CarlottaGestureName): boolean {
    if (!isValidCarlottaGestureName(name) || !this.initialized) return false;
    for (const bone of GESTURE_REQUIREMENTS[name]) {
      if (!this.bones.has(bone)) return false;
    }
    for (const bone of this.bones.values()) bone.from.copy(bone.current);
    this.active = name;
    this.phase = 'active';
    this.time = 0;
    this.blendT = 0;
    this.completed = null;
    carlottaAnimationController.setBodyHold(GESTURES[name].writesTorso);
    if (isDevBuild()) console.info(`[CarloGesture] start=${name} phase=active`);
    return true;
  }

  public cancel(): void {
    if (!this.active || this.phase !== 'active') return;
    for (const bone of this.bones.values()) bone.from.copy(bone.current);
    this.phase = 'recovering';
    this.recoverT = 0;
  }

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

  private diagAcc = 0;

  public update(delta: number): void {
    if (isDevBuild()) {
      this.diagAcc += delta;
      if (this.diagAcc >= 2) {
        this.diagAcc = 0;
        console.info(`[CarloGestDiag] init=${this.initialized} active=${this.active} phase=${this.phase} owned=${this.owned.size} bones=${this.bones.size}`);
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
        for (const bone of this.bones.values()) bone.from.copy(bone.current);
      }
      return;
    }

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
      if (isDevBuild()) console.info(`[CarloGesture] gesture=${done} phase=complete`);
    }
  }

  private registerDevHooks(): void {
    if (!isDevBuild()) return;
    try {
      const w = window as unknown as Record<string, unknown>;
      w.__carlottaGestureStart = (name: unknown): boolean =>
        typeof name === 'string' && this.start(name as CarlottaGestureName);
      w.__carlottaGestureInfo = (): { name: CarlottaGestureName | null; phase: GesturePhase; t: number } => ({
        name: this.active,
        phase: this.phase,
        t: Math.round(this.time * 100) / 100,
      });
      w.__carlottaGestureCancel = (): void => { this.cancel(); };
    } catch {
      /* non-browser runtimes: hooks unavailable */
    }
  }
}

export const carlottaGestureController = new CarlottaGestureController();
