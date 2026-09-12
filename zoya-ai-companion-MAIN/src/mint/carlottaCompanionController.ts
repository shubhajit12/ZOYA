import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

/**
 * Companion-only lower-body controller.
 * It owns only hips/legs/feet while the normal Carlotta idle/gesture layers
 * continue to own their existing upper-body bones. Targets are derived from
 * the character's calibrated world axes rather than blind Euler sign flips.
 */
export type CompanionPhase = 'idle' | 'jumping' | 'sitting' | 'standing';

type Bone = {
  node: THREE.Object3D;
  restLocal: THREE.Quaternion;
  restWorld: THREE.Quaternion;
};

const JUMP_DURATION = 0.72;
const STAND_DURATION = 0.65;
const SIT_BLEND = 0.5;
const EPS = 1e-8;

const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function smooth(v: number) { const t = clamp01(v); return t * t * (3 - 2 * t); }

export class CarlottaCompanionController {
  private bones = new Map<string, Bone>();
  private root: THREE.Object3D | null = null;
  private forward = new THREE.Vector3(0, 0, -1);
  private right = new THREE.Vector3(1, 0, 0);
  private up = new THREE.Vector3(0, 1, 0);
  private phase: CompanionPhase = 'idle';
  private elapsed = 0;
  private rootBaseY = 0;
  private rootBaseX = 0;
  private rootBaseZ = 0;
  private rootBaseQuat = new THREE.Quaternion();

  public init(vrm: VRM): void {
    this.reset();
    this.root = vrm.scene;
    vrm.scene.updateMatrixWorld(true);
    vrm.scene.getWorldQuaternion(_q0);
    this.forward.set(0, 0, -1).applyQuaternion(_q0).normalize();
    this.right.set(1, 0, 0).applyQuaternion(_q0).normalize();
    this.up.set(0, 1, 0).applyQuaternion(_q0).normalize();

    const names = [
      'hips',
      'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
      'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
    ];
    for (const name of names) {
      const node = vrm.humanoid.getRawBoneNode(name as any);
      if (!node) continue;
      node.updateMatrixWorld(true);
      this.bones.set(name, {
        node,
        restLocal: node.quaternion.clone(),
        restWorld: node.getWorldQuaternion(new THREE.Quaternion()),
      });
    }

    this.rootBaseX = vrm.scene.position.x;
    this.rootBaseY = vrm.scene.position.y;
    this.rootBaseZ = vrm.scene.position.z;
    this.rootBaseQuat.copy(vrm.scene.quaternion);
  }

  public enter(): boolean {
    if (!this.root || this.bones.size === 0) return false;
    this.phase = 'jumping';
    this.elapsed = 0;
    this.restoreStandingPose();
    return true;
  }

  public exit(): boolean {
    if (!this.root) return false;
    this.phase = 'standing';
    this.elapsed = 0;
    return true;
  }

  public getPhase(): CompanionPhase { return this.phase; }

  public update(delta: number): void {
    if (!this.root || this.bones.size === 0 || this.phase === 'idle') return;
    const dt = Math.min(Math.max(delta, 0), 0.05);
    this.elapsed += dt;

    if (this.phase === 'jumping') {
      const p = clamp01(this.elapsed / JUMP_DURATION);
      const arc = Math.sin(p * Math.PI);
      this.root.position.x = this.rootBaseX;
      this.root.position.z = this.rootBaseZ;
      this.root.position.y = this.rootBaseY + arc * 0.28;
      if (p >= 1) {
        this.phase = 'sitting';
        this.elapsed = 0;
        this.applySitPose(1);
      }
      return;
    }

    if (this.phase === 'sitting') {
      this.root.position.x = this.rootBaseX;
      this.root.position.y = this.rootBaseY - 0.13;
      this.root.position.z = this.rootBaseZ;
      this.applySitPose(1);
      return;
    }

    if (this.phase === 'standing') {
      const p = smooth(this.elapsed / STAND_DURATION);
      this.root.position.y = this.rootBaseY - 0.13 * (1 - p);
      this.applySitPose(1 - p);
      if (p >= 1) {
        this.restoreStandingPose();
        this.phase = 'idle';
        this.elapsed = 0;
      }
    }
  }

  private restoreStandingPose(): void {
    if (!this.root) return;
    this.root.position.set(this.rootBaseX, this.rootBaseY, this.rootBaseZ);
    this.root.quaternion.copy(this.rootBaseQuat);
    for (const bone of this.bones.values()) bone.node.quaternion.copy(bone.restLocal);
  }

  private applyWorldRotation(name: string, axis: THREE.Vector3, angle: number): void {
    const bone = this.bones.get(name);
    if (!bone) return;
    _q0.setFromAxisAngle(axis, angle);
    _q1.copy(_q0).multiply(bone.restWorld).normalize();
    if (!bone.node.parent) bone.node.quaternion.copy(_q1);
    else {
      bone.node.parent.getWorldQuaternion(_q0);
      _q0.invert();
      bone.node.quaternion.copy(_q0).multiply(_q1).normalize();
    }
  }

  private applySitPose(weight: number): void {
    const w = clamp01(weight);
    // Character-space axes: thighs fold forward, knees fold back under the body.
    this.applyWorldRotation('leftUpperLeg', this.right, -1.10 * w);
    this.applyWorldRotation('rightUpperLeg', this.right, -1.10 * w);
    this.applyWorldRotation('leftLowerLeg', this.right, 1.85 * w);
    this.applyWorldRotation('rightLowerLeg', this.right, 1.85 * w);
    this.applyWorldRotation('leftFoot', this.right, -0.75 * w);
    this.applyWorldRotation('rightFoot', this.right, -0.75 * w);
    this.applyWorldRotation('hips', this.right, 0.08 * w);
  }

  public reset(): void {
    if (this.root) {
      this.root.position.set(this.rootBaseX, this.rootBaseY, this.rootBaseZ);
      this.root.quaternion.copy(this.rootBaseQuat);
    }
    for (const bone of this.bones.values()) bone.node.quaternion.copy(bone.restLocal);
    this.bones.clear();
    this.root = null;
    this.phase = 'idle';
    this.elapsed = 0;
    this.rootBaseX = 0;
    this.rootBaseY = 0;
    this.rootBaseZ = 0;
    this.rootBaseQuat.identity();
    this._clearScratch();
  }

  private _clearScratch(): void {
    _v0.set(0, 0, 0);
    _v1.set(0, 0, 0);
    this.forward.set(0, 0, -1);
    this.right.set(1, 0, 0);
    this.up.set(0, 1, 0);
  }
}

export const carlottaCompanionController = new CarlottaCompanionController();
