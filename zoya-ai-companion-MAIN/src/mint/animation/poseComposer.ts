import * as THREE from 'three';
import { MintBoneMap } from './skeletonMap';
import { MintBindPose, getBindQuat } from './bindPose';
import { MintBasePoseData, createBasePose, getBaseDelta } from './basePose';
import { MintIdleData, createIdleMotion, computeIdleDelta } from './idleMotion';
import {
  BodyEmotion,
  EmotionLayerState,
  createEmotionPose,
  createInitialEmotionState,
  interpolateEmotionState,
  computeEmotionDelta,
} from './emotionPose';
import { MintTalkingData, createTalkingMotion, computeTalkingDelta, updateTalkingActivation } from './talkingMotion';

/**
 * MintPoseComposer
 *
 * The ONE authoritative place where final bone transforms are calculated.
 *
 * Pipeline (each frame):
 *   Bind Pose
 *     → Base Pose (relaxed standing)
 *       → Idle Motion (breathing, weight shift)
 *         → Emotion Posture (body language)
 *           → Talking Motion (speech emphasis)
 *             → Final Local Quaternion
 *
 * CRITICAL RULES:
 * - Every frame starts from the BIND POSE
 * - Never accumulate from previous frame
 * - Final quaternion = bind × (base × idle × emotion × talking)
 * - Only this class writes final animation quaternions to bones
 */

export interface PoseComposerState {
  boneMap: MintBoneMap;
  bindPose: MintBindPose;
  basePose: MintBasePoseData;
  idleData: MintIdleData;
  emotionState: EmotionLayerState;
  talkingData: MintTalkingData;
  time: number;
}

/** Debug mode for testing individual layers */
export type DebugMode = 'FULL' | 'BASE_ONLY' | 'IDLE_ONLY' | 'EMOTION_ONLY' | 'TALKING_ONLY';

/** Scratch quaternions for composition (avoid per-frame allocation) */
const _bindQ = new THREE.Quaternion();
const _baseQ = new THREE.Quaternion();
const _idleQ = new THREE.Quaternion();
const _emotionQ = new THREE.Quaternion();
const _talkingQ = new THREE.Quaternion();

/**
 * Create the pose composer.
 */
export function createPoseComposer(boneMap: MintBoneMap, bindPose: MintBindPose) {
  console.log('%c[MintPoseComposer] ═══ INITIALIZING ═══', 'color: #ff00ff; font-weight: bold');

  const basePose = createBasePose(boneMap, bindPose);
  const idleData = createIdleMotion(boneMap);
  const emotionSystem = createEmotionPose(boneMap);
  const talkingData = createTalkingMotion(boneMap);
  const emotionState = createInitialEmotionState();

  const state: PoseComposerState = {
    boneMap,
    bindPose,
    basePose,
    idleData,
    emotionState,
    talkingData,
    time: 0,
  };

  return {
    state,
    emotionSystem,

    /**
     * Update all animation layers and apply final bone quaternions.
     *
     * @param delta - Time since last frame in seconds
     * @param emotion - Current emotion string
     * @param emotionIntensity - Emotion intensity (0-1)
     * @param isSpeaking - Whether speech is active
     * @param debugMode - Debug mode for testing
     */
    update(
      delta: number,
      emotion: string,
      emotionIntensity: number,
      isSpeaking: boolean,
      debugMode: DebugMode = 'FULL',
    ) {
      state.time += delta;

      // Update talking activation (smooth ramp)
      state.talkingData = updateTalkingActivation(state.talkingData, isSpeaking, delta);

      // Update emotion transitions
      const targetEmotion = sanitizeBodyEmotion(emotion);
      state.emotionState = interpolateEmotionState(
        state.emotionState,
        targetEmotion,
        emotionIntensity,
        delta,
      );

      // Apply final pose to all bones
      const allBones = collectAllBones(boneMap);

      for (const bone of allBones) {
        // 1. Start from bind pose
        const bindQ = getBindQuat(bindPose, bone);
        _bindQ.copy(bindQ);

        // 2. Compute base pose delta
        const baseDelta = getBaseDelta(basePose, bone);
        _baseQ.copy(baseDelta).multiply(_bindQ);

        if (debugMode === 'BASE_ONLY') {
          bone.quaternion.copy(_baseQ);
          continue;
        }

        // 3. Compute idle delta
        const idleDelta = computeIdleDelta(idleData, bone, state.time, emotion, emotionIntensity);
        if (idleDelta) {
          _idleQ.copy(idleDelta).multiply(_baseQ);
        } else {
          _idleQ.copy(_baseQ);
        }

        if (debugMode === 'IDLE_ONLY') {
          // Show base + idle (no emotion/talking)
          bone.quaternion.copy(_idleQ);
          continue;
        }

        // 4. Compute emotion delta
        const emotionDelta = computeEmotionDelta(emotionSystem, state.emotionState, bone);
        _emotionQ.copy(emotionDelta).multiply(_idleQ);

        if (debugMode === 'EMOTION_ONLY') {
          bone.quaternion.copy(_emotionQ);
          continue;
        }

        // 5. Compute talking delta
        const talkingDelta = computeTalkingDelta(state.talkingData, bone, state.time);
        if (talkingDelta) {
          _talkingQ.copy(talkingDelta).multiply(_emotionQ);
        } else {
          _talkingQ.copy(_emotionQ);
        }

        if (debugMode === 'TALKING_ONLY') {
          bone.quaternion.copy(_talkingQ);
          continue;
        }

        // 6. Final pose (FULL mode)
        bone.quaternion.copy(_talkingQ);
      }
    },

    /**
     * Get current emotion layer state (for external queries).
     */
    getEmotionState(): EmotionLayerState {
      return state.emotionState;
    },

    /**
     * Force an immediate emotion change (for testing).
     */
    setEmotion(emotion: BodyEmotion, intensity: number = 0.5) {
      state.emotionState.currentEmotion = emotion;
      state.emotionState.targetEmotion = emotion;
      state.emotionState.currentIntensity = intensity;
      state.emotionState.targetIntensity = intensity;
      state.emotionState.transitionProgress = 1.0;
    },

    /**
     * Get current time.
     */
    getTime(): number {
      return state.time;
    },
  };
}



/**
 * Collect all bones from the bone map into a flat array for iteration.
 */
function collectAllBones(boneMap: MintBoneMap): THREE.Object3D[] {
  const bones: THREE.Object3D[] = [];

  const slots = [
    'pelvis', 'spine', 'spine1', 'spine2', 'neck', 'head',
    'leftClavicle', 'leftUpperArm', 'leftForearm', 'leftHand',
    'rightClavicle', 'rightUpperArm', 'rightForearm', 'rightHand',
    'leftThigh', 'leftCalf', 'leftFoot', 'leftToe',
    'rightThigh', 'rightCalf', 'rightFoot', 'rightToe',
  ] as const;

  for (const slot of slots) {
    const bone = boneMap[slot];
    if (bone) bones.push(bone);
  }

  // Add finger bones (but we won't animate them aggressively)
  const addFingers = (fingerMap: Map<string, THREE.Object3D[]>) => {
    for (const chain of fingerMap.values()) {
      for (const bone of chain) {
        if (!bones.includes(bone)) {
          bones.push(bone);
        }
      }
    }
  };

  addFingers(boneMap.leftFingers);
  addFingers(boneMap.rightFingers);

  return bones;
}

/**
 * Sanitize an emotion string to a valid BodyEmotion.
 * Maps from EmotionType / animation intent to body emotion.
 */
function sanitizeBodyEmotion(raw: string): BodyEmotion {
  const lower = raw.toLowerCase();
  const validBodyEmotions: BodyEmotion[] = [
    'neutral', 'happy', 'sad', 'angry', 'excited', 'surprised',
    'thinking', 'laughing', 'listening', 'greeting', 'goodbye',
    'confused', 'shy', 'calm', 'talking',
  ];

  if (validBodyEmotions.includes(lower as BodyEmotion)) {
    return lower as BodyEmotion;
  }

  // Map common emotion types to body emotions
  switch (lower) {
    case 'amused':
    case 'playful':
      return 'happy';
    case 'concerned':
      return 'sad';
    case 'curious':
    case 'thoughtful':
      return 'thinking';
    case 'embarrassed':
    case 'affectionate':
      return 'shy';
    default:
      return 'neutral';
  }
}
