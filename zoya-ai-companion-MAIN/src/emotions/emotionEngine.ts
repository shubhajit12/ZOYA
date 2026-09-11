import { EmotionType, EmotionalState, MoodState } from '../types';

export const VALID_EMOTIONS: EmotionType[] = [
  'neutral',
  'happy',
  'excited',
  'amused',
  'curious',
  'surprised',
  'sad',
  'concerned',
  'angry',
  'embarrassed',
  'shy',
  'thoughtful',
  'confused',
  'affectionate',
  'playful',
];

const INITIAL_MOOD: MoodState = {
  cheerful: 0.65,
  calm: 0.7,
  thoughtful: 0.4,
  melancholic: 0.1,
  playful: 0.55,
  dominantMood: 'cheerful',
};

const BASELINE_MOOD: MoodState = {
  cheerful: 0.55,
  calm: 0.65,
  thoughtful: 0.35,
  melancholic: 0.1,
  playful: 0.45,
  dominantMood: 'cheerful',
};

export interface EmotionMeta {
  label: string;
  emoji: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  accentColor: string;
}

export function getEmotionMeta(emotion: EmotionType): EmotionMeta {
  switch (emotion) {
    case 'happy':
      return {
        label: 'Happy',
        emoji: '😊',
        badgeBg: 'bg-emerald-950/40',
        badgeBorder: 'border-emerald-500/40',
        badgeText: 'text-emerald-300',
        accentColor: '#34d399',
      };
    case 'excited':
      return {
        label: 'Excited',
        emoji: '✨',
        badgeBg: 'bg-amber-950/40',
        badgeBorder: 'border-amber-500/40',
        badgeText: 'text-amber-300',
        accentColor: '#fbbf24',
      };
    case 'amused':
      return {
        label: 'Amused',
        emoji: '😄',
        badgeBg: 'bg-yellow-950/40',
        badgeBorder: 'border-yellow-500/40',
        badgeText: 'text-yellow-300',
        accentColor: '#facc15',
      };
    case 'playful':
      return {
        label: 'Playful',
        emoji: '😜',
        badgeBg: 'bg-teal-950/40',
        badgeBorder: 'border-teal-500/40',
        badgeText: 'text-teal-300',
        accentColor: '#2dd4bf',
      };
    case 'affectionate':
      return {
        label: 'Affectionate',
        emoji: '🧡',
        badgeBg: 'bg-rose-950/40',
        badgeBorder: 'border-rose-500/40',
        badgeText: 'text-rose-300',
        accentColor: '#fb7185',
      };
    case 'shy':
      return {
        label: 'Shy',
        emoji: '🌸',
        badgeBg: 'bg-pink-950/40',
        badgeBorder: 'border-pink-500/40',
        badgeText: 'text-pink-300',
        accentColor: '#f472b6',
      };
    case 'embarrassed':
      return {
        label: 'Embarrassed',
        emoji: '😳',
        badgeBg: 'bg-rose-950/40',
        badgeBorder: 'border-rose-500/40',
        badgeText: 'text-rose-300',
        accentColor: '#f43f5e',
      };
    case 'curious':
      return {
        label: 'Curious',
        emoji: '🧐',
        badgeBg: 'bg-sky-950/40',
        badgeBorder: 'border-sky-500/40',
        badgeText: 'text-sky-300',
        accentColor: '#38bdf8',
      };
    case 'thoughtful':
      return {
        label: 'Thoughtful',
        emoji: '💭',
        badgeBg: 'bg-indigo-950/40',
        badgeBorder: 'border-indigo-500/40',
        badgeText: 'text-indigo-300',
        accentColor: '#818cf8',
      };
    case 'surprised':
      return {
        label: 'Surprised',
        emoji: '😲',
        badgeBg: 'bg-purple-950/40',
        badgeBorder: 'border-purple-500/40',
        badgeText: 'text-purple-300',
        accentColor: '#c084fc',
      };
    case 'concerned':
      return {
        label: 'Concerned',
        emoji: '🥺',
        badgeBg: 'bg-cyan-950/40',
        badgeBorder: 'border-cyan-500/40',
        badgeText: 'text-cyan-300',
        accentColor: '#22d3ee',
      };
    case 'sad':
      return {
        label: 'Melancholy',
        emoji: '🌧️',
        badgeBg: 'bg-blue-950/40',
        badgeBorder: 'border-blue-500/40',
        badgeText: 'text-blue-300',
        accentColor: '#60a5fa',
      };
    case 'angry':
      return {
        label: 'Irritated',
        emoji: '🔥',
        badgeBg: 'bg-red-950/40',
        badgeBorder: 'border-red-500/40',
        badgeText: 'text-red-300',
        accentColor: '#f87171',
      };
    case 'confused':
      return {
        label: 'Confused',
        emoji: '🤔',
        badgeBg: 'bg-amber-950/40',
        badgeBorder: 'border-amber-500/40',
        badgeText: 'text-amber-300',
        accentColor: '#fbbf24',
      };
    case 'neutral':
    default:
      return {
        label: 'Calm',
        emoji: '🌿',
        badgeBg: 'bg-slate-900/60',
        badgeBorder: 'border-slate-700/50',
        badgeText: 'text-slate-300',
        accentColor: '#94a3b8',
      };
  }
}

export class EmotionEngine {
  private state: EmotionalState;
  private storageKey = 'zoya_emotional_state_v1';

  constructor() {
    this.state = this.loadState();
  }

  public sanitizeEmotion(raw: any): EmotionType {
    if (typeof raw === 'string') {
      const lower = raw.trim().toLowerCase() as EmotionType;
      if (VALID_EMOTIONS.includes(lower)) {
        return lower;
      }
      // Common aliases
      if (lower === ('joy' as any) || lower === ('cheerful' as any) || lower === ('smile' as any)) return 'happy';
      if (lower === ('love' as any) || lower === ('loving' as any) || lower === ('warm' as any)) return 'affectionate';
      if (lower === ('blush' as any) || lower === ('flustered' as any)) return 'shy';
      if (lower === ('sorrow' as any) || lower === ('unhappy' as any) || lower === ('depressed' as any)) return 'sad';
      if (lower === ('worried' as any) || lower === ('empathetic' as any)) return 'concerned';
      if (lower === ('mad' as any) || lower === ('irritated' as any) || lower === ('frustrated' as any)) return 'angry';
      if (lower === ('shocked' as any) || lower === ('amazed' as any) || lower === ('astonished' as any)) return 'surprised';
      if (lower === ('thinking' as any) || lower === ('pondering' as any) || lower === ('reflective' as any)) return 'thoughtful';
      if (lower === ('laughing' as any) || lower === ('funny' as any)) return 'amused';
      if (lower === ('inquisitive' as any) || lower === ('interested' as any)) return 'curious';
      if (lower === ('puzzled' as any)) return 'confused';
    }
    return 'neutral';
  }

  private loadState(): EmotionalState {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          currentEmotion: this.sanitizeEmotion(parsed.currentEmotion),
          emotionIntensity: typeof parsed.emotionIntensity === 'number' ? Math.min(Math.max(parsed.emotionIntensity, 0.2), 1.0) : 0.45,
          previousEmotion: this.sanitizeEmotion(parsed.previousEmotion),
          mood: parsed.mood || { ...INITIAL_MOOD },
          recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents.slice(-6) : [],
          moodTrend: parsed.moodTrend || 'stable',
        };
      }
    } catch (err) {
      console.warn('Could not load emotion state from storage:', err);
    }

    return {
      currentEmotion: 'happy',
      emotionIntensity: 0.5,
      previousEmotion: 'neutral',
      mood: { ...INITIAL_MOOD },
      recentEvents: ['Initialized Zoya companion session'],
      moodTrend: 'stable',
    };
  }

  private saveState() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch (err) {
      console.warn('Failed to save emotion state:', err);
    }
  }

  public getState(): EmotionalState {
    return { ...this.state, mood: { ...this.state.mood } };
  }

  /**
   * Records a user interaction event without resetting Zoya's current emotion.
   */
  public recordUserEvent(eventDescription: string): EmotionalState {
    if (eventDescription) {
      this.state.recentEvents.push(eventDescription);
      if (this.state.recentEvents.length > 6) {
        this.state.recentEvents.shift();
      }
      this.saveState();
    }
    return this.getState();
  }

  /**
   * Process an incoming emotion event from AI Brain or user interaction.
   * Applies emotional inertia, smoothing, and gradual mood updating.
   */
  public updateEmotion(rawEmotion: any, rawIntensity: number = 0.5, eventDescription?: string): EmotionalState {
    const targetEmotion = this.sanitizeEmotion(rawEmotion);
    const clampedIntensity = Math.min(Math.max(rawIntensity || 0.45, 0.2), 0.95);
    const prevEmotion = this.state.currentEmotion;
    const currentMood = this.state.mood;

    // Rule: Mood inertia prevents erratic flip-flopping.
    // If Zoya is in high cheerful mood and gets a mild "sad" trigger, buffer through "concerned".
    let smoothedEmotion = targetEmotion;
    if (currentMood.cheerful > 0.6 && targetEmotion === 'sad' && clampedIntensity < 0.65) {
      smoothedEmotion = 'concerned';
    } else if (currentMood.melancholic > 0.5 && targetEmotion === 'excited' && clampedIntensity < 0.7) {
      smoothedEmotion = 'happy'; // transition through happy first
    }

    // Continuity: If the target is neutral, gently decay existing emotion intensity rather than snapping
    if (smoothedEmotion === 'neutral' && prevEmotion !== 'neutral' && this.state.emotionIntensity > 0.35) {
      this.state.emotionIntensity = Math.max(0.25, this.state.emotionIntensity * 0.75);
      // Keep previous emotion until it naturally decays
      if (this.state.emotionIntensity > 0.3) {
        smoothedEmotion = prevEmotion;
      }
    } else {
      // Calculate weighted target intensity
      if (smoothedEmotion === prevEmotion) {
        // Reinforcing the same emotion increases its depth smoothly
        this.state.emotionIntensity = Math.min(0.95, this.state.emotionIntensity * 0.4 + clampedIntensity * 0.6 + 0.05);
      } else {
        this.state.previousEmotion = prevEmotion;
        this.state.currentEmotion = smoothedEmotion;
        this.state.emotionIntensity = (this.state.emotionIntensity * 0.25) + (clampedIntensity * 0.75);
      }
    }

    // Apply incremental mood influence (small events -> small mood shifts)
    const shiftFactor = clampedIntensity * 0.14;

    switch (smoothedEmotion) {
      case 'happy':
      case 'amused':
      case 'playful':
        currentMood.cheerful = Math.min(1.0, currentMood.cheerful + shiftFactor);
        currentMood.playful = Math.min(1.0, currentMood.playful + (shiftFactor * 0.8));
        currentMood.melancholic = Math.max(0.0, currentMood.melancholic - shiftFactor);
        break;
      case 'excited':
        currentMood.cheerful = Math.min(1.0, currentMood.cheerful + (shiftFactor * 1.3));
        currentMood.playful = Math.min(1.0, currentMood.playful + shiftFactor);
        currentMood.calm = Math.max(0.2, currentMood.calm - (shiftFactor * 0.3));
        break;
      case 'affectionate':
      case 'shy':
      case 'embarrassed':
        currentMood.cheerful = Math.min(1.0, currentMood.cheerful + (shiftFactor * 0.8));
        currentMood.thoughtful = Math.min(1.0, currentMood.thoughtful + (shiftFactor * 0.5));
        currentMood.calm = Math.min(1.0, currentMood.calm + (shiftFactor * 0.4));
        break;
      case 'thoughtful':
      case 'curious':
        currentMood.thoughtful = Math.min(1.0, currentMood.thoughtful + shiftFactor);
        currentMood.calm = Math.min(1.0, currentMood.calm + (shiftFactor * 0.5));
        break;
      case 'sad':
      case 'concerned':
        currentMood.melancholic = Math.min(1.0, currentMood.melancholic + shiftFactor);
        currentMood.cheerful = Math.max(0.1, currentMood.cheerful - shiftFactor);
        break;
      case 'angry':
        currentMood.calm = Math.max(0.1, currentMood.calm - (shiftFactor * 1.5));
        currentMood.cheerful = Math.max(0.1, currentMood.cheerful - shiftFactor);
        break;
      default:
        // Neutral reactions slowly decay toward dominant baseline
        this.decayMoodTowardBaseline(0.04);
        break;
    }

    // Determine dominant mood
    this.recalculateDominantMood();

    // Track recent events log
    if (eventDescription) {
      this.state.recentEvents.push(eventDescription);
      if (this.state.recentEvents.length > 6) {
        this.state.recentEvents.shift();
      }
    }

    this.saveState();
    return this.getState();
  }

  /**
   * Passive decay toward baseline mood when idling or standard conversation happens.
   */
  public decayMoodTowardBaseline(rate: number = 0.05) {
    const mood = this.state.mood;
    mood.cheerful += (BASELINE_MOOD.cheerful - mood.cheerful) * rate;
    mood.calm += (BASELINE_MOOD.calm - mood.calm) * rate;
    mood.thoughtful += (BASELINE_MOOD.thoughtful - mood.thoughtful) * rate;
    mood.melancholic += (BASELINE_MOOD.melancholic - mood.melancholic) * rate;
    mood.playful += (BASELINE_MOOD.playful - mood.playful) * rate;

    this.recalculateDominantMood();
    this.saveState();
  }

  private recalculateDominantMood() {
    const mood = this.state.mood;
    const moods = [
      { name: 'cheerful', val: mood.cheerful },
      { name: 'calm', val: mood.calm },
      { name: 'thoughtful', val: mood.thoughtful },
      { name: 'playful', val: mood.playful },
      { name: 'melancholic', val: mood.melancholic },
    ];
    moods.sort((a, b) => b.val - a.val);
    mood.dominantMood = moods[0].name;
  }

  public resetEmotion() {
    this.state = {
      currentEmotion: 'happy',
      emotionIntensity: 0.5,
      previousEmotion: 'neutral',
      mood: { ...INITIAL_MOOD },
      recentEvents: ['Reset emotion state'],
      moodTrend: 'stable',
    };
    this.saveState();
  }
}

export const emotionEngine = new EmotionEngine();

