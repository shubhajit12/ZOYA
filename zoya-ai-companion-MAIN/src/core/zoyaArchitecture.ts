/**
 * ZOYA Core Architecture Contracts
 *
 * This module is deliberately dependency-free. It defines the boundaries that
 * future memory, learning, personality, behavior, and body systems must use.
 *
 * Architecture rule:
 *   Brain -> State/Intent -> Behavior -> Body
 *   Memory is persistent context, not model training.
 *
 * Nothing in this file talks to Three.js, VRM, the network, localStorage, or
 * an AI provider. That keeps the foundation stable while individual systems
 * evolve independently.
 */

export type ZoyaId = string;

export type ZoyaEmotion =
  | 'neutral'
  | 'happy'
  | 'excited'
  | 'amused'
  | 'curious'
  | 'surprised'
  | 'sad'
  | 'concerned'
  | 'angry'
  | 'embarrassed'
  | 'shy'
  | 'thoughtful'
  | 'confused'
  | 'affectionate'
  | 'playful';

export type ZoyaMemoryCategory =
  | 'preference'
  | 'fact'
  | 'interest'
  | 'personal'
  | 'general';

export type ZoyaMemorySource = 'user' | 'conversation' | 'system' | 'learned';

/** A persistent fact/context item. It is not a weight update or model training. */
export interface ZoyaMemory {
  id: ZoyaId;
  content: string;
  category: ZoyaMemoryCategory;
  source: ZoyaMemorySource;
  createdAt: number;
  updatedAt: number;
  confidence: number;
  importance: number;
}

/** A single experience that may be evaluated by the future learning layer. */
export interface ZoyaExperience {
  id: ZoyaId;
  timestamp: number;
  summary: string;
  outcome: 'positive' | 'neutral' | 'negative' | 'unknown';
  confidence: number;
  /** Experiences are inputs to learning; they are never executed as code. */
  trusted: boolean;
}

/** A learned association/rule, kept separate from memories and the AI model. */
export interface ZoyaLearnedBehavior {
  id: ZoyaId;
  trigger: string;
  response: string;
  confidence: number;
  observations: number;
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
}

export interface ZoyaMoodState {
  emotion: ZoyaEmotion;
  intensity: number;
  /** Stable state may change gradually; consumers should not jump values. */
  moodVector: Record<string, number>;
  lastChangedAt: number;
}

/** What the brain/behavior layer asks the physical body to do. */
export type ZoyaBodyIntent =
  | 'idle'
  | 'listen'
  | 'talk'
  | 'think'
  | 'greet'
  | 'wave'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'calm';

export interface ZoyaBehaviorDecision {
  id: ZoyaId;
  intent: ZoyaBodyIntent;
  emotion: ZoyaEmotion;
  intensity: number;
  reason: string;
  createdAt: number;
  expiresAt: number | null;
}

/** Provider-agnostic result from the AI brain. No body/bone references allowed. */
export interface ZoyaBrainResult {
  reply: string;
  emotion: ZoyaEmotion;
  emotionIntensity: number;
  memoryCandidates: string[];
  behaviorIntent: ZoyaBodyIntent | null;
}

/** Read-only snapshot passed between layers. */
export interface ZoyaRuntimeState {
  sessionId: ZoyaId;
  now: number;
  mood: ZoyaMoodState;
  recentMemoryIds: readonly ZoyaId[];
  activeBehavior: ZoyaBehaviorDecision | null;
}

/**
 * Hard boundary for the future learning system: learning can propose a
 * behavior, but it cannot directly mutate the renderer or skeleton.
 */
export interface ZoyaLearningProposal {
  experienceId: ZoyaId;
  behavior: ZoyaLearnedBehavior;
  confidenceDelta: number;
  requiresConfirmation: boolean;
}

export function clampZoya01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function normalizeZoyaMood(mood: ZoyaMoodState): ZoyaMoodState {
  return {
    ...mood,
    intensity: clampZoya01(mood.intensity),
    moodVector: Object.fromEntries(
      Object.entries(mood.moodVector).map(([key, value]) => [key, clampZoya01(value)]),
    ),
  };
}

/** Validate data crossing into the learning layer; no side effects. */
export function isValidLearningProposal(value: unknown): value is ZoyaLearningProposal {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ZoyaLearningProposal>;
  const behavior = candidate.behavior;
  if (!candidate.experienceId || !behavior || typeof behavior !== 'object') return false;
  return (
    typeof behavior.id === 'string' &&
    typeof behavior.trigger === 'string' &&
    typeof behavior.response === 'string' &&
    Number.isFinite(behavior.confidence) &&
    Number.isFinite(behavior.observations) &&
    typeof behavior.enabled === 'boolean'
  );
}
