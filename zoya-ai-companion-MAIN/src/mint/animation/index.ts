/**
 * Mint Animation System (NEW)
 *
 * Clean, minimal procedural animation for Mint.
 * No external animation files. No Mixamo. No AnimationMixer.
 */

export { MintAnimationController } from './animationController';
export { discoverMintBones, validateSkeleton } from './skeletonMap';
export type { MintBoneMap } from './skeletonMap';
export { captureBindPose } from './bindPose';
export type { MintBindPose } from './bindPose';
export { createBasePose, getBaseDelta, dumpBoneDirections, runSingleBoneTest } from './basePose';
export type { MintBasePoseData } from './basePose';
export { createIdleMotion, computeIdleDelta } from './idleMotion';
export type { MintIdleData } from './idleMotion';
export { createEmotionPose, computeEmotionDelta, createInitialEmotionState } from './emotionPose';
export type { BodyEmotion, EmotionLayerState } from './emotionPose';
export { createTalkingMotion, computeTalkingDelta } from './talkingMotion';
export type { MintTalkingData } from './talkingMotion';
export { createPoseComposer } from './poseComposer';
export type { DebugMode } from './poseComposer';
