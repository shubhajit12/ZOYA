import { EmotionType, StructuredAiResponse } from '../types';

export class GeminiClient {
  private defaultModel = 'gemini-3.7-flash';

  public getModelName(): string {
    return this.defaultModel;
  }

  /**
   * Send chat message to Gemini via server API with structured output & emotional analysis.
   */
  public async sendMessage(
    message: string,
    history: { sender: string; text: string }[],
    recentMemories: string[],
    currentMood: string,
    currentEmotion: string,
    screenFrameBase64?: string | null,
    apiKeyOverride?: string
  ): Promise<StructuredAiResponse> {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history,
        memories: recentMemories,
        currentMood,
        currentEmotion,
        screenFrame: screenFrameBase64,
        apiKey: apiKeyOverride || undefined,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Server returned HTTP ${response.status}`);
    }

    const data = await response.json();
    return this.parseStructuredResponse(data);
  }

  /**
   * Stream message response chunks from server via Server-Sent Events (SSE)
   */
  public async streamMessage(
    message: string,
    history: { sender: string; text: string }[],
    recentMemories: string[],
    currentMood: string,
    currentEmotion: string,
    onChunk: (chunkText: string) => void,
    onComplete: (finalStructured: StructuredAiResponse) => void,
    onError: (errMessage: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history,
          memories: recentMemories,
          currentMood,
          currentEmotion,
        }),
        signal,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Stream connection failed (HTTP ${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Response body stream is unreadable');

      const decoder = new TextDecoder();
      let fullTextAcc = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkStr = decoder.decode(value, { stream: true });
        const lines = chunkStr.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const rawData = line.substring(6).trim();
            if (rawData === '[DONE]') continue;
            try {
              const parsed = JSON.parse(rawData);
              if (parsed.delta) {
                fullTextAcc += parsed.delta;
                onChunk(parsed.delta);
              } else if (parsed.structured) {
                onComplete(this.parseStructuredResponse(parsed.structured));
                return;
              }
            } catch (e) {
              // Raw text chunk fallback
              fullTextAcc += rawData;
              onChunk(rawData);
            }
          }
        }
      }

      // If stream ended without explicit structured object, parse accumulated text
      const fallbackStructured = this.parseRawStringToStructured(fullTextAcc);
      onComplete(fallbackStructured);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Gemini request cancelled by user');
      } else {
        onError(err.message || 'Gemini connection error');
      }
    }
  }

  private parseStructuredResponse(data: any): StructuredAiResponse {
    const VALID_EMOTIONS: EmotionType[] = [
      'neutral', 'happy', 'excited', 'amused', 'curious', 'surprised',
      'sad', 'concerned', 'angry', 'embarrassed', 'shy', 'thoughtful',
      'confused', 'affectionate', 'playful'
    ];

    let emotion: EmotionType = 'neutral';
    if (data.emotion && VALID_EMOTIONS.includes(data.emotion.toLowerCase())) {
      emotion = data.emotion.toLowerCase() as EmotionType;
    }

    return {
      reply: typeof data.reply === 'string' ? data.reply : 'I am here with you.',
      emotion,
      emotionIntensity: typeof data.emotionIntensity === 'number' ? Math.min(Math.max(data.emotionIntensity, 0.1), 1.0) : 0.45,
      mood: typeof data.mood === 'string' ? data.mood : 'calm',
      moodIntensity: typeof data.moodIntensity === 'number' ? data.moodIntensity : 0.5,
      gesture: data.gesture || 'none',
      voiceStyle: data.voiceStyle || 'natural',
      memoryAction: data.memoryAction,
    };
  }

  private parseRawStringToStructured(rawText: string): StructuredAiResponse {
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.parseStructuredResponse(parsed);
      }
    } catch (e) {}

    return {
      reply: rawText.replace(/```json[\s\S]*?```/g, '').trim() || 'I understand.',
      emotion: 'neutral',
      emotionIntensity: 0.35,
      mood: 'calm',
      moodIntensity: 0.5,
      gesture: 'nod',
    };
  }
}

export const geminiClient = new GeminiClient();
