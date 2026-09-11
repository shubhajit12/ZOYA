import { VisemeFrame } from '../types';

export class AudioAnalyser {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private diagArray: Uint8Array | null = null;
  private isAnalyzing: boolean = false;
  private isUnlocked: boolean = false;

  constructor() {
    this.attachUnlockListeners();
  }

  private attachUnlockListeners() {
    if (typeof window === 'undefined') return;

    const unlock = async () => {
      try {
        const ctx = this.getAudioContext();
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        if (ctx.state === 'running') {
          this.isUnlocked = true;
          window.removeEventListener('click', unlock);
          window.removeEventListener('keydown', unlock);
          window.removeEventListener('touchstart', unlock);
          window.removeEventListener('mousedown', unlock);
        }
      } catch (e) {
        console.warn('[AudioAnalyser] Unlock attempt error:', e);
      }
    };

    window.addEventListener('click', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('mousedown', unlock, { passive: true });
  }

  public getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtx({ sampleRate: 24000 });
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public getAnalyser(): AnalyserNode {
    const ctx = this.getAudioContext();
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.5;
      this.analyser.connect(ctx.destination);
    }
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.isAnalyzing = true;
    return this.analyser;
  }

  public initialize(audioElement: HTMLAudioElement): void {
    try {
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const analyser = this.getAnalyser();

      // Only create media element source if not already connected
      const source = ctx.createMediaElementSource(audioElement);
      source.connect(analyser);
    } catch (e) {
      console.warn('[AudioAnalyser] Web Audio MediaElement connection note:', e);
    }
  }

  public getVisemeFrame(audioElement?: HTMLAudioElement): VisemeFrame {
    if (!this.analyser || !this.dataArray) {
      if (audioElement && !audioElement.paused && audioElement.duration > 0) {
        const time = audioElement.currentTime * 10;
        const synthOpen = Math.abs(Math.sin(time * 3)) * 0.7;
        const synthWide = Math.abs(Math.cos(time * 2)) * 0.4;
        return {
          mouthOpen: synthOpen,
          mouthWide: synthWide,
          mouthSmile: 0.2,
        };
      }
      return { mouthOpen: 0, mouthWide: 0, mouthSmile: 0 };
    }

    this.analyser.getByteFrequencyData(this.dataArray);

    let sum = 0;
    let lowFreqSum = 0;
    let midFreqSum = 0;

    const len = this.dataArray.length;
    for (let i = 0; i < len; i++) {
      const val = this.dataArray[i];
      sum += val;
      if (i < len * 0.3) lowFreqSum += val;
      else midFreqSum += val;
    }

    const lowAvg = lowFreqSum / (len * 0.3 || 1);
    const midAvg = midFreqSum / (len * 0.7 || 1);

    const mouthOpen = Math.min(1.0, (lowAvg / 180.0) * 1.2);
    const mouthWide = Math.min(1.0, (midAvg / 160.0) * 1.0);

    return {
      mouthOpen,
      mouthWide,
      mouthSmile: 0.2 + mouthWide * 0.3,
    };
  }

  public stop() {
    this.isAnalyzing = false;
  }

  /**
   * Lightweight DEV-diagnostic snapshot of the live analyser tap.
   * Reuses a cached scratch buffer (no per-call allocation) and never
   * disturbs the lip-sync read path.
   */
  public getSignalSnapshot(): {
    analyserReady: boolean;
    fftSize: number;
    binCount: number;
    peakByte: number;
    meanByte: number;
  } {
    if (!this.analyser) {
      return { analyserReady: false, fftSize: 0, binCount: 0, peakByte: 0, meanByte: 0 };
    }
    const bins = this.analyser.frequencyBinCount;
    if (!this.diagArray || this.diagArray.length !== bins) {
      this.diagArray = new Uint8Array(bins);
    }
    this.analyser.getByteFrequencyData(this.diagArray);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < bins; i++) {
      const v = this.diagArray[i];
      if (v > peak) peak = v;
      sum += v;
    }
    return {
      analyserReady: true,
      fftSize: this.analyser.fftSize,
      binCount: bins,
      peakByte: peak,
      meanByte: bins > 0 ? sum / bins : 0,
    };
  }
}

export const audioAnalyser = new AudioAnalyser();

