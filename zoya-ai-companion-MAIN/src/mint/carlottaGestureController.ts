import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { CARLOTTA_IDLE_MAX_DELTA } from './carlottaIdleController';
import { isDevBuild } from './runtimeEnv';

/**
 * Carlotta Gesture Controller — clean procedural gesture foundation.
 *
 * Design rules:
 * - Gestures are authored as character-space spatial targets, never guessed
 *   Euler angles.
 * - The character frame is derived from the loaded VRM scene, including ZOYA's
 *   existing 180° root correction. No orientation sign-flips are hard-coded.
 * - The controller snapshots the actual pose when a gesture starts, solves a
 *   target pose, blends into it, then returns to that exact starting pose.
 * - Point is the diagnostic spatial gesture while the solver is being proven.
 * - The normal idle controller remains completely independent and untouched.
 */

export type CarlottaGestureName = 'wave' | 'greeting' | 'goodbye' | 'point' | 'shrug' | 'clap' | 'bow';

export function isValidCarlottaGestureName(value: unknown): value is CarlottaGestureName {
  return value === 'wave' || value === 'greeting' || value === 'goodbye' || value === 'point' || value === 'shrug' || value === 'clap' || value === 'bow';
}

export type GesturePhase = 'idle' | 'active' | 'recovering';
type BoneName = 'rightUpperArm' | 'rightLowerArm' | 'rightHand';

type BoneState = {
  name: BoneName;
  node: THREE.Object3D;
  restLocal: THREE.Quaternion;
  restWorld: THREE.Quaternion;
  restDirection: THREE.Vector3;
  from: THREE.Quaternion;
  target: THREE.Quaternion;
};

const POINT_DURATION = 1.65;
const START_BLEND_SECONDS = 0.22;
const RECOVER_BLEND_SECONDS = 0.28;
const EPSILON = 1e-8;

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function worldToLocal(node: THREE.Object3D, world: THREE.Quaternion, out: THREE.Quaternion): void {
  if (!node.parent) {
    out.copy(world);
    return;
  }
  node.parent.getWorldQuaternion(_q0);
  _q0.invert();
  out.copy(_q0).multiply(world).normalize();
}

function captureRestDirection(node: THREE.Object3D, child: THREE.Object3D | null, restWorld: THREE.Quaternion): THREE.Vector3 {
  node.getWorldPosition(_v0);
  if (child) {
    child.getWorldPosition(_v1);
    _v1.sub(_v0);
    if (_v1.lengthSq() > EPSILON) return _v1.normalize().clone();
  }
  return _v2.set(0, 1, 0).applyQuaternion(restWorld).normalize().clone();
}

export class CarlottaGestureController {
  private bones = new Map<BoneName, BoneState>();
  private initialized = false;
  private active: CarlottaGestureName | null = null;
  private phase: GesturePhase = 'idle';
  private elapsed = 0;
  private recovery = 1;
  private completed: CarlottaGestureName | null = null;
  private diagnosticsElapsed = 0;

  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  private target = new THREE.Vector3();
  private shoulder = new THREE.Vector3();
  private elbowTarget = new THREE.Vector3();
  private pointDirection = new THREE.Vector3();

  public init(vrm: VRM): void {
    this.reset();

    const upper = vrm.humanoid.getRawBoneNode('rightUpperArm');
    const lower = vrm.humanoid.getRawBoneNode('rightLowerArm');
    const hand = vrm.humanoid.getRawBoneNode('rightHand');

    if (upper) this.captureBone('rightUpperArm', upper, lower);
    else console.warn('[CarloGesture] missing bone: rightUpperArm');
    if (lower) this.captureBone('rightLowerArm', lower, hand);
    else console.warn('[CarloGesture] missing bone: rightLowerArm');
    if (hand) this.captureBone('rightHand', hand, null);
    else console.warn('[CarloGesture] missing bone: rightHand');

    vrm.scene.updateMatrixWorld(true);
    vrm.scene.getWorldQuaternion(_q1);

    // Carlotta's VRM source faces -Z. ZOYA already applies the 180° Y root
    // correction when loading her, so the model's actual character-forward
    // axis is the root-transformed -Z axis (not +Z). Using +Z here sends the
    // IK target behind the character and produces the sideways/backward arm
    // seen in the previous Point diagnostic.
    this.forward.set(0, 0, -1).applyQuaternion(_q1).normalize();
    this.right.set(1, 0, 0).applyQuaternion(_q1).normalize();
    this.up.set(0, 1, 0).applyQuaternion(_q1).normalize();

    this.initialized = !!upper && !!lower;
    this.active = null;
    this.phase = 'idle';
    this.completed = null;
    this.recovery = 1;

    this.registerDevHooks();

    if (isDevBuild()) {
      console.info('[CarloGestureCalibration] clean spatial gesture solver ready', {
        forward: this.forward.toArray(),
        right: this.right.toArray(),
        up: this.up.toArray(),
        bones: Array.from(this.bones.keys()),
        enabled: ['point'],
      });
    }
  }

  private captureBone(name: BoneName, node: THREE.Object3D, child: THREE.Object3D | null): void {
    node.updateMatrixWorld(true);
    const restLocal = node.quaternion.clone();
    const restWorld = node.getWorldQuaternion(new THREE.Quaternion());
    this.bones.set(name, {
      name,
      node,
      restLocal,
      restWorld,
      restDirection: captureRestDirection(node, child, restWorld),
      from: restLocal.clone(),
      target: restLocal.clone(),
    });
  }

  public getIsInitialized(): boolean { return this.initialized; }
  public getActive(): CarlottaGestureName | null { return this.active; }
  public getPhase(): GesturePhase { return this.phase; }
  public getCompleted(): CarlottaGestureName | null { return this.completed; }

  public start(name: CarlottaGestureName): boolean {
    if (!this.initialized || name !== 'point' || this.active) return false;

    for (const bone of this.bones.values()) {
      bone.from.copy(bone.node.quaternion);
      bone.target.copy(bone.node.quaternion);
    }

    this.active = name;
    this.phase = 'active';
    this.elapsed = 0;
    this.recovery = 1;
    this.completed = null;

    this.solvePointTarget();
    if (isDevBuild()) console.info('[CarloGesture] POINT started from current pose');
    return true;
  }

  public cancel(): void {
    if (!this.active || this.phase !== 'active') return;
    this.phase = 'recovering';
    this.recovery = 0;
  }

  public reset(): void {
    for (const bone of this.bones.values()) bone.node.quaternion.copy(bone.restLocal);
    this.bones.clear();
    this.initialized = false;
    this.active = null;
    this.phase = 'idle';
    this.elapsed = 0;
    this.recovery = 1;
    this.completed = null;
    this.diagnosticsElapsed = 0;
    this.target.set(0, 0, 0);
    this.shoulder.set(0, 0, 0);
    this.elbowTarget.set(0, 0, 0);
    this.pointDirection.set(0, 0, 0);
  }

  private solvePointTarget(): void {
    const upper = this.bones.get('rightUpperArm');
    const lower = this.bones.get('rightLowerArm');
    const hand = this.bones.get('rightHand');
    if (!upper || !lower) return;

    upper.node.getWorldPosition(this.shoulder);
    lower.node.getWorldPosition(_v0);
    const wrist = hand ? hand.node.getWorldPosition(_v1) : _v0;

    const upperLength = Math.max(this.shoulder.distanceTo(_v0), 0.05);
    const lowerLength = Math.max(_v0.distanceTo(wrist), 0.05);

    this.target.copy(this.shoulder)
      .addScaledVector(this.forward, upperLength + lowerLength * 0.90)
      .addScaledVector(this.right, upperLength * 0.18)
      .addScaledVector(this.up, upperLength * 0.10);

    const fromShoulder = _v2.subVectors(this.target, this.shoulder);
    const distance = fromShoulder.length();
    const maxReach = Math.max(0.05, upperLength + lowerLength - 0.01);
    if (distance > maxReach) this.target.copy(this.shoulder).addScaledVector(fromShoulder.normalize(), maxReach);

    this.pointDirection.subVectors(this.target, this.shoulder).normalize();

    const planeUp = _v3.copy(this.up).addScaledVector(this.pointDirection, -this.up.dot(this.pointDirection));
    if (planeUp.lengthSq() < EPSILON) planeUp.copy(this.right);
    planeUp.normalize();

    const distanceSafe = Math.max(distance, 0.001);
    const a = upperLength;
    const b = lowerLength;
    const along = Math.max(-a, Math.min(a, (a * a - b * b + distanceSafe * distanceSafe) / (2 * distanceSafe)));
    const height = Math.sqrt(Math.max(0, a * a - along * along));
    this.elbowTarget.copy(this.shoulder)
      .addScaledVector(this.pointDirection, along)
      .addScaledVector(planeUp, height);

    this.solveBoneToward(upper, this.elbowTarget, this.shoulder);
    upper.node.quaternion.copy(upper.target);
    upper.node.updateMatrixWorld(true);

    this.solveBoneToward(lower, this.target, this.elbowTarget);

    if (hand) {
      _q0.setFromUnitVectors(hand.restDirection, this.pointDirection);
      _q2.copy(_q0).multiply(hand.restWorld).normalize();
      worldToLocal(hand.node, _q2, hand.target);
    }

    upper.node.quaternion.copy(upper.from);
    upper.node.updateMatrixWorld(true);
  }

  private solveBoneToward(bone: BoneState, end: THREE.Vector3, start: THREE.Vector3): void {
    _v4.subVectors(end, start);
    if (_v4.lengthSq() < EPSILON) {
      bone.target.copy(bone.from);
      return;
    }
    _v4.normalize();
    _q0.setFromUnitVectors(bone.restDirection, _v4);
    _q1.copy(_q0).multiply(bone.restWorld).normalize();
    worldToLocal(bone.node, _q1, bone.target);
  }

  public update(delta: number): void {
    if (!this.initialized || !this.active) return;
    const dt = Math.min(Math.max(delta, 0), CARLOTTA_IDLE_MAX_DELTA);

    if (this.phase === 'active' && this.active === 'point') {
      this.elapsed += dt;
      const activation = smoothstep(this.elapsed / START_BLEND_SECONDS);
      const progress = clamp01(this.elapsed / POINT_DURATION);
      const release = smoothstep((progress - 0.72) / 0.28);
      const weight = activation * (1 - release);

      for (const bone of this.bones.values()) {
        _q3.copy(bone.from).slerp(bone.target, weight);
        bone.node.quaternion.copy(_q3);
      }

      if (this.elapsed >= POINT_DURATION) {
        this.phase = 'recovering';
        this.recovery = 0;
        for (const bone of this.bones.values()) bone.from.copy(bone.node.quaternion);
        if (isDevBuild()) console.info('[CarloGesture] POINT -> recovering');
      }
    } else if (this.phase === 'recovering') {
      this.recovery = Math.min(1, this.recovery + dt / RECOVER_BLEND_SECONDS);
      const weight = smoothstep(this.recovery);
      for (const bone of this.bones.values()) {
        _q3.copy(bone.from).slerp(bone.restLocal, weight);
        bone.node.quaternion.copy(_q3);
      }

      if (this.recovery >= 1) {
        const finished = this.active;
        for (const bone of this.bones.values()) {
          bone.node.quaternion.copy(bone.restLocal);
          bone.from.copy(bone.restLocal);
          bone.target.copy(bone.restLocal);
        }
        this.active = null;
        this.phase = 'idle';
        this.completed = finished;
        if (isDevBuild()) console.info(`[CarloGesture] complete=${finished}`);
      }
    }

    if (isDevBuild()) {
      this.diagnosticsElapsed += dt;
      if (this.diagnosticsElapsed >= 1) {
        this.diagnosticsElapsed = 0;
        console.info('[CarloGestureDiagnostics]', {
          active: this.active,
          phase: this.phase,
          target: this.target.toArray(),
          pointDirection: this.pointDirection.toArray(),
        });
      }
    }
  }

  /** Restore the DEV hooks expected by the existing MintCanvas test controls. */
  private registerDevHooks(): void {
    if (!isDevBuild()) return;
    try {
      const w = window as unknown as Record<string, unknown>;
      w.__carlottaGestureStart = (name: unknown): boolean =>
        isValidCarlottaGestureName(name) && this.start(name);
      w.__carlottaGestureInfo = (): { active: CarlottaGestureName | null; phase: GesturePhase; completed: CarlottaGestureName | null } => ({
        active: this.active,
        phase: this.phase,
        completed: this.completed,
      });
      w.__carlottaGestureCancel = (): void => this.cancel();
    } catch {
      /* non-browser runtime */
    }
  }
}

export const carlottaGestureController = new CarlottaGestureController();
