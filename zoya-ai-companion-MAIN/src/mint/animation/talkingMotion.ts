import * as THREE from 'three';
import { MintBoneMap } from './skeletonMap';

/**
 * MintTalkingMotion
 *
 * Procedural body movement when Zoya is speaking.
 * Compatible with Google Cloud TTS audio playback.
 * Does NOT delay audio playback.
 *
 * Motion includes:
 * - Subtle head emphasis movements
 * - Small shoulder gestures
 * - Slight posture variation
 * - Hand emphasis (very subtle)
 *
 * Does NOT:
 * - Make the entire body shake
 * - Interfere with lip-sync / viseme system
 * - Use external animation files
 */

/** Per-bone talking motion channel */
interface TalkingChannel {
  bone: THREE.Object3D;
  rx: number; // amplitude X
  ry: number; // amplitude Y
  rz: number; // amplitude Z
  phaseX: number;
  phaseY: number;
  phaseZ: number;
  freq: number;
}

/** Scratch objects */
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

export interface MintTalkingData {
  channels: TalkingChannel[];
  /** Whether talking motion is currently active */
  isActive: boolean;
  /** Smooth activation ramp (0-1) to prevent sudden start */
  activationLevel: number;
}

/**
 * Create talking motion data.
 */
export function createTalkingMotion(boneMap: MintBoneMap): MintTalkingData {
  console.log('[MintTalking] Creating talking motion channels');

  const channels: TalkingChannel[] = [];

  const addChannel = (
    bone: THREE.Object3D | null,
    rx: number, ry: number, rz: number,
    px: number, py: number, pz: number,
    freq: number,
  ) => {
    if (!bone) return;
    channels.push({
      bone,
      rx: rx * Math.PI / 180,
      ry: ry * Math.PI / 180,
      rz: rz * Math.PI / 180,
      phaseX: px, phaseY: py, phaseZ: pz,
      freq,
    });
  };

  // ─── HEAD (emphasis during speech) ────────────────────────
  // Very subtle nod and turn during speaking
  addChannel(boneMap.head, 1.0, 0.8, 0.4, 0, 1.3, 2.7, 2.5);
  addChannel(boneMap.neck, 0.5, 0.4, 0.2, 0.5, 1.5, 3.0, 2.5);

  // ─── SHOULDERS (subtle emphasis) ──────────────────────────
  addChannel(boneMap.leftClavicle,  0.3, 0, 0.2, 0.7, 0, 1.1, 1.8);
  addChannel(boneMap.rightClavicle, 0.3, 0, 0.2, 0.7, 0, 1.4, 1.8);

  // ─── UPPER ARMS (subtle gesture emphasis) ─────────────────
  addChannel(boneMap.leftUpperArm,  0.3, 0.15, 0.1, 1.2, 2.1, 0.8, 1.5);
  addChannel(boneMap.rightUpperArm, 0.3, 0.15, 0.1, 1.4, 2.4, 1.1, 1.5);

  // ─── HANDS (subtle gesture) ───────────────────────────────
  addChannel(boneMap.leftHand,  0.4, 0.2, 0.15, 1.8, 2.5, 3.1, 1.2);
  addChannel(boneMap.rightHand, 0.4, 0.2, 0.15, 2.0, 2.8, 3.4, 1.2);

  // ─── SPINE (very subtle emphasis) ─────────────────────────
  addChannel(boneMap.spine,  0.15, 0, 0.05, 0, 0, 0.5, 1.8);
  addChannel(boneMap.spine1, 0.1, 0, 0.05, 0.3, 0, 0.8, 1.8);

  console.log(`[MintTalking] Created ${channels.length} talking motion channels`);

  return {
    channels,
    isActive: false,
    activationLevel: 0,
  };
}

/**
 * Update talking motion activation.
 * Smoothly ramps activation up/down to prevent sudden snaps.
 */
export function updateTalkingActivation(
  talking: MintTalkingData,
  isSpeaking: boolean,
  delta: number,
): MintTalkingData {
  const target = isSpeaking ? 1.0 : 0.0;
  const speed = isSpeaking ? 4.0 : 3.0; // Faster onset, slightly slower offset
  const newLevel = THREE.MathUtils.lerp(talking.activationLevel, target, Math.min(delta * speed, 0.4));

  return {
    ...talking,
    isActive: isSpeaking || newLevel > 0.01,
    activationLevel: newLevel,
  };
}

/**
 * Compute the talking motion delta for a bone at a given time.
 *
 * @param talking - The talking motion data
 * @param bone - The bone to compute for
 * @param time - Current animation time
 * @returns Quaternion delta, or null if no channel exists
 */
export function computeTalkingDelta(
  talking: MintTalkingData,
  bone: THREE.Object3D,
  time: number,
): THREE.Quaternion | null {
  if (talking.activationLevel < 0.001) return null;

  let channel: TalkingChannel | undefined;
  for (const ch of talking.channels) {
    if (ch.bone === bone) {
      channel = ch;
      break;
    }
  }
  if (!channel) return null;

  // Compute multi-frequency motion
  const rx = channel.rx * Math.sin(time * channel.freq + channel.phaseX);
  const ry = channel.ry * Math.sin(time * channel.freq * 0.8 + channel.phaseY);
  const rz = channel.rz * Math.sin(time * channel.freq * 1.2 + channel.phaseZ);

  _euler.set(rx, ry, rz, 'XYZ');
  _quat.setFromEuler(_euler);

  // Scale by activation level
  _quat.identity().slerp(_quat, talking.activationLevel);

  return _quat.clone();
}
