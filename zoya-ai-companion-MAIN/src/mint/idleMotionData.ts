/**
 * @deprecated This file has been replaced by ./animation/idleMotion.ts
 * 
 * The new procedural idle motion lives in the ./animation/ directory.
 * This file is kept as an empty stub for backward compatibility only.
 */
export const IDLE_DURATION = 9.933333333333334;
export const IDLE_FPS = 30;
export const IDLE_TOTAL_TICKS = 298;
export const SAMPLE_STEP = 3;
export interface BoneSample { t: number; qw: number; qx: number; qy: number; qz: number; }
export interface BoneMotionData { mixamoBone: string; mintKey: string; rest: { qw: number; qx: number; qy: number; qz: number }; samples: BoneSample[]; maxDev: number; }
export const IDLE_BONES: BoneMotionData[] = [];
