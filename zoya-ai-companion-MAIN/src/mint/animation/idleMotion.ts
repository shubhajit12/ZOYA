import * as THREE from 'three';
import { MintBoneMap } from './skeletonMap';

/**
 * MintIdleMotion
 *
 * Procedural idle animation using deterministic sine/cosine functions.
 * Each bone gets a unique frequency and phase offset to prevent
 * robotic uniform movement.
 *
 * CRITICAL: All motions are DELTAS added on top of the base pose.
 * Never accumulate from previous frame.
 */

/** Pre-computed idle motion parameters per bone */
interface IdleChannel {
  bone: THREE.Object3D;
  /** Rotation axis and amplitude in radians */
  rx: number; // amplitude around X
  ry: number; // amplitude around Y
  rz: number; // amplitude around Z
  /** Phase offsets for each axis */
  phaseX: number;
  phaseY: number;
  phaseZ: number;
  /** Base frequency multiplier */
  freq: number;
  /** Amplitude multiplier for emotional scaling */
  intensity: number;
}

/** Scratch quaternion for reuse */
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

/** Idle motion data - built once, read every frame */
export interface MintIdleData {
  channels: IdleChannel[];
  breathBaseFreq: number;
  breathFreqExcited: number;
  breathFreqSad: number;
}

/**
 * Create the idle motion data structure.
 * Maps each anatomical bone to its idle motion parameters.
 *
 * Amplitudes are intentionally VERY small:
 * - The goal is to make Mint feel alive, not performing.
 * - Each value is carefully chosen to be subtle.
 */
export function createIdleMotion(boneMap: MintBoneMap): MintIdleData {
  console.log('[MintIdle] Creating idle motion channels');

  const channels: IdleChannel[] = [];

  // Helper to add a channel
  const addChannel = (
    bone: THREE.Object3D | null,
    rx: number, ry: number, rz: number,
    px: number, py: number, pz: number,
    freq: number, intensity: number,
  ) => {
    if (!bone) return;
    channels.push({
      bone,
      rx: rx * Math.PI / 180,
      ry: ry * Math.PI / 180,
      rz: rz * Math.PI / 180,
      phaseX: px,
      phaseY: py,
      phaseZ: pz,
      freq,
      intensity,
    });
  };

  // ─── BREATHING (chest/shoulders) ─────────────────────────
  // Chest rises and falls subtly. Shoulders follow with smaller amplitude.
  addChannel(boneMap.spine,   0.6, 0, 0, 0,    0, 0,    1.0, 1.0);
  addChannel(boneMap.spine1,  0.8, 0, 0, 0.3,  0, 0,    1.0, 1.0);
  addChannel(boneMap.spine2,  0.5, 0, 0, 0.6,  0, 0,    1.0, 1.0);

  // Shoulders follow breathing with tiny lift
  addChannel(boneMap.leftClavicle,  0.3, 0, 0.2, 0.5, 1.2, 0.3, 1.0, 0.6);
  addChannel(boneMap.rightClavicle, 0.3, 0, 0.2, 0.5, 1.5, 0.7, 1.0, 0.6);

  // ─── WEIGHT SHIFT (pelvis) ───────────────────────────────
  // Extremely subtle side-to-side sway
  addChannel(boneMap.pelvis, 0, 0.15, 0.1, 0, 0.8, 2.1, 0.15, 0.5);

  // ─── HEAD MICRO-MOVEMENT ─────────────────────────────────
  // Very slow, very small head movement for naturalness
  addChannel(boneMap.head, 0.25, 0.3, 0.15, 1.7, 0.5, 3.2, 0.3, 0.7);
  addChannel(boneMap.neck, 0.15, 0.2, 0.1, 1.5, 0.7, 2.8, 0.3, 0.5);

  // ─── SHOULDER MICRO-MOVEMENT ─────────────────────────────
  // Tiny rotation independent of breathing
  addChannel(boneMap.leftUpperArm,  0.15, 0.1, 0.1, 2.3, 1.1, 0.4, 0.25, 0.3);
  addChannel(boneMap.rightUpperArm, 0.15, 0.1, 0.1, 2.5, 1.4, 0.9, 0.25, 0.3);

  // ─── HAND MICRO-MOVEMENT ─────────────────────────────────
  // Subtle wrist/hand drift
  addChannel(boneMap.leftHand,  0.2, 0.15, 0.1, 3.1, 2.2, 1.5, 0.2, 0.25);
  addChannel(boneMap.rightHand, 0.2, 0.15, 0.1, 3.5, 2.7, 1.8, 0.2, 0.25);

  // ─── FOREARM (slight breathing follow-through) ───────────
  addChannel(boneMap.leftForearm,  0.1, 0, 0.05, 0.8, 0, 1.2, 1.0, 0.2);
  addChannel(boneMap.rightForearm, 0.1, 0, 0.05, 0.8, 0, 1.5, 1.0, 0.2);

  console.log(`[MintIdle] Created ${channels.length} idle motion channels`);

  return {
    channels,
    breathBaseFreq: 1.8,
    breathFreqExcited: 2.8,
    breathFreqSad: 1.2,
  };
}

/**
 * Compute the idle motion delta quaternion for a specific bone at a given time.
 *
 * @param idleData - The idle motion data
 * @param time - Current animation time in seconds
 * @param emotion - Current emotion (affects breathing rate and amplitude)
 * @param intensity - Base motion intensity (0.0 = still, 1.0 = full idle)
 * @returns A quaternion delta to be applied on top of the base pose
 */
export function computeIdleDelta(
  idleData: MintIdleData,
  bone: THREE.Object3D,
  time: number,
  emotion: string,
  intensity: number,
): THREE.Quaternion | null {
  // Find the channel for this bone
  let channel: IdleChannel | undefined;
  for (const ch of idleData.channels) {
    if (ch.bone === bone) {
      channel = ch;
      break;
    }
  }
  if (!channel) return null;

  // Compute effective breathing rate based on emotion
  let breathRate = idleData.breathBaseFreq;
  if (emotion === 'excited' || emotion === 'happy') {
    breathRate = idleData.breathFreqExcited;
  } else if (emotion === 'sad' || emotion === 'concerned') {
    breathRate = idleData.breathFreqSad;
  }

  // Use the channel's base frequency multiplied by the breathing rate
  const freq = channel.freq * breathRate;

  // Compute rotation deltas using sin/cos
  const rx = channel.rx * Math.sin(time * freq * 1.0 + channel.phaseX) * channel.intensity * intensity;
  const ry = channel.ry * Math.sin(time * freq * 0.7 + channel.phaseY) * channel.intensity * intensity;
  const rz = channel.rz * Math.sin(time * freq * 1.3 + channel.phaseZ) * channel.intensity * intensity;

  // Convert to quaternion
  _euler.set(rx, ry, rz, 'XYZ');
  _quat.setFromEuler(_euler);

  return _quat.clone();
}
