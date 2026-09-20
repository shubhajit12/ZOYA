/**
 * TTS Provider Abstraction
 *
 * Defines a common interface so Zoya can swap TTS backends
 * (Fish Audio, local models, etc.) without touching
 * the voice pipeline, UI, or emotion/animation code.
 *
 * Architecture:
 *   User → Groq (brain) → Zoya text response → TTS Provider → Audio → Mint speaks
 */

export interface TTSRequest {
  /** The text to synthesize. Already sanitized by the caller. */
  text: string;
  /** Provider-specific voice reference ID. */
  voiceName?: string;
}

export interface TTSResponse {
  /** Base-64 encoded audio payload. */
  base64Audio: string;
  /** Audio format hint ('wav', 'mp3', etc.). */
  format: string;
  /** Model identifier that served this request (for logging). */
  model?: string;
  /** Human-readable endpoint description (for logging). */
  endpoint?: string;
}

export type TTSQuotaStatus = {
  /** Whether the quota is currently exhausted. */
  exceeded: boolean;
  /** Seconds until the cooldown expires (0 if not in cooldown). */
  cooldownRemainingSec: number;
};

export interface TTSProvider {
  /** Short name for logging (e.g. 'fish-audio'). */
  readonly name: string;

  /**
   * Synthesize speech from text.
   * Returns a TTSResponse on success.
   * Throws with a structured error on failure.
   */
  synthesize(request: TTSRequest): Promise<TTSResponse>;

  /** Check whether this provider is currently in a quota cooldown. */
  getQuotaStatus(): TTSQuotaStatus;
}
