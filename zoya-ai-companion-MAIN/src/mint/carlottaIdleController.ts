import * as THREE from 'three';
import type { VRM, VRMHumanBoneName, VRMPose } from '@pixiv/three-vrm';

/**
 * CarlottaIdleController — Phase 1 natural procedural idle for the Carlotta VRM.
 *
 * - Resolves bones ONLY through the three-vrm humanoid API
 *   (`getRawBoneNode`); no hardcoded node names.
 * - Captures each controlled bone's rest quaternion at init and every frame
 *   writes `quaternion = base * offset` (absolute, never accumulated).
 * - Motion is pure layered low-frequency sines of accumulated (delta-clamped)
 *   time: breathing + posture sway + head drift + shoulder variation with
 *   mutually incommensurate frequencies so the result never visibly loops.
 * - Upper body only: spine, chest, neck, head, shoulders. Hips/legs/eyes/
 *   spring-physics bones are never touched. Sole writer of these bones
 *   (Mint animation, eye tracking, and lip-sync never run on the VRM path).
 * - Zero per-frame allocation: scratch Euler/Quaternion reused; bones
 *   resolved once at init. Runs AFTER `vrm.update()` each frame.
 */

export type IdleBoneName =
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'leftShoulder'
  | 'rightShoulder';

export const CONTROLLED_BONES: IdleBoneName[] = [
  'spine',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'rightShoulder',
];

// Hips resolved for presence verification only — never controlled in Phase 1.
const VERIFY_ONLY_BONES: VRMHumanBoneName[] = ['hips'];

const BREATH_SPEED = Math.PI * 2 * 0.22; // ~4.5s breathing cycle
const MAX_DELTA = 0.05; // clamp hitches so time stays smooth

/** Shared timebase constants (also used by the animation state controller). */
export const CARLOTTA_BREATH_SPEED = BREATH_SPEED;
export const CARLOTTA_IDLE_MAX_DELTA = MAX_DELTA;

/**
 * One-time conservative relaxed standing pose (NOT idle — established once
 * before the idle controller captures its base).
 *
 * Convention, verified against three-vrm 3.5.5 source: `setNormalizedPose`
 * writes rest-relative local quaternions to the normalized rig, and the
 * per-frame transfer (`raw = norm · P · P⁻¹ · B`) reduces to a direct copy
 * for this asset because every rest local/world rotation is identity. Local
 * bone frames are therefore world-aligned at rest (arms along ±X, character
 * facing +Z), so: left arm down = +Z-rotation, right arm down = −Z-rotation
 * (mirrored); elbow bend forward (+Z) = +Y-rotation left, −Y right.
 * Only arms/shoulders/elbows are posed; everything else keeps rest pose.
 */
const DEG = Math.PI / 180;
const _poseEuler = new THREE.Euler();
const _poseQuat = new THREE.Quaternion();

function eulerToTuple(x: number, y: number, z: number): [number, number, number, number] {
  _poseEuler.set(x, y, z);
  _poseQuat.setFromEuler(_poseEuler);
  return [_poseQuat.x, _poseQuat.y, _poseQuat.z, _poseQuat.w];
}

export function applyCarlottaRelaxedPose(vrm: VRM): void {
  const ARM_DOWN = 68 * DEG;
  const SHOULDER_DOWN = 8 * DEG;
  const ELBOW_BEND = 12 * DEG;
  const pose: VRMPose = {
    leftShoulder: { rotation: eulerToTuple(0, 0, SHOULDER_DOWN) },
    rightShoulder: { rotation: eulerToTuple(0, 0, -SHOULDER_DOWN) },
    leftUpperArm: { rotation: eulerToTuple(0, 0, ARM_DOWN) },
    rightUpperArm: { rotation: eulerToTuple(0, 0, -ARM_DOWN) },
    leftLowerArm: { rotation: eulerToTuple(0, ELBOW_BEND, 0) },
    rightLowerArm: { rotation: eulerToTuple(0, -ELBOW_BEND, 0) },
  };
  vrm.humanoid.setNormalizedPose(pose);
  console.log('[CarloPose] relaxed pose applied (shoulders/upper arms/elbows)');
}

interface ControlledBone {
  name: IdleBoneName;
  node: THREE.Object3D;
  base: THREE.Quaternion;
}

const _offsetEuler = new THREE.Euler();
const _offsetQuat = new THREE.Quaternion();

/**
 * Single source of truth for the idle procedural offsets.
 * Writes the idle Euler offset for one controlled bone at time `t`
 * (breath phase derived internally). Pure: no bone writes, no allocation
 * beyond the caller's `out` Euler. Shared with CarlottaAnimationController
 * so idle behavior stays identical everywhere it is used.
 */
export function computeCarlottaIdleOffset(
  name: IdleBoneName,
  t: number,
  out: THREE.Euler,
): void {
  const breath = t * BREATH_SPEED;
  switch (name) {
    case 'spine':
      // Extremely subtle posture sway (two slow, unrelated axes).
      out.set(
        Math.sin(t * 0.31 + 0.5) * 0.01,
        0,
        Math.sin(t * 0.43 + 2.1) * 0.008,
      );
      break;
    case 'chest':
      // Primary breathing + faint secondary swell.
      out.set(
        Math.sin(breath) * 0.02 + Math.sin(t * 0.61 + 1.7) * 0.006,
        0,
        Math.sin(t * 0.37 + 0.9) * 0.005,
      );
      break;
    case 'neck':
      // Small lagged counter-movement so the head feels decoupled.
      out.set(
        Math.sin(breath + 0.9) * 0.008,
        Math.sin(t * 0.23) * 0.006,
        0,
      );
      break;
    case 'head':
      // Very subtle independent drift on incommensurate frequencies.
      out.set(
        Math.sin(t * 0.27 + 0.4) * 0.012,
        Math.sin(t * 0.69 + 1.2) * 0.02,
        Math.sin(t * 0.132 + 2.6) * 0.008,
      );
      break;
    case 'leftShoulder':
      // Loosely breath-synced, own phase/amplitude.
      out.set(
        Math.sin(breath - 0.5) * 0.014,
        0,
        Math.sin(t * 0.5) * 0.005,
      );
      break;
    case 'rightShoulder':
      out.set(
        Math.sin(breath - 0.9) * 0.012,
        0,
        Math.sin(t * 0.47 + 1.1) * 0.005,
      );
      break;
  }
}

export class CarlottaIdleController {
  private bones: ControlledBone[] = [];
  private time = 0;
  private initialized = false;
  private idleLogged = false;

  /**
   * Resolve bones via the humanoid API, capture base pose, log resolution.
   * Missing bones are reported and skipped (never guessed).
   */
  public init(vrm: VRM): void {
    this.bones = [];
    this.time = 0;
    this.idleLogged = false;

    for (const verify of VERIFY_ONLY_BONES) {
      const node = vrm.humanoid.getRawBoneNode(verify);
      console.log(`[CarloAnim] verify bone "${verify}": ${node ? `OK (${node.name})` : 'MISSING — left untouched'}`);
    }

    for (const name of CONTROLLED_BONES) {
      const node = vrm.humanoid.getRawBoneNode(name);
      if (!node) {
        console.warn(`[CarloAnim] required bone "${name}" missing — skipping (no guess made)`);
        continue;
      }
      this.bones.push({ name, node, base: node.quaternion.clone() });
      console.log(`[CarloAnim] control bone "${name}": OK (${node.name})`);
    }

    this.initialized = this.bones.length > 0;
    console.log(
      `[CarloAnim] controller initialized (${this.bones.length}/${CONTROLLED_BONES.length} bones): ` +
        (this.initialized ? this.bones.map((b) => b.name).join(', ') : 'IDLE DISABLED'),
    );
  }

  /** Restore captured base pose (used when the VRM is unloaded). */
  public reset(): void {
    for (const bone of this.bones) {
      bone.node.quaternion.copy(bone.base);
    }
    this.bones = [];
    this.initialized = false;
    this.idleLogged = false;
  }

  public getIsInitialized(): boolean {
    return this.initialized;
  }

  /** Advance idle. Call once per frame AFTER `vrm.update(delta)`. */
  public update(delta: number): void {
    if (!this.initialized) return;
    if (!this.idleLogged) {
      this.idleLogged = true;
      console.log('[CarloAnim] idle active');
    }

    this.time += Math.min(delta, MAX_DELTA);
    const t = this.time;

    for (const bone of this.bones) {
      computeCarlottaIdleOffset(bone.name, t, _offsetEuler);
      _offsetQuat.setFromEuler(_offsetEuler);
      bone.node.quaternion.copy(bone.base).multiply(_offsetQuat);
    }
  }
}

export const carlottaIdleController = new CarlottaIdleController();
