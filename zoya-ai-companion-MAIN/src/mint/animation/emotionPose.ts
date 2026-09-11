import * as THREE from 'three';
import { MintBoneMap } from './skeletonMap';

/**
 * MintEmotionPose
 *
 * Defines body posture deltas for each emotion.
 * Transitions between emotions are smoothly interpolated.
 *
 * CRITICAL: Emotion deltas are added on top of base pose + idle.
 * Groq NEVER directly controls bone rotations.
 * The animation controller receives a safe enum/state only.
 */

/** Supported emotion states for body animation */
export type BodyEmotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'excited'
  | 'surprised'
  | 'thinking'
  | 'laughing'
  | 'listening'
  | 'greeting'
  | 'goodbye'
  | 'confused'
  | 'shy'
  | 'calm'
  | 'talking';

/** Per-bone rotation target for an emotion */
interface EmotionBoneTarget {
  bone: THREE.Object3D;
  rx: number; // rotation around X (degrees)
  ry: number; // rotation around Y (degrees)
  rz: number; // rotation around Z (degrees)
}

/** Complete posture definition for one emotion */
interface EmotionPosture {
  bones: EmotionBoneTarget[];
}

/** Current emotion state for the pose layer */
export interface EmotionLayerState {
  currentEmotion: BodyEmotion;
  targetEmotion: BodyEmotion;
  currentIntensity: number;
  targetIntensity: number;
  transitionProgress: number; // 0 = at current, 1 = at target
  transitionSpeed: number;
  previousEmotion: BodyEmotion;
  previousIntensity: number;
}

/** Scratch objects */
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _lerpQ = new THREE.Quaternion();

/**
 * Create the emotion pose system.
 */
export function createEmotionPose(
  boneMap: MintBoneMap,
): { getDelta: (emotion: BodyEmotion, bone: THREE.Object3D) => THREE.Quaternion; } {
  // Build postures from bone map
  const postures = buildPostures(boneMap);

  return {
    getDelta: (emotion: BodyEmotion, bone: THREE.Object3D): THREE.Quaternion => {
      const posture = postures[emotion];
      if (!posture) return new THREE.Quaternion();

      for (const target of posture.bones) {
        if (target.bone === bone) {
          _euler.set(
            target.rx * Math.PI / 180,
            target.ry * Math.PI / 180,
            target.rz * Math.PI / 180,
            'XYZ',
          );
          _quat.setFromEuler(_euler);
          return _quat.clone();
        }
      }
      return new THREE.Quaternion();
    },
  };
}

/**
 * Smoothly interpolate between two emotion layer states.
 * Returns the interpolated state.
 */
export function interpolateEmotionState(
  current: EmotionLayerState,
  targetEmotion: BodyEmotion,
  targetIntensity: number,
  delta: number,
): EmotionLayerState {
  // If emotion changed, start a new transition
  if (targetEmotion !== current.targetEmotion) {
    return {
      currentEmotion: current.targetEmotion,
      targetEmotion: targetEmotion,
      currentIntensity: current.targetIntensity,
      targetIntensity: targetIntensity,
      transitionProgress: 0,
      transitionSpeed: 2.0, // ~0.5s transition
      previousEmotion: current.currentEmotion,
      previousIntensity: current.currentIntensity,
    };
  }

  // Update intensity smoothly
  const newIntensity = THREE.MathUtils.lerp(current.currentIntensity, targetIntensity, Math.min(delta * 3, 0.3));

  // Advance transition
  const newProgress = Math.min(1.0, current.transitionProgress + delta * current.transitionSpeed);

  return {
    ...current,
    currentIntensity: newIntensity,
    transitionProgress: newProgress,
  };
}

/**
 * Create initial emotion layer state.
 */
export function createInitialEmotionState(): EmotionLayerState {
  return {
    currentEmotion: 'neutral',
    targetEmotion: 'neutral',
    currentIntensity: 0.3,
    targetIntensity: 0.3,
    transitionProgress: 1.0,
    transitionSpeed: 2.0,
    previousEmotion: 'neutral',
    previousIntensity: 0.3,
  };
}

/**
 * Compute the blended emotion delta quaternion for a bone,
 * using smoothstep interpolation between current and target emotions.
 */
export function computeEmotionDelta(
  emotionSystem: { getDelta: (e: BodyEmotion, b: THREE.Object3D) => THREE.Quaternion },
  state: EmotionLayerState,
  bone: THREE.Object3D,
): THREE.Quaternion {
  const t = smoothstep(state.transitionProgress);
  const prevQ = emotionSystem.getDelta(state.previousEmotion, bone);
  const targetQ = emotionSystem.getDelta(state.targetEmotion, bone);

  // Blend between previous and target
  _lerpQ.copy(prevQ).slerp(targetQ, t);

  // Scale by intensity
  _quat.identity();
  _quat.slerp(_lerpQ, state.currentIntensity);

  return _quat.clone();
}

/** Smoothstep for natural transitions */
function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// ═══════════════════════════════════════════════════════════════
//  POSTURE DEFINITIONS
//
//  Each emotion defines small body language changes:
//  - Head tilt/turn
//  - Shoulder position
//  - Arm position
//  - Spine curve
//
//  Amplitudes are intentionally small.
//  The face (morph targets) carries most of the emotion;
//  the body provides subtle supporting body language.
// ═══════════════════════════════════════════════════════════════

function buildPostures(boneMap: MintBoneMap): Record<BodyEmotion, EmotionPosture> {
  const makePosture = (def: Record<string, [number, number, number]>): EmotionPosture => {
    const bones: EmotionBoneTarget[] = [];
    for (const [slot, [rx, ry, rz]] of Object.entries(def)) {
      const bone = (boneMap as any)[slot] as THREE.Object3D | null;
      if (bone) bones.push({ bone, rx, ry, rz });
    }
    return { bones };
  };

  return {
    neutral: makePosture({
      // Subtle natural idle — very minimal
      head: [0, 0, 0],
      neck: [0, 0, 0],
      spine: [0, 0, 0],
      spine1: [0, 0, 0],
      spine2: [0, 0, 0],
      leftClavicle: [0, 0, 0],
      rightClavicle: [0, 0, 0],
      leftUpperArm: [0, 0, 0],
      rightUpperArm: [0, 0, 0],
    }),

    happy: makePosture({
      // Slight upright posture, shoulders back slightly
      head: [-2, 0, 3],          // slight right tilt
      neck: [-1, 0, 2],
      spine: [-0.5, 0, 0],       // very slight backward lean
      spine1: [-0.5, 0, 0],
      spine2: [-0.5, 0, 0],
      leftClavicle: [3, 0, -2],
      rightClavicle: [3, 0, 2],
      leftUpperArm: [-2, 0, -2],
      rightUpperArm: [-2, 0, 2],
    }),

    excited: makePosture({
      // More energetic, slight forward lean, wider stance
      head: [-3, 0, 2],
      neck: [-2, 0, 1],
      spine: [-1, 0, 0],
      spine1: [-1, 0, 0],
      spine2: [-1, 0, 0],
      leftClavicle: [5, 0, -3],
      rightClavicle: [5, 0, 3],
      leftUpperArm: [-3, 0, -3],
      rightUpperArm: [-3, 0, 3],
      leftForearm: [2, 0, 0],
      rightForearm: [2, 0, 0],
    }),

    sad: makePosture({
      // Slightly drooped shoulders, head down
      head: [4, 0, -2],          // head tilted down and left
      neck: [2, 0, -1],
      spine: [1, 0, 0],          // very slight slouch
      spine1: [0.5, 0, 0],
      spine2: [0.5, 0, 0],
      leftClavicle: [-2, 0, 2],  // shoulders droop
      rightClavicle: [-2, 0, -2],
      leftUpperArm: [2, 0, 1],
      rightUpperArm: [2, 0, -1],
    }),

    angry: makePosture({
      // Tense, slight forward lean, rigid
      head: [2, 0, 0],           // head slightly forward
      neck: [1, 0, 0],
      spine: [-1.5, 0, 0],       // forward lean
      spine1: [-0.5, 0, 0],
      spine2: [-0.5, 0, 0],
      leftClavicle: [2, 0, -1],
      rightClavicle: [2, 0, 1],
      leftUpperArm: [3, 0, 2],   // arms slightly tensed
      rightUpperArm: [3, 0, -2],
    }),

    surprised: makePosture({
      // Slight pull back, wider eyes (body: surprised step back)
      head: [-3, 0, 0],          // head pulls back
      neck: [-2, 0, 0],
      spine: [2, 0, 0],          // slight backward lean
      spine1: [1, 0, 0],
      spine2: [0.5, 0, 0],
      leftClavicle: [4, 0, -2],
      rightClavicle: [4, 0, 2],
    }),

    thinking: makePosture({
      // Head tilted, one shoulder slightly up
      head: [-2, 8, 5],          // head tilted and turned
      neck: [-1, 5, 3],
      spine: [0.5, 2, 0],
      spine1: [0, 1, 0],
      leftClavicle: [2, 0, -2],
      rightClavicle: [3, 0, 3],  // right shoulder slightly raised
      leftUpperArm: [0, 0, -1],
      rightUpperArm: [-2, 0, 3],
    }),

    laughing: makePosture({
      // Leaning back slightly, open posture
      head: [-2, 0, 3],
      neck: [-1, 0, 2],
      spine: [-2, 0, 0],         // lean back
      spine1: [-1, 0, 0],
      spine2: [-0.5, 0, 0],
      leftClavicle: [4, 0, -3],
      rightClavicle: [4, 0, 3],
      leftUpperArm: [-3, 0, -4],
      rightUpperArm: [-3, 0, 4],
    }),

    listening: makePosture({
      // Slightly forward, attentive
      head: [-1, 3, 2],          // slight tilt
      neck: [-0.5, 2, 1],
      spine: [-0.5, 0, 0],
      spine1: [-0.5, 0, 0],
      leftClavicle: [1, 0, -1],
      rightClavicle: [1, 0, 1],
    }),

    greeting: makePosture({
      // Slight nod posture
      head: [3, 0, 0],           // nod
      neck: [2, 0, 0],
      spine: [0, 0, 0],
      leftClavicle: [2, 0, -2],
      rightClavicle: [2, 0, 2],
    }),

    goodbye: makePosture({
      // Slight forward lean
      head: [2, -3, 0],
      neck: [1, -2, 0],
      spine: [-0.5, 0, 0],
      leftClavicle: [3, 0, -2],
      rightClavicle: [3, 0, 2],
    }),

    confused: makePosture({
      // Head tilted, one shoulder raised
      head: [-2, -5, 6],         // tilted and turned
      neck: [-1, -3, 3],
      spine: [0, 2, 0],
      leftClavicle: [3, 0, -3],
      rightClavicle: [2, 0, 2],  // one shoulder up
      leftUpperArm: [0, 0, -2],
      rightUpperArm: [-1, 0, 3],
    }),

    shy: makePosture({
      // Slightly turned away, head lowered
      head: [3, -4, -3],         // looking down and away
      neck: [2, -2, -2],
      spine: [1, 0, 1],
      spine1: [0.5, 0, 0.5],
      leftClavicle: [-1, 0, 2],
      rightClavicle: [-1, 0, -2],
      leftUpperArm: [1, 0, 2],
      rightUpperArm: [1, 0, -2],
    }),

    calm: makePosture({
      // Very relaxed, minimal change from neutral
      head: [-0.5, 0, 1],
      neck: [-0.5, 0, 0.5],
      spine: [-0.3, 0, 0],
      leftClavicle: [1, 0, -1],
      rightClavicle: [1, 0, 1],
    }),

    talking: makePosture({
      // Slight engagement, subtle emphasis movements
      head: [-1, 0, 1],
      neck: [-0.5, 0, 0.5],
      spine: [-0.3, 0, 0],
      spine1: [-0.3, 0, 0],
      leftClavicle: [1, 0, -1],
      rightClavicle: [1, 0, 1],
      leftUpperArm: [-0.5, 0, -1],
      rightUpperArm: [-0.5, 0, 1],
    }),
  };
}
