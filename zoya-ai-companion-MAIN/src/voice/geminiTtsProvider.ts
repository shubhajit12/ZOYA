/**
 * Gemini TTS Provider
 *
 * Calls the Zoya server's `/api/tts` endpoint which proxies to
 * Google's Gemini TTS API.  All Gemini-specific code lives here;
 * the rest of the app only sees the generic TTSProvider interface.
 *
 * Quota: The Gemini free tier limits TTS to ~10 requests/day.
 * On HTTP 429 the provider activates a client-side cooldown so
 * repeated requests are suppressed without spamming Google.
 */

import { TTSProvider, TTSRequest, TTSResponse, TTSQuotaStatus } from './ttsProvider';

/** Default cooldown after a 429 (seconds). Server also returns its own cooldown. */
const DEFAULT_COOLDOWN_SEC = 60;

export class GeminiTTSProvider implements TTSProvider {
  readonly name = 'gemini';

  /** Timestamp (ms) until which quota is considered exhausted. */
  private quotaCooldownUntil = 0;

  /**
   * @param apiKeyOverride  Optional per-user Gemini API key from Settings.
   *                        Falls back to server env vars (GEMINI_TTS_API_KEY → GEMINI_API_KEY).
   * @param voiceName       Default voice preset.
   */
  constructor(
    private apiKeyOverride?: string,
    private voiceName: string = 'Leda',
  ) {}

  /* ------------------------------------------------------------------ */
  /*  TTSProvider interface                                              */
  /* ------------------------------------------------------------------ */

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const now = Date.now();
    if (now < this.quotaCooldownUntil) {
      const remaining = Math.ceil((this.quotaCooldownUntil - now) / 1000);
      const err: any = new Error(
        `Gemini TTS quota cooldown active (${remaining}s remaining). ` +
        `Text chat continues normally; voice is paused.`,
      );
      err.isQuotaExceeded = true;
      err.retryAfter = remaining;
      throw err;
    }

    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: request.text,
        voiceName: request.voiceName || this.voiceName,
        geminiApiKey: this.apiKeyOverride || undefined,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));

      if (response.status === 429 || body.isQuotaExceeded) {
        const cooldown = body.retryAfter || DEFAULT_COOLDOWN_SEC;
        this.quotaCooldownUntil = Date.now() + cooldown * 1000;
        const err: any = new Error(
          `Gemini TTS quota exceeded (HTTP 429): ${body.error || 'Rate limit'}. ` +
          `Pausing voice for ${cooldown}s.`,
        );
        err.isQuotaExceeded = true;
        err.retryAfter = cooldown;
        throw err;
      }

      const err: any = new Error(
        body.error || `Gemini TTS request failed (HTTP ${response.status})`,
      );
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const base64 = data.base64Audio || '';
    if (!base64 || base64.length < 50) {
      throw new Error('Gemini TTS returned empty or invalid audio data.');
    }

    return {
      base64Audio: base64,
      format: data.format || 'wav',
      model: data.model,
      endpoint: data.endpoint,
    };
  }

  getQuotaStatus(): TTSQuotaStatus {
    const now = Date.now();
    if (now < this.quotaCooldownUntil) {
      return {
        exceeded: true,
        cooldownRemainingSec: Math.ceil((this.quotaCooldownUntil - now) / 1000),
      };
    }
    return { exceeded: false, cooldownRemainingSec: 0 };
  }

  /* ------------------------------------------------------------------ */
  /*  Config helpers (called by voicePipeline when Settings change)      */
  /* ------------------------------------------------------------------ */

  setApiKey(apiKey?: string) {
    this.apiKeyOverride = apiKey;
  }

  setVoiceName(name: string) {
    this.voiceName = name;
  }
}
