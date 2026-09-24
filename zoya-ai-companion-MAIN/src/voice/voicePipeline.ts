import { audioAnalyser } from './audioAnalyser';
import { FishTTSProvider } from './fishTtsProvider';
import { TTSProvider, TTSResponse } from './ttsProvider';

/**
 * VoicePipeline – Zoya's voice output controller.
 *
 * Responsibilities:
 *   1. Accumulate streaming brain text per user-turn.
 *   2. Dispatch exactly ONE TTS request when the brain stream ends.
 *   3. Decode & play the returned audio through Web Audio API
 *      (connected to audioAnalyser for lip-sync / viseme data).
 *   4. Expose speech-recognition (STT) for voice input.
 *
 * TTS is delegated to a pluggable TTSProvider.  The default implementation is FishTTSProvider.  Swap or add
 * providers by calling `setProvider()`.
 */
export class VoicePipeline {
  private currentAudio: HTMLAudioElement | null = null;
  private currentBufferSource: AudioBufferSourceNode | null = null;
  private isSpeaking: boolean = false;
  private isListening: boolean = false;
  private currentAbortController: AbortController | null = null;
  private recognition: any = null;

  // Single-turn TTS Session State
  private activeSessionId: number = 0;
  private accumulatedText: string = '';
  private t0: number = 0;
  private isGeneratingAudio: boolean = false;

  // ── TTS Provider (pluggable) ──────────────────────────────────
  private ttsProvider: TTSProvider;

  constructor() {
    // Default provider: Gemini TTS via the server proxy
    this.ttsProvider = new FishTTSProvider();
    this.initSpeechRecognition();
  }

  /* ────────────────────────────────────────────────────────────── */
  /*  Public API — Provider Management                             */
  /* ────────────────────────────────────────────────────────────── */

  /**
   * Swap the active TTS provider at runtime.
   * Call this when the user changes Settings.
   */
  public setProvider(provider: TTSProvider) {
    this.ttsProvider = provider;
  }

  /**
   * Get the current provider (e.g. to read quota status).
   */
  public getProvider(): TTSProvider {
    return this.ttsProvider;
  }

  /** Update Fish Audio provider settings in-place. */
  public configureFish(apiKey?: string, voiceReferenceId?: string) {
    if (this.ttsProvider instanceof FishTTSProvider) {
      if (apiKey !== undefined) this.ttsProvider.setApiKey(apiKey);
      if (voiceReferenceId !== undefined) this.ttsProvider.setVoiceReferenceId(voiceReferenceId);
    }
  }

  /* ────────────────────────────────────────────────────────────── */
  /*  Public API — Speech Control                                  */
  /* ────────────────────────────────────────────────────────────── */

  /**
   * Immediately interrupts current speech output, clearing audio
   * buffers and aborting pending TTS requests.
   */
  public interruptSpeech() {
    this.activeSessionId++;

    if (this.currentAbortController) {
      try {
        this.currentAbortController.abort();
      } catch (e) {}
      this.currentAbortController = null;
    }

    if (this.currentBufferSource) {
      try {
        this.currentBufferSource.stop();
        this.currentBufferSource.disconnect();
      } catch (e) {}
      this.currentBufferSource = null;
    }

    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio.src = '';
      } catch (e) {}
      this.currentAudio = null;
    }

    this.accumulatedText = '';
    this.isGeneratingAudio = false;
    this.isSpeaking = false;
    audioAnalyser.stop();
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  public getIsListening(): boolean {
    return this.isListening;
  }

  /**
   * Begin speech session for a new user turn.
   * Accumulates streaming text and dispatches ONE TTS request on completion.
   */
  public beginSpeechStream(t0?: number) {
    this.interruptSpeech();

    this.activeSessionId++;
    this.t0 = t0 || performance.now();
    this.accumulatedText = '';
    this.isGeneratingAudio = false;
  }

  /**
   * Push incoming text chunk from brain stream into accumulator.
   */
  public pushStreamChunk(chunk: string) {
    this.accumulatedText += chunk;
  }

  /**
   * Signal that brain stream has completed.
   * Triggers exactly ONE TTS generation request for the entire response.
   */
  public endSpeechStream(overrideFinalText?: string) {
    const textToSynthesize = (overrideFinalText || this.accumulatedText || '').trim();
    if (!textToSynthesize) return;

    this.generateAndPlayTTS(textToSynthesize, this.activeSessionId);
  }

  /**
   * Direct speak method for non-streaming or full-text responses.
   * Produces exactly ONE TTS request.
   */
  public async speak(text: string): Promise<void> {
    this.interruptSpeech();
    this.activeSessionId++;
    const sessionId = this.activeSessionId;
    this.t0 = performance.now();

    await this.generateAndPlayTTS(text, sessionId);
  }

  /* ────────────────────────────────────────────────────────────── */
  /*  Public API — Speech Recognition (STT)                        */
  /* ────────────────────────────────────────────────────────────── */

  public listen(onResult: (text: string) => void, onError: (err: string) => void): () => void {
    if (!this.recognition) {
      onError('Speech recognition not supported in this browser environment.');
      return () => {};
    }

    this.interruptSpeech();
    this.isListening = true;

    this.recognition.onresult = (event: any) => {
      this.isListening = false;
      const transcript = event.results[0][0].transcript;
      if (transcript) {
        onResult(transcript);
      }
    };

    this.recognition.onerror = (event: any) => {
      this.isListening = false;
      onError(`Speech recognition error: ${event.error || 'Unknown'}`);
    };

    this.recognition.onend = () => {
      this.isListening = false;
    };

    try {
      this.recognition.start();
    } catch (e) {
      this.isListening = false;
      onError('Could not start microphone listener.');
    }

    return () => {
      if (this.recognition && this.isListening) {
        try {
          this.recognition.stop();
        } catch (e) {}
      }
      this.isListening = false;
    };
  }

  /* ────────────────────────────────────────────────────────────── */
  /*  Private — TTS Generation & Playback                          */
  /* ────────────────────────────────────────────────────────────── */

  private initSpeechRecognition() {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US';
      }
    }
  }

  /**
   * Clean text before sending to TTS.
   */
  private sanitizeText(text: string): string {
    return text
      .replace(/[\{\}\[\]\*\_\\\#]/g, ' ')
      .replace(/https?\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Decodes base-64 WAV/PCM audio and plays it through the Web Audio
   * pipeline connected to audioAnalyser (for lip-sync viseme data).
   */
  private async decodeAndPlay(base64Audio: string, sessionId: number): Promise<void> {
    const binaryStr = atob(base64Audio);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const ctx = audioAnalyser.getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));

    if (this.activeSessionId !== sessionId) return;

    const tDecoded = performance.now();
    console.log(
      `[Zoya Voice] Audio decoded & ready for playback: +${(tDecoded - this.t0).toFixed(1)}ms ` +
      `(${audioBuffer.duration.toFixed(2)}s duration)`,
    );

    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(audioAnalyser.getAnalyser());

    this.currentBufferSource = sourceNode;
    this.isSpeaking = true;
    this.isGeneratingAudio = false;

    sourceNode.onended = () => {
      if (this.activeSessionId === sessionId) {
        this.currentBufferSource = null;
        this.isSpeaking = false;
        audioAnalyser.stop();
      }
    };

    sourceNode.start(0);
  }

  /**
   * Core method: generates audio via the TTS provider and plays it.
   * Enforces 1 response = 1 request.  Handles 429 gracefully
   * without failing the chat — text response is always unaffected.
   */
  private async generateAndPlayTTS(rawText: string, sessionId: number): Promise<void> {
    const cleanText = this.sanitizeText(rawText);
    if (!cleanText || cleanText.length < 2) return;

    // Guard: if TTS provider is in quota cooldown, skip silently
    const quota = this.ttsProvider.getQuotaStatus();
    if (quota.exceeded) {
      console.warn(
        `[TTS] ${this.ttsProvider.name} quota cooldown active ` +
        `(${quota.cooldownRemainingSec}s remaining). Skipping audio; text chat continues.`,
      );
      return;
    }

    if (this.activeSessionId !== sessionId) return;

    this.isGeneratingAudio = true;
    this.currentAbortController = new AbortController();

    const tStart = performance.now();
    console.log(
      `[Zoya Voice] Dispatching TTS request via ${this.ttsProvider.name} ` +
      `("${cleanText.slice(0, 40)}..."): +${(tStart - this.t0).toFixed(1)}ms`,
    );

    try {
      const result: TTSResponse = await this.ttsProvider.synthesize({
        text: cleanText,
      });

      if (this.activeSessionId !== sessionId) return;

      const tRecv = performance.now();
      console.log(
        `[Zoya Voice] TTS audio received: +${(tRecv - this.t0).toFixed(1)}ms ` +
        `(${result.model || this.ttsProvider.name})`,
      );

      await this.decodeAndPlay(result.base64Audio, sessionId);
    } catch (err: any) {
      if (err.name === 'AbortError' || this.activeSessionId !== sessionId) {
        console.log('[Zoya Voice] TTS request cancelled by new user turn/interrupt');
      } else if (err.isQuotaExceeded) {
        console.warn(`[TTS] ${this.ttsProvider.name}: ${err.message}`);
      } else {
        console.warn('[Zoya Voice] TTS processing error:', err.message || err);
      }
      this.isGeneratingAudio = false;
      this.isSpeaking = false;
    }
  }
}

export const voicePipeline = new VoicePipeline();
