import type { AnimationIntent } from '../types';
import {
  carlottaAnimationController,
  isValidCarlottaAnimationState,
  isValidCarlottaEmotion,
  type CarlottaAnimationState,
  type CarlottaEmotion,
} from './carlottaAnimationController';
import {
  carlottaGestureController,
  isValidCarlottaGestureName,
  type CarlottaGestureName,
} from './carlottaGestureController';
import { isDevBuild } from './runtimeEnv';

/**
 * Carlotta Animation Skill System — scalable foundation for intent-driven
 * animation (skill library → discovery → validation → retargeting → cache).
 *
 * Long-term pipeline (only the resolver + procedural delegation exist today):
 *   Groq/Zoya Brain → AnimationIntent → resolve/dispatch (here)
 *   → procedural controllers | library | unavailable
 *   → (future) discovery → validation → retargeting → cache → layered playback
 *
 * Hard rule, enforced by construction: Groq/intents NEVER touch bones.
 * Only the existing procedural controllers write transforms. Unknown or
 * unsupported intents resolve `unavailable` and change nothing — Zoya can
 * never freeze or break on a missing skill.
 */

export type SkillSource = 'procedural' | 'library' | 'unavailable';

export type SkillCategory =
  | 'behavior'
  | 'emotion'
  | 'gesture'
  | 'locomotion'
  | 'reaction'
  | 'idle';

export type SkillFormat = 'procedural' | 'vrm' | 'glb' | 'bvh' | 'fbx';

export interface AnimationSkill {
  id: string;
  name: string;
  category: SkillCategory;
  /** Where the skill came from. No downloading exists yet. */
  source: 'procedural' | 'local' | 'learned';
  license: string;
  format: SkillFormat;
  /** Seconds; 0 for looping/procedural skills. */
  duration: number;
  compatible: boolean;
  retargetedFor: string;
  qualityScore: number;
  version: number;
}

/**
 * Intent vocabulary accepted by the skill system. The shared
 * `AnimationIntent` union is intentionally NOT extended (frozen per
 * architecture decision — Groq/Mint/App types stay exactly as they are);
 * gesture nouns are accepted here only, so DEV hooks and future acquisition
 * can address gestures without touching shared types.
 */
export type SkillIntent = AnimationIntent | CarlottaGestureName;

export interface SkillResolution {
  intent: SkillIntent;
  source: SkillSource;
  /** Set for procedural/library hits; null when unavailable. */
  skill: AnimationSkill | null;
  /** Human-readable reason — especially for `unavailable`. */
  reason: string;
}

/** Procedural delegation target inside the existing controllers. */
interface ProceduralBinding {
  kind: 'behavior';
  state: CarlottaAnimationState;
  emotion: null;
  gesture: null;
  defaultIntensity: null;
}

interface ProceduralEmotionBinding {
  kind: 'emotion';
  state: null;
  emotion: CarlottaEmotion;
  gesture: null;
  defaultIntensity: number;
}

interface ProceduralGestureBinding {
  kind: 'gesture';
  state: null;
  emotion: null;
  gesture: CarlottaGestureName;
  defaultIntensity: null;
}

type ProceduralTarget = ProceduralBinding | ProceduralEmotionBinding | ProceduralGestureBinding;

/**
 * Intents the existing Carlotta procedural stack already supports.
 * Everything else in AnimationIntent resolves `unavailable` (safe fallback:
 * current state is left untouched).
 */
const PROCEDURAL_TARGETS: Partial<Record<SkillIntent, ProceduralTarget>> = {
  idle: { kind: 'behavior', state: 'idle', emotion: null, gesture: null, defaultIntensity: null },
  listening: { kind: 'behavior', state: 'listening', emotion: null, gesture: null, defaultIntensity: null },
  talking: { kind: 'behavior', state: 'talking', emotion: null, gesture: null, defaultIntensity: null },
  thinking: { kind: 'behavior', state: 'thinking', emotion: null, gesture: null, defaultIntensity: null },
  calm: { kind: 'emotion', state: null, emotion: 'calm', gesture: null, defaultIntensity: 0.5 },
  happy: { kind: 'emotion', state: null, emotion: 'happy', gesture: null, defaultIntensity: 0.7 },
  excited: { kind: 'emotion', state: null, emotion: 'excited', gesture: null, defaultIntensity: 0.7 },
  sad: { kind: 'emotion', state: null, emotion: 'sad', gesture: null, defaultIntensity: 0.7 },
  angry: { kind: 'emotion', state: null, emotion: 'angry', gesture: null, defaultIntensity: 0.7 },
  wave: { kind: 'gesture', state: null, emotion: null, gesture: 'wave', defaultIntensity: null },
  greeting: { kind: 'gesture', state: null, emotion: null, gesture: 'greeting', defaultIntensity: null },
  goodbye: { kind: 'gesture', state: null, emotion: null, gesture: 'goodbye', defaultIntensity: null },
  point: { kind: 'gesture', state: null, emotion: null, gesture: 'point', defaultIntensity: null },
  shrug: { kind: 'gesture', state: null, emotion: null, gesture: 'shrug', defaultIntensity: null },
  clap: { kind: 'gesture', state: null, emotion: null, gesture: 'clap', defaultIntensity: null },
  bow: { kind: 'gesture', state: null, emotion: null, gesture: 'bow', defaultIntensity: null },
};

function proceduralSkillFor(intent: SkillIntent, target: ProceduralTarget): AnimationSkill {
  return {
    id: `procedural:${intent}`,
    name: intent,
    category: target.kind === 'gesture' ? 'gesture' : target.kind === 'behavior' ? 'behavior' : 'emotion',
    source: 'procedural',
    license: 'internal',
    format: 'procedural',
    duration: 0,
    compatible: true,
    retargetedFor: 'carlotta-vrm0',
    qualityScore: 1,
    version: 1,
  };
}

/** Local animation library. Starts empty; learned skills register here. */
const skillLibrary = new Map<string, AnimationSkill>();

/**
 * Pure resolver: answer what handles an intent without touching animation.
 * Never throws, never writes bones, never freezes.
 */
export function resolveSkill(intent: SkillIntent): SkillResolution {
  const procedural = PROCEDURAL_TARGETS[intent];
  if (procedural) {
    return {
      intent,
      source: 'procedural',
      skill: proceduralSkillFor(intent, procedural),
      reason: `handled procedurally by the existing Carlotta controllers (${procedural.kind})`,
    };
  }
  const learned = skillLibrary.get(intent);
  if (learned && learned.compatible) {
    return { intent, source: 'library', skill: learned, reason: `cached skill '${learned.id}'` };
  }
  return {
    intent,
    source: 'unavailable',
    skill: null,
    reason: `no procedural or cached skill for '${intent}' — current state left untouched`,
  };
}

/**
 * Resolver + orchestrator: apply a procedurally supported intent to the
 * existing controllers. Behavior and emotion stay independent (a behavior
 * intent never resets emotion and vice versa). Unavailable intents are a
 * no-op returning false. The controllers remain the only bone writers.
 */
export function dispatchSkillIntent(intent: SkillIntent): boolean {
  const resolution = resolveSkill(intent);
  if (resolution.source !== 'procedural' || !resolution.skill) return false;
  const target = PROCEDURAL_TARGETS[intent];
  if (!target) return false;
  if (target.kind === 'behavior' && target.state) {
    if (!isValidCarlottaAnimationState(target.state)) return false;
    carlottaAnimationController.setState(target.state);
    return true;
  }
  if (target.kind === 'emotion' && target.emotion) {
    if (!isValidCarlottaEmotion(target.emotion)) return false;
    return carlottaAnimationController.setEmotion(target.emotion, target.defaultIntensity ?? 0.5);
  }
  if (target.kind === 'gesture' && target.gesture) {
    if (!isValidCarlottaGestureName(target.gesture)) return false;
    return carlottaGestureController.start(target.gesture);
  }
  return false;
}

/** Register a learned/cached skill (future acquisition pipeline). */
export function registerSkill(skill: AnimationSkill): boolean {
  if (!skill || typeof skill.id !== 'string' || skill.id.length === 0) return false;
  if (!skill.compatible) return false;
  skillLibrary.set(skill.name, skill);
  return true;
}

/** Look up a cached skill without dispatching. */
export function getCachedSkill(intent: SkillIntent): AnimationSkill | null {
  return skillLibrary.get(intent) ?? null;
}

// ── Retargeting architecture (interfaces/types only) ────────────────
// Pure string-based bone references: no three.js imports, no renderer
// coupling, no VRM mutation. Nothing here executes motion.

/** Humanoid bone slot names (three-vrm humanoid vocabulary, string form). */
export type HumanoidBoneSlot =
  | 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head'
  | 'shoulder' | 'upperArm' | 'lowerArm' | 'hand'
  | 'upperLeg' | 'lowerLeg' | 'foot' | 'toes';

export type RetargetSourceFormat = 'glb' | 'gltf' | 'bvh' | 'vrm' | 'fbx';

export interface RetargetRequest {
  format: RetargetSourceFormat;
  /** Source bone names present in the candidate animation. */
  sourceBones: string[];
  /** Target Carlotta slots the animation needs. */
  requiredSlots: HumanoidBoneSlot[];
  /** Declared license of the candidate — must be reviewed, never assumed. */
  license: string;
}

export interface RetargetResult {
  compatible: boolean;
  /** Empty when compatible; concrete blockers otherwise. */
  reasons: string[];
  /** Slots with no usable source binding (animates procedurally instead). */
  unmappedSlots: HumanoidBoneSlot[];
}

/** Slots the Carlotta procedural stack actually drives today. */
const DRIVEN_SLOTS: readonly HumanoidBoneSlot[] = [
  'spine',
  'chest',
  'neck',
  'head',
  'shoulder',
];

/**
 * Honest capability probe: can this candidate be retargeted with the
 * CURRENT stack? Always explains itself; never pretends compatibility.
 * (Side-aware slots like left/right arms are intentionally out of scope
 * until the gesture layer exists.)
 */
export function canRetarget(request: RetargetRequest): RetargetResult {
  const reasons: string[] = [];
  if (!request || typeof request !== 'object') {
    return { compatible: false, reasons: ['empty request'], unmappedSlots: [] };
  }
  if (request.format !== 'vrm' && request.format !== 'glb' && request.format !== 'gltf') {
    reasons.push(`format '${String(request.format)}' has no retargeter yet`);
  }
  if (!Array.isArray(request.sourceBones) || request.sourceBones.length === 0) {
    reasons.push('no source skeleton provided');
  }
  const required = Array.isArray(request.requiredSlots) ? request.requiredSlots : [];
  const unmapped = required.filter((slot) => !DRIVEN_SLOTS.includes(slot));
  if (unmapped.length > 0) {
    reasons.push(`slots need a gesture layer first: ${unmapped.join(', ')}`);
  }
  if (!request.license) {
    reasons.push('license must be reviewed before use');
  }
  return { compatible: reasons.length === 0, reasons, unmappedSlots: unmapped };
}

// ── Future gesture layer reservation (arms only) ────────────────────
// Documents where clip-driven gestures will live so they can never fight
// the 6-bone procedural body controller. No implementation yet.

/** Humanoid API slots reserved for future gesture clips (both sides). */
export const GESTURE_RESERVED_SLOTS: readonly string[] = [
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
];

// ── Future web acquisition pipeline (interface only — no I/O) ──────
// Downloaded animation data must be treated as UNTRUSTED data: validate
// format/skeleton/license, retarget in isolation, quality-test, and cache
// locally before anything may reference it. Nothing here touches network.

export type AcquisitionStage =
  | 'idle'
  | 'searching'
  | 'candidateFound'
  | 'licenseCheck'
  | 'validating'
  | 'inspectingSkeleton'
  | 'retargetabilityCheck'
  | 'retargeting'
  | 'qualityTest'
  | 'caching'
  | 'registered'
  | 'failed';

export interface AcquisitionState {
  stage: AcquisitionStage;
  intent: SkillIntent | null;
  /** Why acquisition stopped; set when stage is 'failed'. */
  failureReason: string | null;
}

export interface SkillAcquisition {
  readonly state: AcquisitionState;
  /** Always refuses in this pass: no network, no downloads. */
  request(intent: SkillIntent): AcquisitionState;
  cancel(): void;
}

/** Placeholder acquisition pipeline: documents the flow, performs nothing. */
export const skillAcquisition: SkillAcquisition = (() => {
  const state: AcquisitionState = { stage: 'idle', intent: null, failureReason: null };
  return {
    get state(): AcquisitionState {
      return { ...state };
    },
    request(intent: SkillIntent): AcquisitionState {
      state.stage = 'failed';
      state.intent = intent;
      state.failureReason = 'web acquisition is not implemented in this pass (no network I/O)';
      return { ...state };
    },
    cancel(): void {
      state.stage = 'idle';
      state.intent = null;
      state.failureReason = null;
    },
  };
})();

// ── DEV diagnostics (temporary, silent in production) ───────────────

function ensureDevHooks(): void {
  if (!isDevBuild()) return;
  try {
    const w = window as unknown as Record<string, unknown>;
    w.__carlottaSkillResolve = (intent: unknown): SkillResolution | null => {
      if (typeof intent !== 'string') return null;
      return resolveSkill(intent as SkillIntent);
    };
    w.__carlottaSkillDispatch = (intent: unknown): boolean => {
      if (typeof intent !== 'string') return false;
      return dispatchSkillIntent(intent as SkillIntent);
    };
    w.__carlottaSkillCanRetarget = (request: unknown): RetargetResult =>
      canRetarget(request as RetargetRequest);
  } catch {
    /* non-browser runtimes: hooks unavailable */
  }
}

let devHooksRegistered = false;

/** Called once from renderer wiring; DEV-only hook registration. */
export function registerSkillDevHooks(): void {
  if (devHooksRegistered) return;
  devHooksRegistered = true;
  ensureDevHooks();
}
