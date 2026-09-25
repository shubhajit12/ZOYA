export type EmotionType =
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

export interface MoodState {
  cheerful: number; // 0.0 - 1.0
  calm: number;     // 0.0 - 1.0
  thoughtful: number; // 0.0 - 1.0
  melancholic: number; // 0.0 - 1.0
  playful: number; // 0.0 - 1.0
  dominantMood: string;
}

export interface EmotionalState {
  currentEmotion: EmotionType;
  emotionIntensity: number; // 0.0 - 1.0
  previousEmotion: EmotionType;
  mood: MoodState;
  recentEvents: string[];
  moodTrend: 'improving' | 'stable' | 'declining';
}

export interface StructuredAiResponse {
  reply: string;
  emotion: EmotionType;
  emotionIntensity: number;
  mood: string;
  moodIntensity: number;
  gesture?: 'nod' | 'tilt_head' | 'wave' | 'think' | 'shrug' | 'smile_wide' | 'gasp' | 'bow' | 'none';
  voiceStyle?: string;
  memoryAction?: {
    action: 'remember' | 'forget' | 'none';
    content?: string;
  };
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'zoya';
  text: string;
  timestamp: number;
  emotion?: EmotionType;
  emotionIntensity?: number;
  audioUrl?: string;
  isStreaming?: boolean;
  error?: boolean;
}

export interface MemoryItem {
  id: string;
  content: string;
  category: 'preference' | 'fact' | 'interest' | 'personal' | 'general';
  timestamp: number;
  relevanceScore?: number;
}

export interface UserSettings {
  userName: string;
  groqApiKey: string; // optional override for Groq AI Brain
  geminiApiKey: string; // optional override for Gemini fallback brain
  fishApiKey: string; // optional override for Fish Audio TTS
  fishVoiceId: string; // Fish Audio voice reference ID
  volume: number; // 0 - 1
  speechSpeed: number; // 0.5 - 2.0
  language: string; // 'Auto' | 'English' | 'Spanish' | 'Japanese' | 'French' | 'German' | 'Hindi'
  alwaysOnTop: boolean;
  minimizedMode: boolean;
  /** Enables the Mate/desktop companion handoff from the title-bar minimize button. */
  mateDesktopCompanionEnabled: boolean;
  pcControlPermissions: boolean;
  screenShareAllowed: boolean;
  theme: 'dark' | 'light' | 'cyan_twilight' | 'soft_pink';
  hasCompletedOnboarding: boolean;
  /** Performance quality setting. 'auto' resolves to an effective tier at runtime. */
  performanceQuality: 'auto' | 'high' | 'medium' | 'low';
  minecraftIntegrationEnabled: boolean;
  minecraftServerAddress: string;
  minecraftServerPort: number;
  minecraftBotUsername: string;
  minecraftVersion: string;
}

export interface PcCommand {
  id: string;
  action: 'open_app' | 'system_volume' | 'system_status' | 'file_search' | 'screen_lock' | 'custom_shell';
  target?: string;
  parameters?: Record<string, any>;
  description: string;
  isDangerous: boolean;
}

export type AnimationIntent =
  | 'idle'
  | 'happy'
  | 'excited'
  | 'sad'
  | 'angry'
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

export interface VisemeFrame {
  mouthOpen: number; // 0.0 - 1.0
  mouthWide: number; // 0.0 - 1.0
  mouthSmile: number; // 0.0 - 1.0
}
