/**
 * Fish Audio TTS Provider
 *
 * Zoya sends text to the server-side /api/tts proxy, which calls Fish Audio.
 * The Fish API key never needs to be exposed to the browser when configured
 * through FISH_API_KEY on the server. A per-user key can also be supplied.
 */

import { TTSProvider, TTSRequest, TTSResponse, TTSQuotaStatus } from './ttsProvider';

const DEFAULT_COOLDOWN_SEC = 60;

export class FishTTSProvider implements TTSProvider {
  readonly name = 'fish-audio';

  private apiKeyOverride?: string;
  private voiceReferenceId: string;
  private quotaCooldownUntil = 0;

  constructor(
    apiKeyOverride?: string,
    voiceReferenceId: string = 'cbe13152c7ff4da98be9a95d448a1f39',
  ) {
    this.apiKeyOverride = apiKeyOverride;
    this.voiceReferenceId = voiceReferenceId;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const now = Date.now();
    if (now < this.quotaCooldownUntil) {
      const remaining = Math.ceil((this.quotaCooldownUntil - now) / 1000);
      const err: any = new Error(
        `Fish Audio TTS rate-limit cooldown active (${remaining}s remaining).`,
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
        fishApiKey: this.apiKeyOverride || undefined,
        fishVoiceId: request.voiceName || this.voiceReferenceId,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));

      if (response.status === 429 || body.isQuotaExceeded) {
        const cooldown = body.retryAfter || DEFAULT_COOLDOWN_SEC;
        this.quotaCooldownUntil = Date.now() + cooldown * 1000;

        const err: any = new Error(
          `Fish Audio rate limit (HTTP 429): ${body.error || 'Rate limit'}`,
        );
        err.isQuotaExceeded = true;
        err.retryAfter = cooldown;
        throw err;
      }

      const err: any = new Error(
        body.error || `Fish Audio TTS request failed (HTTP ${response.status})`,
      );
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const base64 = data.base64Audio || '';

    if (!base64 || base64.length < 50) {
      throw new Error('Fish Audio returned empty or invalid audio data.');
    }

    return {
      base64Audio: base64,
      format: data.format || 'mp3',
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

  setApiKey(apiKey?: string) {
    this.apiKeyOverride = apiKey;
  }

  setVoiceReferenceId(referenceId: string) {
    this.voiceReferenceId = referenceId;
  }
}
