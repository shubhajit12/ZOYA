import { EmotionType, AnimationIntent, StructuredAiResponse } from '../types';

const API_BASE = import.meta.env.PROD ? 'http://127.0.0.1:3000' : '';

export class GroqClient {
  /**
   * Send chat message to Groq AI Brain via server API with structured output & emotional analysis.
   */
  public async sendMessage(
    message: string,
    history: { sender: string; text: string }[],
    recentMemories: string[],
    currentMood: string,
    currentEmotion: string,
    groqApiKeyOverride?: string,
    geminiApiKeyOverride?: string
  ): Promise<StructuredAiResponse> {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history,
        memories: recentMemories,
        currentMood,
        currentEmotion,
        groqApiKey: groqApiKeyOverride || undefined,
        apiKey: geminiApiKeyOverride || undefined,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Groq AI Brain error (HTTP ${response.status})`);
    }

    const data = await response.json();
    return this.parseStructuredResponse(data);
  }

  /**
   * Stream response from Groq AI Brain via Server-Sent Events (SSE)
   */
  public async streamMessage(
    message: string,
    history: { sender: string; text: string }[],
    recentMemories: string[],
    currentMood: string,
    currentEmotion: string,
    onChunk: (chunkText: string) => void,
    onComplete: (fullText: string, inferredEmotion: { emotion: EmotionType; intensity: number; gesture: any; animation: AnimationIntent }) => void,
    onError: (errMessage: string) => void,
    groqApiKeyOverride?: string,
    geminiApiKeyOverride?: string,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history,
          memories: recentMemories,
          currentMood,
          currentEmotion,
          groqApiKey: groqApiKeyOverride || undefined,
          apiKey: geminiApiKeyOverride || undefined,
        }),
        signal,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Stream connection error (HTTP ${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Response stream body is unreadable');

      const decoder = new TextDecoder();
      let fullTextAcc = '';
      let lineBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const rawData = trimmed.slice(5).trim();
          if (rawData === '[DONE]') continue;

          try {
            const parsed = JSON.parse(rawData);
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.delta) {
              fullTextAcc += parsed.delta;
              onChunk(parsed.delta);
            }
          } catch (e: any) {
            if (e.message && !e.message.includes('JSON')) {
              throw e;
            }
          }
        }
      }

      if (lineBuffer.trim().startsWith('data:')) {
        const rawData = lineBuffer.trim().slice(5).trim();
        if (rawData !== '[DONE]') {
          try {
            const parsed = JSON.parse(rawData);
            if (parsed.delta) {
              fullTextAcc += parsed.delta;
              onChunk(parsed.delta);
            }
          } catch (e) {}
        }
      }

      // Infer rich emotional context combining user input, Zoya response, and current mood
      const inferred = this.inferEmotionFromContext(message, fullTextAcc, currentEmotion as EmotionType, currentMood);
      onComplete(fullTextAcc, inferred);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[GroqClient] Stream aborted by user');
      } else {
        onError(err.message || 'Groq connection error');
      }
    }
  }

  public parseStructuredResponse(data: any): StructuredAiResponse {
    const VALID_EMOTIONS: EmotionType[] = [
      'neutral', 'happy', 'excited', 'amused', 'curious', 'surprised',
      'sad', 'concerned', 'angry', 'embarrassed', 'shy', 'thoughtful',
      'confused', 'affectionate', 'playful'
    ];

    let emotion: EmotionType = 'happy';
    if (data.emotion && VALID_EMOTIONS.includes(data.emotion.toLowerCase())) {
      emotion = data.emotion.toLowerCase() as EmotionType;
    }

    return {
      reply: typeof data.reply === 'string' ? data.reply : (data.text || 'I am right here with you.'),
      emotion,
      emotionIntensity: typeof data.emotionIntensity === 'number' ? Math.min(Math.max(data.emotionIntensity, 0.2), 1.0) : 0.55,
      mood: typeof data.mood === 'string' ? data.mood : 'cheerful',
      moodIntensity: typeof data.moodIntensity === 'number' ? data.moodIntensity : 0.6,
      gesture: data.gesture || 'smile_wide',
      voiceStyle: data.voiceStyle || 'natural',
    };
  }

  /**
   * Deep Context-Aware Emotion Inference
   * Accurately decodes emotional intent from dialogue patterns, compliments, humor, sadness, praise, affection, and inquiries.
   */
  public inferEmotionFromContext(
    userText: string,
    zoyaReply: string,
    currentEmotion: EmotionType,
    currentMood: string
  ): { emotion: EmotionType; intensity: number; gesture: any; animation: AnimationIntent } {
    const userLow = (userText || '').toLowerCase();
    const zoyaLow = (zoyaReply || '').toLowerCase();
    const combined = `${userLow} | ${zoyaLow}`;

    // 1. Affection, Love, Flattery, Sweet Compliments
    if (
      userLow.includes('love you') ||
      userLow.includes('cute') ||
      userLow.includes('pretty') ||
      userLow.includes('beautiful') ||
      userLow.includes('marry me') ||
      userLow.includes('you are the best') ||
      userLow.includes('i like you') ||
      userLow.includes('miss you') ||
      zoyaLow.includes('warm') ||
      zoyaLow.includes('heart') ||
      zoyaLow.includes('mean so much') ||
      zoyaLow.includes('blush') ||
      zoyaLow.includes('flattered')
    ) {
      if (userLow.includes('cute') || userLow.includes('blush') || userLow.includes('pretty')) {
        return { emotion: 'shy', intensity: 0.8, gesture: 'tilt_head', animation: 'shy' };
      }
      return { emotion: 'affectionate', intensity: 0.85, gesture: 'smile_wide', animation: 'happy' };
    }

    // 2. High Excitement, Wins, Celebrations, High Energy
    if (
      userLow.includes('i did it') ||
      userLow.includes('passed') ||
      userLow.includes('won') ||
      userLow.includes('congrats') ||
      userLow.includes('yay') ||
      userLow.includes('awesome') ||
      userLow.includes('lets go') ||
      userLow.includes('hyped') ||
      zoyaLow.includes('congratulations') ||
      zoyaLow.includes('incredible') ||
      zoyaLow.includes('so proud') ||
      zoyaLow.includes('amazing news') ||
      zoyaLow.includes('woohoo')
    ) {
      return { emotion: 'excited', intensity: 0.85, gesture: 'wave', animation: 'excited' };
    }

    // 3. Humor, Laughter, Teasing, Banter
    if (
      userLow.includes('haha') ||
      userLow.includes('lol') ||
      userLow.includes('lmao') ||
      userLow.includes('funny') ||
      userLow.includes('joke') ||
      zoyaLow.includes('haha') ||
      zoyaLow.includes('hehe') ||
      zoyaLow.includes('chuckle') ||
      zoyaLow.includes('giggle') ||
      zoyaLow.includes('made me laugh')
    ) {
      return { emotion: 'amused', intensity: 0.75, gesture: 'smile_wide', animation: 'laughing' };
    }

    // 4. Sadness, Grief, Burnout, Vulnerability
    if (
      userLow.includes('sad') ||
      userLow.includes('crying') ||
      userLow.includes('cry') ||
      userLow.includes('depressed') ||
      userLow.includes('lonely') ||
      userLow.includes('bad day') ||
      userLow.includes('terrible day') ||
      userLow.includes('failed') ||
      userLow.includes('breakup') ||
      userLow.includes('hurt') ||
      zoyaLow.includes('i am so sorry') ||
      zoyaLow.includes('here for you') ||
      zoyaLow.includes('it is okay to feel') ||
      zoyaLow.includes('virtual hug')
    ) {
      return { emotion: 'concerned', intensity: 0.75, gesture: 'tilt_head', animation: 'sad' };
    }

    // 5. Surprise, Shock, Disbelief
    if (
      userLow.includes('what?!') ||
      userLow.includes('no way') ||
      userLow.includes('seriously?') ||
      userLow.includes('unbelievable') ||
      zoyaLow.includes('whoa') ||
      zoyaLow.includes('wait, really?') ||
      zoyaLow.includes('are you serious?') ||
      zoyaLow.includes('surprising')
    ) {
      return { emotion: 'surprised', intensity: 0.8, gesture: 'gasp', animation: 'surprised' };
    }

    // 6. Deep Inquiry, Philosophy, Thinking, Coding, Complex Questions
    if (
      userLow.includes('how does') ||
      userLow.includes('why do') ||
      userLow.includes('explain') ||
      userLow.includes('what is the meaning') ||
      userLow.includes('theory') ||
      userLow.includes('philosophy') ||
      zoyaLow.includes('fascinating') ||
      zoyaLow.includes('let us think') ||
      zoyaLow.includes('consider') ||
      zoyaLow.includes('perspective')
    ) {
      return { emotion: 'thoughtful', intensity: 0.65, gesture: 'think', animation: 'thinking' };
    }

    // 7. Curiosity & Learning
    if (
      userLow.includes('tell me about') ||
      userLow.includes('what about') ||
      userLow.includes('curious') ||
      zoyaLow.includes('curious') ||
      zoyaLow.includes('interesting')
    ) {
      return { emotion: 'curious', intensity: 0.65, gesture: 'tilt_head', animation: 'thinking' };
    }

    // 8. Greetings
    if (
      userLow.includes('good morning') ||
      userLow.includes('good evening') ||
      userLow.includes('hello') ||
      userLow.includes('hey') ||
      userLow.includes('hi zoya')
    ) {
      return { emotion: 'happy', intensity: 0.6, gesture: 'nod', animation: 'greeting' };
    }

    // 9. Thanks / Warm conversation
    if (
      userLow.includes('thanks') ||
      userLow.includes('thank you') ||
      zoyaLow.includes('happy to help') ||
      zoyaLow.includes('great to see you') ||
      zoyaLow.includes('glad') ||
      zoyaLow.includes('wonderful')
    ) {
      return { emotion: 'happy', intensity: 0.6, gesture: 'nod', animation: 'happy' };
    }

    // 10. Goodbyes
    if (userLow.includes('bye') || userLow.includes('goodnight') || userLow.includes('sleep well') || userLow.includes('see you tomorrow')) {
      return { emotion: 'affectionate', intensity: 0.6, gesture: 'wave', animation: 'goodbye' };
    }

    // 11. Continuity Default
    if (currentEmotion && currentEmotion !== 'neutral') {
      return { emotion: currentEmotion, intensity: 0.5, gesture: 'nod', animation: 'idle' };
    }

    return { emotion: 'happy', intensity: 0.5, gesture: 'nod', animation: 'idle' };
  }

  public inferEmotionFromText(text: string): { emotion: EmotionType; intensity: number; gesture: any; animation: AnimationIntent } {
    return this.inferEmotionFromContext('', text, 'happy', 'cheerful');
  }
}

export const groqClient = new GroqClient();

