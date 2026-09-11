import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { CARLOTTA_IDLE_MAX_DELTA } from './carlottaIdleController';
import { carlottaAnimationController } from './carlottaAnimationController';
import { isDevBuild } from './runtimeEnv';

/**
 * CarlottaGestureController — rebuilt procedural gesture layer.
 *
 * Gestures are authored as readable pose keyframes instead of tangled sine
 * formulas. Each sequence has a preparation, a clear readable pose, motion
 * beats, and a deliberate return. Keyframes are additive offsets from the
 * known-good relaxed Carlotta pose captured at init.
 *
 * No animation clips, AnimationMixer, external animation files, skeleton
 * replacement, mesh edits, or per-frame allocations. The existing idle/body
 * controller remains the source of the base pose; this layer only adds its
 * gesture offsets. Bow is the only gesture allowed to own torso bones.
 *
 * The loader rotates Carlotta's root 180 degrees, making her visual front +Z.
 * Existing local-frame conventions are retained: right arm down is -Z, left
 * arm down is +Z, right forward elbow swing is -Y, left is +Y, and forward
 * bow pitch is -X.
 */

export type CarlottaGestureName =
  | 'wave' | 'greeting' | 'goodbye' | 'point' | 'shrug' | 'clap' | 'bow';

export function isValidCarlottaGestureName(value: unknown): value is CarlottaGestureName {
  return (
    value === 'wave' || value === 'greeting' || value === 'goodbye' ||
    value === 'point' || value === 'shrug' || value === 'clap' || value === 'bow'
  );
}

export type GesturePhase = 'idle' | 'active' | 'recovering';

type ArmBoneName =
  | 'leftUpperArm' | 'leftLowerArm' | 'leftHand'
  | 'rightUpperArm' | 'rightLowerArm' | 'rightHand';
type TorsoBoneName = 'spine' | 'neck' | 'head';
type GestureBoneName = ArmBoneName | TorsoBoneName;

const ARM_BONES: ArmBoneName[] = [
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
];
const TORSO_BONES: TorsoBoneName[] = ['spine', 'neck', 'head'];

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

interface Pose {
  leftUpperArm?: [number, number, number];
  leftLowerArm?: [number, number, number];
  leftHand?: [number, number, number];
  rightUpperArm?: [number, number, number];
  rightLowerArm?: [number, number, number];
  rightHand?: [number, number, number];
  spine?: [number, number, number];
  neck?: [number, number, number];
  head?: [number, number, number];
}

interface Keyframe {
  time: number;
  pose: Pose;
}

interface GestureDef {
  duration: number;
  writesTorso: boolean;
  keyframes: readonly Keyframe[];
  required: readonly GestureBoneName[];
}

function pose(
  rightUpperArm?: [number, number, number],
  rightLowerArm?: [number, number, number],
  rightHand?: [number, number, number],
  leftUpperArm?: [number, number, number],
  leftLowerArm?: [number, number, number],
  leftHand?: [number, number, number],
  spine?: [number, number, number],
  neck?: [number, number, number],
  head?: [number, number, number],
): Pose {
  return { rightUpperArm, rightLowerArm, rightHand, leftUpperArm, leftLowerArm, leftHand, spine, neck, head };
}

function key(time: number, p: Pose): Keyframe {
  return { time, pose: p };
}

/* Additive offsets from the relaxed pose. */
const WAVE: readonly Keyframe[] = [
  key(0.00, pose()),
  key(0.38, pose([0, 0, 1.05], [0, -0.18, 0])),
  key(0.72, pose([0, 0, 1.52], [0, -0.55, 0])),
  key(1.05, pose([0, 0, 1.52], [0, -0.22, 0], [0, 0, 0.10])),
  key(1.38, pose([0, 0, 1.52], [0, -0.68, 0], [0, 0, -0.16])),
  key(1.70, pose([0, 0, 1.52], [0, -0.20, 0], [0, 0, 0.16])),
  key(2.02, pose([0, 0, 1.52], [0, -0.68, 0], [0, 0, -0.16])),
  key(2.34, pose([0, 0, 1.52], [0, -0.20, 0], [0, 0, 0.16])),
  key(2.68, pose([0, 0, 1.40], [0, -0.38, 0], [0, 0, 0.08])),
  key(3.02, pose([0, 0, 0.85], [0, -0.16, 0])),
  key(3.40, pose()),
];

const GREETING: readonly Keyframe[] = [
  key(0.00, pose()),
  key(0.35, pose([0, 0, 1.00], [0, -0.18, 0])),
  key(0.65, pose([0, 0, 1.46], [0, -0.48, 0])),
  key(0.95, pose([0, 0, 1.46], [0, -0.16, 0], [0, 0, 0.10])),
  key(1.25, pose([0, 0, 1.46], [0, -0.54, 0], [0, 0, -0.10])),
  key(1.55, pose([0, 0, 1.46], [0, -0.16, 0], [0, 0, 0.10])),
  key(1.80, pose([0, 0, 1.20], [0, -0.30, 0])),
  key(2.15, pose()),
];

const GOODBYE: readonly Keyframe[] = [
  key(0.00, pose()),
  key(0.45, pose([0, 0, 1.10], [0, -0.20, 0])),
  key(0.78, pose([0, 0, 1.55], [0, -0.52, 0])),
  key(1.05, pose([0, 0, 1.55], [0, -0.18, 0], [0, 0, 0.12])),
  key(1.35, pose([0, 0, 1.55], [0, -0.70, 0], [0, 0, -0.18])),
  key(1.68, pose([0, 0, 1.55], [0, -0.18, 0], [0, 0, 0.18])),
  key(2.01, pose([0, 0, 1.55], [0, -0.70, 0], [0, 0, -0.18])),
  key(2.34, pose([0, 0, 1.55], [0, -0.18, 0], [0, 0, 0.18])),
  key(2.67, pose([0, 0, 1.55], [0, -0.70, 0], [0, 0, -0.18])),
  key(3.00, pose([0, 0, 1.55], [0, -0.24, 0], [0, 0, 0.10])),
  key(3.35, pose([0, 0, 1.08], [0, -0.16, 0])),
  key(3.80, pose()),
];

const POINT: readonly Keyframe[] = [
  key(0.00, pose()),
  key(0.38, pose([0, -0.36, 0.42], [0, -0.05, 0])),
  key(0.78, pose([0, -0.82, 0.78], [0, -0.10, 0], [0, -0.10, 0])),
  key(1.20, pose([0, -1.00, 0.94], [0, -0.16, 0], [0, -0.18, 0])),
  key(1.60, pose([0, -1.00, 0.94], [0, -0.16, 0], [0, -0.18, 0])),
  key(1.90, pose([0, -0.62, 0.58], [0, -0.08, 0])),
  key(2.15, pose()),
];

const SHRUG: readonly Keyframe[] = [
  key(0.00, pose()),
  key(0.25, pose([0, 0, 0.28], undefined, undefined, [0, 0, -0.28])),
  key(0.55, pose([0, 0, 0.72], [0, -0.12, 0], undefined, [0, 0, -0.72], [0, 0.12, 0])),
  key(0.90, pose([0, 0, 0.72], [0, -0.18, 0], undefined, [0, 0, -0.72], [0, 0.18, 0])),
  key(1.20, pose([0, 0, 0.48], [0, -0.08, 0], undefined, [0, 0, -0.48], [0, 0.08, 0])),
  key(1.60, pose()),
];

const CLAP: readonly Keyframe[] = [
  key(0.00, pose()),
  key(0.30, pose([0, -0.22, 0.42], [0, -0.25, 0], undefined, [0, 0.22, -0.42], [0, 0.25, 0])),
  key(0.70, pose([0, -0.48, 0.92], [0, -0.72, 0], [0, 0, 0.12], [0, 0.48, -0.92], [0, 0.72, 0], [0, 0, -0.12])),
  key(1.05, pose([0, -0.42, 0.84], [0, -0.90, 0], [0, 0, 0.08], [0, 0.42, -0.84], [0, 0.90, 0], [0, 0, -0.08])),
  key(1.32, pose([0, -0.50, 0.96], [0, -0.98, 0], [0, 0, 0.13], [0, 0.50, -0.96], [0, 0.98, 0], [0, 0, -0.13])),
  key(1.62, pose([0, -0.42, 0.84], [0, -0.90, 0], [0, 0, 0.08], [0, 0.42, -0.84], [0, 0.90, 0], [0, 0, -0.08])),
  key(1.90, pose([0, -0.50, 0.96], [0, -0.98, 0], [0, 0, 0.13], [0, 0.50, -0.96], [0, 0.98, 0], [0, 0, -0.13])),
  key(2.20, pose([0, -0.30, 0.58], [0, -0.42, 0], undefined, [0, 0.30, -0.58], [0, 0.42, 0])),
  key(2.70, pose()),
];

const BOW: readonly Keyframe[] = [
  key(0.00, pose()),
  key(0.35, pose(undefined, undefined, undefined, undefined, undefined, undefined, -0.10, -0.04, -0.03)),
  key(0.72, pose([-0.06, 0, 0], undefined, undefined, [-0.06, 0, 0], undefined, undefined, -0.34, -0.12, -0.08)),
  key(1.12, pose([-0.10, 0, 0], undefined, undefined, [-0.10, 0, 0], undefined, undefined, -0.48, -0.16, -0.10)),
  key(1.50, pose([-0.10, 0, 0], undefined, undefined, [-0.10, 0, 0], undefined, undefined, -0.48, -0.16, -0.10)),
  key(1.85, pose([-0.05, 0, 0], undefined, undefined, [-0.05, 0, 0], undefined, undefined, -0.28, -0.10, -0.06)),
  key(2.30, pose()),
];

const REQUIRE_ARM_RIGHT: readonly GestureBoneName[] = ['rightUpperArm', 'rightLowerArm', 'rightHand'];
const REQUIRE_SHRUG: readonly GestureBoneName[] = ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'];
const REQUIRE_CLAP: readonly GestureBoneName[] = ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'];
const REQUIRE_BOW: readonly GestureBoneName[] = ['spine', 'neck', 'head', 'leftUpperArm', 'rightUpperArm'];

const GESTURES: Record<CarlottaGestureName, GestureDef> = {
  wave: { duration: 3.4, writesTorso: false, keyframes: WAVE, required: REQUIRE_ARM_RIGHT },
  greeting: { duration: 2.15, writesTorso: false, keyframes: GREETING, required: REQUIRE_ARM_RIGHT },
  goodbye: { duration: 3.8, writesTorso: false, keyframes: GOODBYE, required: REQUIRE_ARM_RIGHT },
  point: { duration: 2.15, writesTorso: false, keyframes: POINT, required: REQUIRE_ARM_RIGHT },
  shrug: { duration: 1.6, writesTorso: false, keyframes: SHRUG, required: REQUIRE_SHRUG },
  clap: { duration: 2.7, writesTorso: false, keyframes: CLAP, required: REQUIRE_CLAP },
  bow: { duration: 2.3, writesTorso: true, keyframes: BOW, required: REQUIRE_BOW },
};

const START_BLEND = 0.16;
const RECOVER_BLEND = 0.32;

interface ControlledBone {
  name: GestureBoneName;
  node: THREE.Object3D;
  base: THREE.Quaternion;
  current: THREE.Vector3;
  from: THREE.Vector3;
  target: THREE.Vector3;
  sampled: THREE.Vector3;
}

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

export class CarlottaGestureController {
  private bones = new Map<GestureBoneName, ControlledBone>();
  private initialized = false;
  private active: CarlottaGestureName | null = null;
  private phase: GesturePhase = 'idle';
  private time = 0;
  private blendT = 1;
  private recoverT = 1;
  private completed: CarlottaGestureName | null = null;
  private diagAcc = 0;

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
        current: new THREE.Vector3(),
        from: new THREE.Vector3(),
        target: new THREE.Vector3(),
        sampled: new THREE.Vector3(),
      });
    }
    this.initialized = this.bones.size > 0;
    console.log(`[CarloGesture] rebuilt controller initialized (${this.bones.size}/${wanted.length} bones)`);
    this.registerDevHooks();
  }

  public getIsInitialized(): boolean { return this.initialized; }
  public getActive(): CarlottaGestureName | null { return this.active; }
  public getPhase(): GesturePhase { return this.phase; }
  public getCompleted(): CarlottaGestureName | null { return this.completed; }

  public start(name: CarlottaGestureName): boolean {
    if (!isValidCarlottaGestureName(name) || !this.initialized) return false;
    const def = GESTURES[name];
    for (const required of def.required) if (!this.bones.has(required)) return false;

    for (const bone of this.bones.values()) bone.from.copy(bone.current);
    this.active = name;
    this.phase = 'active';
    this.time = 0;
    this.blendT = 0;
    this.completed = null;
    carlottaAnimationController.setBodyHold(def.writesTorso);
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
    for (const bone of this.bones.values()) bone.node.quaternion.copy(bone.base);
    this.bones.clear();
    this.initialized = false;
    this.active = null;
    this.phase = 'idle';
    this.time = 0;
    this.blendT = 1;
    this.recoverT = 1;
    this.completed = null;
    carlottaAnimationController.setBodyHold(false);
  }

  private poseValue(p: Pose, name: GestureBoneName): [number, number, number] | undefined {
    return p[name as keyof Pose] as [number, number, number] | undefined;
  }

  private sample(def: GestureDef, t: number): void {
    const frames = def.keyframes;
    let a = frames[0];
    let b = frames[frames.length - 1];
    for (let i = 1; i < frames.length; i += 1) {
      if (t <= frames[i].time) {
        b = frames[i];
        a = frames[i - 1];
        break;
      }
    }
    const span = Math.max(0.0001, b.time - a.time);
    const w = smoothstep((t - a.time) / span);

    for (const bone of this.bones.values()) {
      const av = this.poseValue(a.pose, bone.name);
      const bv = this.poseValue(b.pose, bone.name);
      const ax = av ? av[0] : 0; const ay = av ? av[1] : 0; const az = av ? av[2] : 0;
      const bx = bv ? bv[0] : 0; const by = bv ? bv[1] : 0; const bz = bv ? bv[2] : 0;
      bone.sampled.set(
        ax + (bx - ax) * w,
        ay + (by - ay) * w,
        az + (bz - az) * w,
      );
    }
  }

  public update(delta: number): void {
    if (isDevBuild()) {
      this.diagAcc += delta;
      if (this.diagAcc >= 2) {
        this.diagAcc = 0;
        console.info(`[CarloGestDiag] init=${this.initialized} active=${this.active} phase=${this.phase} bones=${this.bones.size}`);
      }
    }
    if (!this.initialized || !this.active) return;
    const dt = Math.max(0, Math.min(delta, CARLOTTA_IDLE_MAX_DELTA));
    const def = GESTURES[this.active];

    if (this.phase === 'active') {
      this.time += dt;
      this.blendT = Math.min(1, this.blendT + dt / START_BLEND);
      const blend = smoothstep(this.blendT);
      this.sample(def, Math.min(this.time, def.duration));

      for (const bone of this.bones.values()) {
        bone.current.lerpVectors(bone.from, bone.sampled, blend);
        _euler.set(bone.current.x, bone.current.y, bone.current.z);
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
    const w = 1 - smoothstep(this.recoverT);
    for (const bone of this.bones.values()) {
      bone.current.copy(bone.from).multiplyScalar(w);
      _euler.set(bone.current.x, bone.current.y, bone.current.z);
      _quat.setFromEuler(_euler);
      bone.node.quaternion.copy(bone.base).multiply(_quat);
    }

    if (this.recoverT >= 1) {
      const done = this.active;
      this.active = null;
      this.phase = 'idle';
      this.completed = done;
      for (const bone of this.bones.values()) bone.current.set(0, 0, 0);
      carlottaAnimationController.setBodyHold(false);
    }
  }

  private registerDevHooks(): void {
    if (!isDevBuild()) return;
    try {
      const w = window as unknown as Record<string, unknown>;
      w.__carlottaGestureStart = (name: unknown): boolean => {
        if (!isValidCarlottaGestureName(name)) return false;
        return this.start(name);
      };
      w.__carlottaGestureInfo = (): {
        active: CarlottaGestureName | null;
        phase: GesturePhase;
        completed: CarlottaGestureName | null;
      } => ({ active: this.active, phase: this.phase, completed: this.completed });
      w.__carlottaGestureCancel = (): void => this.cancel();
    } catch {
      /* non-browser runtime */
    }
  }
}

export const carlottaGestureController = new CarlottaGestureController();