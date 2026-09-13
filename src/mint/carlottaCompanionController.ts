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

type LegSwingState = {
  angle: number;
  vel: number;
  foot: number;
  omega: number;
};

const JUMP_DURATION = 0.72;
const STAND_DURATION = 0.65;
const SIT_DROP = 0.22;

const SHIN_OMEGA_L = 5.8;
const SHIN_OMEGA_R = 5.3;
const SHIN_ZETA = 0.08;
const STAND_ZETA = 0.6;
const MAX_SHIN = 0.30;
const LAND_IMPULSE = 1.8;
const KICK_IMPULSE = 0.9;
const KICK_CROSS = 0.4;
const KICK_MIN = 3;
const KICK_MAX = 8;
const FOOT_VEL_GAIN = 0.12;
const FOOT_TAU = 0.10;
const MAX_FOOT = 0.25;
const THIGH_FOLLOW = 0.12;
const HIP_ROLL = 0.03;

const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function smooth(v: number) { const t = clamp01(v); return t * t * (3 - 2 * t); }
function randomRange(min: number, max: number) { return min + Math.random() * (max - min); }

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
  private legL: LegSwingState = { angle: 0, vel: 0, foot: 0, omega: SHIN_OMEGA_L };
  private legR: LegSwingState = { angle: 0, vel: 0, foot: 0, omega: SHIN_OMEGA_R };
  private nextKickAt = Infinity;

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
        this.legL.angle = 0;
        this.legR.angle = 0;
        this.legL.foot = 0;
        this.legR.foot = 0;
        this.legL.vel = LAND_IMPULSE;
        this.legR.vel = -LAND_IMPULSE * 0.7;
        this.nextKickAt = randomRange(KICK_MIN, KICK_MAX);
        this.applySitPose(1);
      }
      return;
    }

    if (this.phase === 'sitting') {
      this.root.position.x = this.rootBaseX;
      this.root.position.y = this.rootBaseY - SIT_DROP;
      this.root.position.z = this.rootBaseZ;
      this.stepLegs(dt, SHIN_ZETA, true);
      this.applySitPose(1);
      return;
    }

    if (this.phase === 'standing') {
      const p = smooth(this.elapsed / STAND_DURATION);
      this.root.position.y = this.rootBaseY - SIT_DROP * (1 - p);
      this.stepLegs(dt, STAND_ZETA, false);
      this.applySitPose(1 - p);
      if (p >= 1) {
        this.restoreStandingPose();
        this.phase = 'idle';
        this.elapsed = 0;
      }
    }
  }

  private stepLegs(dt: number, zeta: number, allowKick: boolean): void {
    if (dt <= 0) return;

    const step = (leg: LegSwingState) => {
      const acc = -leg.omega * leg.omega * leg.angle - 2 * zeta * leg.omega * leg.vel;
      leg.vel += acc * dt;
      leg.angle += leg.vel * dt;
      leg.angle = THREE.MathUtils.clamp(leg.angle, -MAX_SHIN, MAX_SHIN);

      const footTarget = THREE.MathUtils.clamp(-leg.vel * FOOT_VEL_GAIN, -MAX_FOOT, MAX_FOOT);
      leg.foot += (footTarget - leg.foot) * (1 - Math.exp(-dt / FOOT_TAU));
      leg.foot = THREE.MathUtils.clamp(leg.foot, -MAX_FOOT, MAX_FOOT);
    };

    step(this.legL);
    step(this.legR);

    if (!allowKick || this.elapsed < this.nextKickAt) return;

    const impulse = KICK_IMPULSE * randomRange(0.6, 1.4);
    const sign = Math.random() < 0.5 ? -1 : 1;
    if (Math.random() < 0.5) {
      this.legL.vel += sign * impulse;
      this.legR.vel -= sign * impulse * KICK_CROSS;
    } else {
      this.legR.vel += sign * impulse;
      this.legL.vel -= sign * impulse * KICK_CROSS;
    }
    this.nextKickAt = this.elapsed + randomRange(KICK_MIN, KICK_MAX);
  }

  private restoreStandingPose(): void {
    if (!this.root) return;
    this.root.position.set(this.rootBaseX, this.rootBaseY, this.rootBaseZ);
    this.root.quaternion.copy(this.rootBaseQuat);
    for (const bone of this.bones.values()) bone.node.quaternion.copy(bone.restLocal);
    this.legL.angle = 0;
    this.legL.vel = 0;
    this.legL.foot = 0;
    this.legR.angle = 0;
    this.legR.vel = 0;
    this.legR.foot = 0;
    this.nextKickAt = Infinity;
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
    const leftThigh = -1.10 + this.legL.angle * THIGH_FOLLOW;
    const rightThigh = -1.10 + this.legR.angle * THIGH_FOLLOW;
    const hip = 0.08 + (this.legL.angle - this.legR.angle) * HIP_ROLL;

    // Stable seated base with independently drifting, damped dangling legs.
    // Feet follow shin velocity rather than being rigidly coupled to the shin.
    this.applyWorldRotation('leftUpperLeg', this.right, leftThigh * w);
    this.applyWorldRotation('rightUpperLeg', this.right, rightThigh * w);
    this.applyWorldRotation('leftLowerLeg', this.right, (1.85 + this.legL.angle) * w);
    this.applyWorldRotation('rightLowerLeg', this.right, (1.85 + this.legR.angle) * w);
    this.applyWorldRotation('leftFoot', this.right, (-0.75 + this.legL.foot) * w);
    this.applyWorldRotation('rightFoot', this.right, (-0.75 + this.legR.foot) * w);
    this.applyWorldRotation('hips', this.right, hip * w);
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
    this.legL = { angle: 0, vel: 0, foot: 0, omega: SHIN_OMEGA_L };
    this.legR = { angle: 0, vel: 0, foot: 0, omega: SHIN_OMEGA_R };
    this.nextKickAt = Infinity;
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
