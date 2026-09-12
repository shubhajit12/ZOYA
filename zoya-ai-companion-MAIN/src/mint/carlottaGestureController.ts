import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { CARLOTTA_IDLE_MAX_DELTA } from './carlottaIdleController';
import { isDevBuild } from './runtimeEnv';

/** Clean procedural Carlotta gesture controller. Gestures use character-space spatial targets. */
export type CarlottaGestureName = 'wave' | 'greeting' | 'goodbye' | 'point' | 'shrug' | 'clap' | 'bow';
export function isValidCarlottaGestureName(value: unknown): value is CarlottaGestureName {
  return value === 'wave' || value === 'greeting' || value === 'goodbye' || value === 'point' || value === 'shrug' || value === 'clap' || value === 'bow';
}
export type GesturePhase = 'idle' | 'active' | 'recovering';
type BoneName = 'rightUpperArm' | 'rightLowerArm' | 'rightHand' | 'spine' | 'chest' | 'neck' | 'head';
type BoneState = { name: BoneName; node: THREE.Object3D; restLocal: THREE.Quaternion; restWorld: THREE.Quaternion; restDirection: THREE.Vector3; from: THREE.Quaternion; target: THREE.Quaternion };

const POINT_DURATION = 1.65;
const BOW_DURATION = 1.85;
const WAVE_DURATION = 2.45;
const START_BLEND_SECONDS = 0.22;
const RECOVER_BLEND_SECONDS = 0.28;
const EPSILON = 1e-8;

const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function smoothstep(value: number): number { const t = clamp01(value); return t * t * (3 - 2 * t); }
function worldToLocal(node: THREE.Object3D, world: THREE.Quaternion, out: THREE.Quaternion): void {
  if (!node.parent) { out.copy(world); return; }
  node.parent.getWorldQuaternion(_q0); _q0.invert(); out.copy(_q0).multiply(world).normalize();
}
function captureRestDirection(node: THREE.Object3D, child: THREE.Object3D | null, restWorld: THREE.Quaternion): THREE.Vector3 {
  node.getWorldPosition(_v0);
  if (child) { child.getWorldPosition(_v1); _v1.sub(_v0); if (_v1.lengthSq() > EPSILON) return _v1.normalize().clone(); }
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
    const spine = vrm.humanoid.getRawBoneNode('spine');
    const chest = vrm.humanoid.getRawBoneNode('chest');
    const neck = vrm.humanoid.getRawBoneNode('neck');
    const head = vrm.humanoid.getRawBoneNode('head');
    if (upper) this.captureBone('rightUpperArm', upper, lower); else console.warn('[CarloGesture] missing bone: rightUpperArm');
    if (lower) this.captureBone('rightLowerArm', lower, hand); else console.warn('[CarloGesture] missing bone: rightLowerArm');
    if (hand) this.captureBone('rightHand', hand, null); else console.warn('[CarloGesture] missing bone: rightHand');
    if (spine) this.captureBone('spine', spine, chest); else console.warn('[CarloGesture] missing bone: spine');
    if (chest) this.captureBone('chest', chest, neck); else console.warn('[CarloGesture] missing bone: chest');
    if (neck) this.captureBone('neck', neck, head); else console.warn('[CarloGesture] missing bone: neck');
    if (head) this.captureBone('head', head, null); else console.warn('[CarloGesture] missing bone: head');
    vrm.scene.updateMatrixWorld(true); vrm.scene.getWorldQuaternion(_q1);
    this.forward.set(0, 0, -1).applyQuaternion(_q1).normalize();
    this.right.set(1, 0, 0).applyQuaternion(_q1).normalize();
    this.up.set(0, 1, 0).applyQuaternion(_q1).normalize();
    this.initialized = !!upper && !!lower; this.active = null; this.phase = 'idle'; this.completed = null; this.recovery = 1;
    this.registerDevHooks();
    if (isDevBuild()) console.info('[CarloGestureCalibration] clean spatial gesture solver ready', {
      forward: this.forward.toArray(), right: this.right.toArray(), up: this.up.toArray(), bones: Array.from(this.bones.keys()), enabled: ['point', 'bow', 'wave'],
    });
  }

  private captureBone(name: BoneName, node: THREE.Object3D, child: THREE.Object3D | null): void {
    node.updateMatrixWorld(true);
    const restLocal = node.quaternion.clone();
    const restWorld = node.getWorldQuaternion(new THREE.Quaternion());
    this.bones.set(name, { name, node, restLocal, restWorld, restDirection: captureRestDirection(node, child, restWorld), from: restLocal.clone(), target: restLocal.clone() });
  }
  public getIsInitialized(): boolean { return this.initialized; }
  public getActive(): CarlottaGestureName | null { return this.active; }
  public getPhase(): GesturePhase { return this.phase; }
  public getCompleted(): CarlottaGestureName | null { return this.completed; }

  public start(name: CarlottaGestureName): boolean {
    if (!this.initialized || (name !== 'point' && name !== 'bow' && name !== 'wave') || this.active) return false;
    for (const bone of this.bones.values()) { bone.from.copy(bone.node.quaternion); bone.target.copy(bone.node.quaternion); }
    this.active = name; this.phase = 'active'; this.elapsed = 0; this.recovery = 1; this.completed = null;
    if (name === 'point') this.solvePointTarget();
    else if (name === 'bow') this.solveBowTarget();
    else this.solveWaveTarget(0);
    if (isDevBuild()) console.info(`[CarloGesture] ${name.toUpperCase()} started from current pose`);
    return true;
  }
  public cancel(): void { if (!this.active || this.phase !== 'active') return; this.phase = 'recovering'; this.recovery = 0; }
  public reset(): void {
    for (const bone of this.bones.values()) bone.node.quaternion.copy(bone.restLocal);
    this.bones.clear(); this.initialized = false; this.active = null; this.phase = 'idle'; this.elapsed = 0; this.recovery = 1; this.completed = null; this.diagnosticsElapsed = 0;
    this.target.set(0, 0, 0); this.shoulder.set(0, 0, 0); this.elbowTarget.set(0, 0, 0); this.pointDirection.set(0, 0, 0);
  }

  private solvePointTarget(): void {
    const upper = this.bones.get('rightUpperArm'), lower = this.bones.get('rightLowerArm'), hand = this.bones.get('rightHand');
    if (!upper || !lower) return;
    upper.node.getWorldPosition(this.shoulder); lower.node.getWorldPosition(_v0); const wrist = hand ? hand.node.getWorldPosition(_v1) : _v0;
    const upperLength = Math.max(this.shoulder.distanceTo(_v0), 0.05), lowerLength = Math.max(_v0.distanceTo(wrist), 0.05);
    this.target.copy(this.shoulder).addScaledVector(this.forward, upperLength + lowerLength * 0.90).addScaledVector(this.right, upperLength * 0.18).addScaledVector(this.up, upperLength * 0.10);
    const fromShoulder = _v2.subVectors(this.target, this.shoulder); const distance = fromShoulder.length(); const maxReach = Math.max(0.05, upperLength + lowerLength - 0.01);
    if (distance > maxReach) this.target.copy(this.shoulder).addScaledVector(fromShoulder.normalize(), maxReach);
    this.pointDirection.subVectors(this.target, this.shoulder).normalize();
    const planeUp = _v3.copy(this.up).addScaledVector(this.pointDirection, -this.up.dot(this.pointDirection)); if (planeUp.lengthSq() < EPSILON) planeUp.copy(this.right); planeUp.normalize();
    const distanceSafe = Math.max(distance, 0.001), a = upperLength, b = lowerLength;
    const along = Math.max(-a, Math.min(a, (a * a - b * b + distanceSafe * distanceSafe) / (2 * distanceSafe))); const height = Math.sqrt(Math.max(0, a * a - along * along));
    this.elbowTarget.copy(this.shoulder).addScaledVector(this.pointDirection, along).addScaledVector(planeUp, height);
    this.solveBoneToward(upper, this.elbowTarget, this.shoulder); upper.node.quaternion.copy(upper.target); upper.node.updateMatrixWorld(true); this.solveBoneToward(lower, this.target, this.elbowTarget);
    // Do not apply an independent wrist rotation. The previous hand-direction alignment used a fallback hand axis that does not describe Carlotta's palm/finger orientation, causing the wrist to fold backward.
    upper.node.quaternion.copy(upper.from); upper.node.updateMatrixWorld(true);
  }

  private solveBowTarget(): void {
    const spine = this.bones.get('spine'), chest = this.bones.get('chest'), neck = this.bones.get('neck'), head = this.bones.get('head');
    if (!spine && !chest) return;
    const desired = _v0.copy(this.forward); const upProjected = _v1.copy(this.up).addScaledVector(desired, -this.up.dot(desired)).normalize(); const bendAxis = _v2.copy(this.right).normalize();
    const signedSin = _v3.copy(upProjected).cross(desired).dot(bendAxis), signedCos = upProjected.dot(desired); const fullBend = Math.atan2(signedSin, signedCos) * 0.48;
    for (const entry of [{ bone: spine, fraction: 0.30 }, { bone: chest, fraction: 0.52 }, { bone: neck, fraction: 0.18 }]) if (entry.bone) this.applyWorldAxisBend(entry.bone, fullBend * entry.fraction);
    if (head) this.applyWorldAxisBend(head, -fullBend * 0.10);
  }

  private solveWaveTarget(time: number): void {
    const upper = this.bones.get('rightUpperArm'), lower = this.bones.get('rightLowerArm'), hand = this.bones.get('rightHand');
    if (!upper || !lower) return;
    upper.node.getWorldPosition(this.shoulder); lower.node.getWorldPosition(_v0); const wrist = hand ? hand.node.getWorldPosition(_v1) : _v0;
    const upperLength = Math.max(this.shoulder.distanceTo(_v0), 0.05), lowerLength = Math.max(_v0.distanceTo(wrist), 0.05);
    const preparation = smoothstep(time / 0.38);
    const waveTime = Math.max(0, time - 0.38);
    const waveEnvelope = smoothstep(waveTime / 0.18) * (1 - smoothstep((time - (WAVE_DURATION - 0.40)) / 0.40));

    // Hold the raised arm in a fixed spatial pose. The previous Wave moved the IK target
    // left/right every frame, so the upper arm and forearm were forced to rotate with it.
    this.target.copy(this.shoulder)
      .addScaledVector(this.right, upperLength * (1.00 + 0.04 * preparation))
      .addScaledVector(this.up, upperLength * (1.12 + 0.04 * preparation))
      .addScaledVector(this.forward, lowerLength * 0.18);

    const fromShoulder = _v2.subVectors(this.target, this.shoulder); const rawDistance = fromShoulder.length(); const maxReach = Math.max(0.05, upperLength + lowerLength - 0.01); const distance = Math.min(rawDistance, maxReach);
    if (rawDistance > distance) this.target.copy(this.shoulder).addScaledVector(fromShoulder.normalize(), distance);
    const direction = this.pointDirection.subVectors(this.target, this.shoulder).normalize();
    const planeUp = _v3.copy(this.up).addScaledVector(direction, -this.up.dot(direction)); if (planeUp.lengthSq() < EPSILON) planeUp.copy(this.forward); planeUp.normalize();
    const a = upperLength, b = lowerLength, safeDistance = Math.max(distance, 0.001);
    const along = Math.max(-a, Math.min(a, (a * a - b * b + safeDistance * safeDistance) / (2 * safeDistance))); const height = Math.sqrt(Math.max(0, a * a - along * along));
    this.elbowTarget.copy(this.shoulder).addScaledVector(direction, along).addScaledVector(planeUp, height);
    this.solveBoneToward(upper, this.elbowTarget, this.shoulder); upper.node.quaternion.copy(upper.target); upper.node.updateMatrixWorld(true); this.solveBoneToward(lower, this.target, this.elbowTarget);

    if (hand) {
      // Carlotta's rightHand has no child bone, so do not invent a world-space palm axis.
      // Apply the wave around the hand bone's calibrated local X axis instead. This keeps
      // the arm/forearm stationary while only the wrist/hand supplies the wave beat.
      const handWave = Math.sin(waveTime * Math.PI * 3.0) * THREE.MathUtils.degToRad(16) * waveEnvelope;
      _q0.setFromAxisAngle(_v4.set(1, 0, 0), handWave);
      hand.target.copy(hand.restLocal).premultiply(_q0).normalize();
    }
    upper.node.quaternion.copy(upper.from); upper.node.updateMatrixWorld(true);
  }

  private applyWorldAxisBend(bone: BoneState, angle: number): void { _q0.setFromAxisAngle(this.right, angle); _q1.copy(_q0).multiply(bone.restWorld).normalize(); worldToLocal(bone.node, _q1, bone.target); }
  private solveBoneToward(bone: BoneState, end: THREE.Vector3, start: THREE.Vector3): void {
    _v4.subVectors(end, start); if (_v4.lengthSq() < EPSILON) { bone.target.copy(bone.from); return; }
    _v4.normalize(); _q0.setFromUnitVectors(bone.restDirection, _v4); _q1.copy(_q0).multiply(bone.restWorld).normalize(); worldToLocal(bone.node, _q1, bone.target);
  }

  public update(delta: number): void {
    if (!this.initialized || !this.active) return;
    const dt = Math.min(Math.max(delta, 0), CARLOTTA_IDLE_MAX_DELTA);
    if (this.phase === 'active') {
      this.elapsed += dt;
      if (this.active === 'wave') this.solveWaveTarget(this.elapsed);
      const duration = this.active === 'bow' ? BOW_DURATION : this.active === 'wave' ? WAVE_DURATION : POINT_DURATION;
      const activation = smoothstep(this.elapsed / START_BLEND_SECONDS); const progress = clamp01(this.elapsed / duration); const release = smoothstep((progress - 0.72) / 0.28); const weight = activation * (1 - release);
      for (const bone of this.bones.values()) { _q3.copy(bone.from).slerp(bone.target, weight); bone.node.quaternion.copy(_q3); }
      if (this.elapsed >= duration) { this.phase = 'recovering'; this.recovery = 0; for (const bone of this.bones.values()) bone.from.copy(bone.node.quaternion); if (isDevBuild()) console.info(`[CarloGesture] ${this.active.toUpperCase()} -> recovering`); }
    } else if (this.phase === 'recovering') {
      this.recovery = Math.min(1, this.recovery + dt / RECOVER_BLEND_SECONDS); const weight = smoothstep(this.recovery);
      for (const bone of this.bones.values()) { _q3.copy(bone.from).slerp(bone.restLocal, weight); bone.node.quaternion.copy(_q3); }
      if (this.recovery >= 1) { const finished = this.active; for (const bone of this.bones.values()) { bone.node.quaternion.copy(bone.restLocal); bone.from.copy(bone.restLocal); bone.target.copy(bone.restLocal); } this.active = null; this.phase = 'idle'; this.completed = finished; if (isDevBuild()) console.info(`[CarloGesture] complete=${finished}`); }
    }
    if (isDevBuild()) { this.diagnosticsElapsed += dt; if (this.diagnosticsElapsed >= 1) { this.diagnosticsElapsed = 0; console.info('[CarloGestureDiagnostics]', { active: this.active, phase: this.phase, target: this.target.toArray(), pointDirection: this.pointDirection.toArray() }); } }
  }

  /** Restore the DEV hooks expected by the existing MintCanvas test controls. */
  private registerDevHooks(): void {
    if (!isDevBuild()) return;
    try {
      const w = window as unknown as Record<string, unknown>;
      w.__carlottaGestureStart = (name: unknown): boolean => isValidCarlottaGestureName(name) && this.start(name);
      w.__carlottaGestureInfo = (): { active: CarlottaGestureName | null; phase: GesturePhase; completed: CarlottaGestureName | null } => ({ active: this.active, phase: this.phase, completed: this.completed });
      w.__carlottaGestureCancel = (): void => this.cancel();
    } catch { /* non-browser runtime */ }
  }
}
export const carlottaGestureController = new CarlottaGestureController();