import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { CARLOTTA_IDLE_MAX_DELTA } from './carlottaIdleController';
import { carlottaAnimationController } from './carlottaAnimationController';
import { isDevBuild } from './runtimeEnv';

/**
 * Carlotta gesture system — Phase 1 spatial pose solver.
 *
 * Gestures are solved from the loaded skeleton's calibrated rest pose rather
 * than guessed Euler angles. Point is the first diagnostic gesture; other
 * gesture names remain in the API but are intentionally disabled until the
 * spatial solver is proven.
 */

export type CarlottaGestureName = 'wave' | 'greeting' | 'goodbye' | 'point' | 'shrug' | 'clap' | 'bow';
export function isValidCarlottaGestureName(value: unknown): value is CarlottaGestureName {
  return value === 'wave' || value === 'greeting' || value === 'goodbye' || value === 'point' || value === 'shrug' || value === 'clap' || value === 'bow';
}
export type GesturePhase = 'idle' | 'active' | 'recovering';

type BoneName = 'leftUpperArm' | 'leftLowerArm' | 'leftHand' | 'rightUpperArm' | 'rightLowerArm' | 'rightHand' | 'spine' | 'neck' | 'head';
type BoneState = {
  name: BoneName;
  node: THREE.Object3D;
  base: THREE.Quaternion;
  restWorld: THREE.Quaternion;
  current: THREE.Quaternion;
  from: THREE.Quaternion;
  target: THREE.Quaternion;
  restDirection: THREE.Vector3;
};

const POINT_DURATION = 2.15;
const START_BLEND = 0.18;
const RECOVER_BLEND = 0.32;

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _parentWorld = new THREE.Quaternion();
const _parentInv = new THREE.Quaternion();
const _targetWorld = new THREE.Quaternion();
const _targetLocal = new THREE.Quaternion();

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function smoothstep(v: number): number { const t = clamp01(v); return t * t * (3 - 2 * t); }

function worldToLocalTarget(node: THREE.Object3D, targetWorld: THREE.Quaternion, out: THREE.Quaternion): void {
  if (node.parent) {
    node.parent.getWorldQuaternion(_parentWorld);
    _parentInv.copy(_parentWorld).invert();
    out.copy(_parentInv).multiply(targetWorld);
  } else {
    out.copy(targetWorld);
  }
}

function captureRestDirection(node: THREE.Object3D, child: THREE.Object3D | null, baseWorld: THREE.Quaternion): THREE.Vector3 {
  node.getWorldPosition(_v0);
  if (child) {
    child.getWorldPosition(_v1);
    const direction = _v1.sub(_v0);
    if (direction.lengthSq() > 1e-8) return direction.normalize().clone();
  }
  // Terminal-hand fallback only. The arm solver never assumes an anatomical axis.
  return _v2.set(0, 0, 1).applyQuaternion(baseWorld).normalize().clone();
}

export class CarlottaGestureController {
  private bones = new Map<BoneName, BoneState>();
  private initialized = false;
  private active: CarlottaGestureName | null = null;
  private phase: GesturePhase = 'idle';
  private time = 0;
  private blend = 1;
  private recover = 1;
  private completed: CarlottaGestureName | null = null;
  private diagAcc = 0;
  private pointTarget = new THREE.Vector3();

  public init(vrm: VRM): void {
    this.reset();
    const names: readonly BoneName[] = ['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'spine', 'neck', 'head'];
    const childMap: Partial<Record<BoneName, BoneName>> = {
      rightUpperArm: 'rightLowerArm', rightLowerArm: 'rightHand',
      leftUpperArm: 'leftLowerArm', leftLowerArm: 'leftHand',
      spine: 'neck', neck: 'head',
    };

    for (const name of names) {
      const node = vrm.humanoid.getRawBoneNode(name);
      if (!node) { console.warn(`[CarloGesture] missing bone: ${name}`); continue; }
      node.updateMatrixWorld(true);
      const base = node.quaternion.clone();
      const restWorld = node.getWorldQuaternion(new THREE.Quaternion());
      const child = childMap[name] ? vrm.humanoid.getRawBoneNode(childMap[name]!) ?? null : null;
      const restDirection = captureRestDirection(node, child, restWorld);
      this.bones.set(name, {
        name,
        node,
        base,
        restWorld,
        current: base.clone(),
        from: base.clone(),
        target: base.clone(),
        restDirection,
      });
    }

    this.initialized = this.bones.has('rightUpperArm') && this.bones.has('rightLowerArm');
    this.active = null;
    this.phase = 'idle';
    this.completed = null;
    this.logCalibration(vrm.scene);
    this.registerDevHooks();
  }

  private logCalibration(root: THREE.Object3D): void {
    if (!isDevBuild()) return;
    root.updateMatrixWorld(true);
    const upper = this.bones.get('rightUpperArm');
    const lower = this.bones.get('rightLowerArm');
    const shoulder = upper ? upper.node.getWorldPosition(_v0).clone() : null;
    const elbow = lower ? lower.node.getWorldPosition(_v1).clone() : null;
    console.info('[CarloGestureCalibration] spatial solver ready', {
      finalWorldForward: [0, 0, 1],
      finalWorldRight: [-1, 0, 0],
      shoulder: shoulder?.toArray(),
      elbow: elbow?.toArray(),
      solver: 'fixed rest pose + sequential 2-bone world-space target',
    });
  }

  public getIsInitialized(): boolean { return this.initialized; }
  public getActive(): CarlottaGestureName | null { return this.active; }
  public getPhase(): GesturePhase { return this.phase; }
  public getCompleted(): CarlottaGestureName | null { return this.completed; }

  public start(name: CarlottaGestureName): boolean {
    if (!this.initialized || name !== 'point') return false;

    for (const bone of this.bones.values()) {
      bone.from.copy(bone.node.quaternion);
      bone.current.copy(bone.node.quaternion);
      bone.target.copy(bone.base);
    }

    this.active = 'point';
    this.phase = 'active';
    this.time = 0;
    this.blend = 0;
    this.recover = 1;
    this.completed = null;
    carlottaAnimationController.setBodyHold(false);
    this.computePointPose();
    if (isDevBuild()) console.info('[CarloGesture] POINT spatial solver started');
    return true;
  }

  public cancel(): void {
    if (!this.active || this.phase !== 'active') return;
    for (const bone of this.bones.values()) bone.from.copy(bone.current);
    this.phase = 'recovering';
    this.recover = 0;
    carlottaAnimationController.setBodyHold(false);
  }

  public reset(): void {
    for (const bone of this.bones.values()) bone.node.quaternion.copy(bone.base);
    this.bones.clear();
    this.initialized = false;
    this.active = null;
    this.phase = 'idle';
    this.time = 0;
    this.blend = 1;
    this.recover = 1;
    this.completed = null;
    this.diagAcc = 0;
  }

  private computePointPose(): void {
    const upper = this.bones.get('rightUpperArm');
    const lower = this.bones.get('rightLowerArm');
    if (!upper || !lower) return;

    upper.node.getWorldPosition(_v2);
    lower.node.getWorldPosition(_v3);
    const shoulder = _v4.copy(_v2);
    const elbow = _v5.copy(_v3);
    const hand = this.bones.get('rightHand');
    const wrist = hand ? hand.node.getWorldPosition(_v6) : elbow.clone().add(_v0.set(0, 0, 0.45));

    const upperLength = Math.max(shoulder.distanceTo(elbow), 0.05);
    const lowerLength = Math.max(elbow.distanceTo(wrist), 0.05);

    const forward = _v0.set(0, 0, 1);
    const right = _v1.set(-1, 0, 0);
    const up = _v2.set(0, 1, 0);
    this.pointTarget.copy(shoulder)
      .addScaledVector(forward, upperLength + lowerLength * 0.82)
      .addScaledVector(right, upperLength * 0.16)
      .addScaledVector(up, upperLength * 0.10);

    const fromShoulder = _v3.subVectors(this.pointTarget, shoulder);
    const distance = fromShoulder.length();
    const maxReach = Math.max(0.05, upperLength + lowerLength - 0.01);
    if (distance > maxReach) this.pointTarget.copy(shoulder).addScaledVector(fromShoulder.normalize(), maxReach);

    const toTarget = _v4.subVectors(this.pointTarget, shoulder).normalize();
    const planeSide = _v5.crossVectors(toTarget, up);
    if (planeSide.lengthSq() < 1e-8) planeSide.set(1, 0, 0);
    planeSide.normalize();
    const planeUp = _v6.crossVectors(planeSide, toTarget).normalize();

    const d = Math.max(0.001, shoulder.distanceTo(this.pointTarget));
    const a = upperLength;
    const b = lowerLength;
    const along = (a * a - b * b + d * d) / (2 * d);
    const height = Math.sqrt(Math.max(0, a * a - along * along));
    const desiredElbow = _v2.copy(shoulder).addScaledVector(toTarget, along).addScaledVector(planeUp, height);

    // Solve/apply the upper arm first so the lower arm's local target is
    // calculated against the new parent world orientation, not the old one.
    this.setWorldDirectionTarget(upper, desiredElbow.clone().sub(shoulder).normalize());
    upper.node.quaternion.copy(upper.target);
    upper.node.updateMatrixWorld(true);

    this.setWorldDirectionTarget(lower, this.pointTarget.clone().sub(desiredElbow).normalize());

    if (hand) {
      hand.node.updateMatrixWorld(true);
      hand.node.getWorldQuaternion(_q1);
      _q0.setFromUnitVectors(hand.restDirection, toTarget);
      _targetWorld.copy(_q0).multiply(hand.restWorld);
      worldToLocalTarget(hand.node, _targetWorld, _targetLocal);
      hand.target.copy(_targetLocal);
    }

    // Restore the visible starting pose immediately; update() performs the
    // smooth blend from the captured pose into the solved target.
    upper.node.quaternion.copy(upper.from);
    upper.node.updateMatrixWorld(true);
  }

  private setWorldDirectionTarget(bone: BoneState, desiredDirection: THREE.Vector3): void {
    _q0.setFromUnitVectors(bone.restDirection, desiredDirection);
    _targetWorld.copy(_q0).multiply(bone.restWorld);
    worldToLocalTarget(bone.node, _targetWorld, _targetLocal);
    bone.target.copy(_targetLocal);
  }

  public update(delta: number): void {
    if (!this.initialized) return;
    const dt = Math.min(Math.max(delta, 0), CARLOTTA_IDLE_MAX_DELTA);

    if (this.phase === 'active' && this.active === 'point') {
      this.time += dt;
      this.blend = Math.min(1, this.blend + dt / START_BLEND);
      const t = clamp01(this.time / POINT_DURATION);
      const approach = smoothstep(Math.min(1, t / 0.30));
      const release = t > 0.72 ? smoothstep((t - 0.72) / 0.28) : 0;
      const weight = approach * (1 - release) * this.blend;

      for (const bone of this.bones.values()) {
        _q0.copy(bone.from).slerp(bone.target, weight);
        bone.current.copy(_q0);
        bone.node.quaternion.copy(_q0);
      }

      if (this.time >= POINT_DURATION) {
        this.phase = 'recovering';
        this.recover = 0;
        for (const bone of this.bones.values()) bone.from.copy(bone.current);
        if (isDevBuild()) console.info('[CarloGesture] POINT active -> recovering');
      }
    } else if (this.phase === 'recovering') {
      this.recover = Math.min(1, this.recover + dt / RECOVER_BLEND);
      const weight = smoothstep(this.recover);
      for (const bone of this.bones.values()) {
        _q0.copy(bone.from).slerp(bone.base, weight);
        bone.current.copy(_q0);
        bone.node.quaternion.copy(_q0);
      }
      if (this.recover >= 1) {
        for (const bone of this.bones.values()) {
          bone.node.quaternion.copy(bone.base);
          bone.current.copy(bone.base);
          bone.from.copy(bone.base);
          bone.target.copy(bone.base);
        }
        const finished = this.active;
        this.active = null;
        this.phase = 'idle';
        this.completed = finished;
        carlottaAnimationController.setBodyHold(false);
        if (isDevBuild()) console.info(`[CarloGesture] complete=${finished}`);
      }
    }

    if (isDevBuild()) {
      this.diagAcc += dt;
      if (this.diagAcc >= 1) {
        this.diagAcc = 0;
        console.info('[CarloGestureDiagnostics]', { active: this.active, phase: this.phase, pointTarget: this.pointTarget.toArray() });
      }
    }
  }

  private registerDevHooks(): void {}
}

export const carlottaGestureController = new CarlottaGestureController();
