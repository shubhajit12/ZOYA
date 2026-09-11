import React, { useEffect, useRef, useState } from 'react';
import { EmotionType, AnimationIntent } from '../types';
import { MintRenderer } from './mintRenderer';
import {
  QUALITY_PROFILES,
  isValidQualitySetting,
  resolveEffectiveQuality,
  type PerformanceQualitySetting,
} from './performanceQuality';
import { getEmotionMeta } from '../emotions/emotionEngine';
import { Upload, Sparkles, Eye } from 'lucide-react';

interface MintCanvasProps {
  currentEmotion: EmotionType;
  emotionIntensity: number;
  dominantMood: string;
  isSpeaking: boolean;
  animationIntent?: AnimationIntent;
  performanceQuality?: PerformanceQualitySetting;
  onFbxLoaded?: (fileName: string) => void;
}

export const MintCanvas: React.FC<MintCanvasProps> = ({
  currentEmotion,
  emotionIntensity,
  dominantMood,
  isSpeaking,
  animationIntent,
  performanceQuality: qualitySetting = 'auto',
  onFbxLoaded,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MintRenderer | null>(null);
  const [isWebglAvailable, setIsWebglAvailable] = useState<boolean>(true);
  const [modelName, setModelName] = useState<string>('Loading Mint...');
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [isLoadingFbx, setIsLoadingFbx] = useState<boolean>(false);
  // Temporary DEV-only animation test control (optimistic active label).
  const [animTestState, setAnimTestState] = useState<string>('idle');
  const [animEmotion, setAnimEmotion] = useState<string>('Calm');
  const [animExpr, setAnimExpr] = useState<string>('');
  const [animGesture, setAnimGesture] = useState<string>('');
  // DEV-only perf readout text (2Hz refresh, stripped from prod builds).
  const [perfText, setPerfText] = useState<string>('');
  // Dynamic safe-expression scan list (refreshed from the runtime inventory
  // once the VRM is live; falls back to the five verified presets).
  const [safeExprList, setSafeExprList] = useState<string[]>([
    'neutral',
    'happy',
    'angry',
    'sad',
    'relaxed',
  ]);
  // Temporary DEV-only recipe tester sliders (local only until Apply).
  const [recipeWeights, setRecipeWeights] = useState<Record<string, number>>({
    happy: 0.7,
    relaxed: 0.2,
    angry: 0,
    sad: 0,
    neutral: 0,
  });
  // Tracks the quality setting already applied by the mount effect so the
  // change-handler below skips its first run.
  const appliedQualityRef = useRef<PerformanceQualitySetting>(qualitySetting);
  // Explicitly typed copy: parameter-destructured defaults can widen to
  // `string` inside closures; the predicate re-narrows and also guards
  // against corrupted stored values.
  const activeQualitySetting: PerformanceQualitySetting = isValidQualitySetting(qualitySetting)
    ? qualitySetting
    : 'auto';
  const modelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startModelPoll = () => {
    if (modelPollRef.current) clearInterval(modelPollRef.current);
    let scanRefreshAttempts = 0;
    modelPollRef.current = setInterval(() => {
      if (rendererRef.current) {
        if (rendererRef.current.getIsVrmLoaded()) {
          setModelName('Carlotta (VRM)');
          // Refresh the dynamic safe-expression scan list once the VRM
          // (and its DEV hooks) are live. Falls back to the known five.
          // Hooks register during VRM init, possibly after the loaded flag,
          // so retry a few times; always stop polling eventually.
          let refreshed = false;
          try {
            const safe = window.__carlottaExpressionScanInfo?.()?.safe;
            if (Array.isArray(safe) && safe.length > 0) {
              setSafeExprList((prev) => (prev.join(',') === safe.join(',') ? prev : [...safe]));
              refreshed = true;
            }
          } catch {
            /* hooks unavailable: keep fallback list */
          }
          scanRefreshAttempts++;
          if (refreshed || scanRefreshAttempts >= 20) {
            if (modelPollRef.current) clearInterval(modelPollRef.current);
          }
        } else if (rendererRef.current.getIsFbxLoaded()) {
          setModelName('Mint (Neverness to Everness)');
          if (modelPollRef.current) clearInterval(modelPollRef.current);
        } else {
          setModelName(rendererRef.current.getActiveAvatarType());
        }
      }
    }, 500);
  };

  const emotionMeta = getEmotionMeta(currentEmotion);

  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new MintRenderer();
    rendererRef.current = renderer;
    const mountedSuccessfully = renderer.mount(containerRef.current, activeQualitySetting);

    if (!mountedSuccessfully) {
      setIsWebglAvailable(false);
    }

    // After mount, the renderer auto-loads Carlotta (VRM) with Mint as fallback.
    // Poll to update the label.
    startModelPoll();

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (containerRef.current && rendererRef.current) {
          rendererRef.current.resize(
            containerRef.current.clientWidth,
            containerRef.current.clientHeight
          );
        }
      }, 100);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (modelPollRef.current) clearInterval(modelPollRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.unmount();
    };
  }, []);

  // React to Settings → Performance → Quality changes after mount.
  // Pixel ratio + shadows apply live. Antialiasing is fixed at renderer
  // creation, so an antialias change recreates the renderer (model reloads).
  useEffect(() => {
    if (appliedQualityRef.current === activeQualitySetting) return;
    appliedQualityRef.current = activeQualitySetting;
    const current = rendererRef.current;
    if (!current || !containerRef.current) return;

    const effective = resolveEffectiveQuality(activeQualitySetting);
    const profile = QUALITY_PROFILES[effective];
    if (current.getAppliedAntialias() === profile.antialias) {
      current.applyRenderQuality(profile, effective);
      return;
    }
    current.unmount();
    const fresh = new MintRenderer();
    rendererRef.current = fresh;
    if (!fresh.mount(containerRef.current, activeQualitySetting)) {
      setIsWebglAvailable(false);
      return;
    }
    setModelName('Loading Mint...');
    startModelPoll();
  }, [activeQualitySetting]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setEmotion(currentEmotion, emotionIntensity);
    }
  }, [currentEmotion, emotionIntensity]);

  useEffect(() => {
    if (rendererRef.current && animationIntent) {
      rendererRef.current.setAnimationIntent(animationIntent);
    }
  }, [animationIntent]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setSpeaking(isSpeaking);
    }
  }, [isSpeaking]);

  // DEV-only performance readout (FPS, JS frame ms, renderer.info, buffer, split timing, scheduling).
  // CPU frame time is measured JS cost, not GPU utilization (no browser API).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const id = setInterval(() => {
      const r = rendererRef.current;
      if (!r) return;
      const s = r.getPerfStats();
      const sbFpsLabel = s.springBoneUpdateFps > 0 ? `sb@${s.springBoneUpdateFps}hz` : 'sbUncapped';
      const gpuLabel = s.gpuTimerSupported ? (s.gpuTimeMs >= 0 ? `gpu=${s.gpuTimeMs.toFixed(2)}ms` : 'gpu=measuring') : 'gpuExt=N/A';
      const line1 =
        `${s.tier} ${s.fps}fps frame=${s.frameMs}ms · ${s.drawCalls}dr ${s.triangles}tri ` +
        `${s.geometries}geo ${s.textures}tex · dpr=${s.pixelRatio}(nat=${s.devicePixelRatio}) ` +
        `buf=${s.drawingBufferWidth}x${s.drawingBufferHeight} (css=${s.canvasWidth}x${s.canvasHeight})`;
      const line2 =
        `sched: rafInt=${s.rafIntervalMs.toFixed(1)}ms preUpd=${s.timeBeforeUpdateMs.toFixed(2)}ms ` +
        `postRnd=${s.timeAfterRenderMs.toFixed(2)}ms totInt=${s.totalFrameIntervalMs.toFixed(1)}ms missed=${s.missedFrames} · ${gpuLabel}`;
      const line3 =
        `cpu: upd=${s.updateMs.toFixed(2)}ms [lip=${s.lipMs.toFixed(2)} expr=${s.exprMs.toFixed(2)} ` +
        `vrm=${s.vrmMs.toFixed(2)} anim=${s.animMs.toFixed(2)} gest=${s.gestMs.toFixed(2)}] render=${s.renderMs.toFixed(2)}ms · ${sbFpsLabel}`;
      setPerfText(`${line1}\n${line2}\n${line3}`);
    }, 500);
    return () => clearInterval(id);
  }, []);

  const handleFileUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.fbx')) {
      alert('Please select a valid .fbx 3D model file.');
      return;
    }

    setIsLoadingFbx(true);
    if (rendererRef.current) {
      const success = await rendererRef.current.loadFbxModel(file);
      if (success) {
        setModelName(file.name);
        if (onFbxLoaded) onFbxLoaded(file.name);
      } else {
        alert('Failed to parse FBX model file.');
      }
    }
    setIsLoadingFbx(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  // Temporary DEV-only hook into the existing animation controller.
  // Requests a state only — all bone math stays in CarlottaAnimationController.
  const handleAnimTest = (label: string, state: 'idle' | 'listening' | 'talking' | 'thinking') => {
    window.__carlottaAnimState?.(state);
    setAnimTestState(label);
  };

  // Temporary DEV-only hook into the emotion layer. Independent from behavior:
  // does not change the animation state, only the persistent emotion baseline.
  const handleEmotionTest = (
    label: string,
    emotion: 'calm' | 'happy' | 'excited' | 'sad' | 'angry',
  ) => {
    window.__carlottaEmotion?.(emotion, 0.7);
    setAnimEmotion(label);
  };
  // Temporary DEV-only posture reset: neutral baseline without touching behavior.
  const handleEmotionReset = () => {
    window.__carlottaEmotion?.('calm', 0);
    setAnimEmotion('');
  };

  // Temporary DEV-only facial-expression diagnostic (dynamic safe list).
  // Pins ONE preset via the existing controller override — no animation
  // logic here, production-hidden. Replaces the earlier fixed five-button
  // row; the underlying single-expression hook behavior is unchanged.
  const handleScanTest = (preset: string) => {
    const label = preset.charAt(0).toUpperCase() + preset.slice(1);
    window.__carlottaExpressionScan?.(preset, 0.7);
    setAnimExpr(label);
  };
  const handleScanReset = () => {
    window.__carlottaExpressionScanReset?.();
    setAnimExpr('');
  };

  // Temporary DEV-only gesture row. Requests one-shot gestures through the
  // existing skill/gesture path — no animation logic here, production-hidden.
  const handleGestureTest = (gesture: string) => {
    window.__carlottaGestureStart?.(gesture);
    setAnimGesture(gesture);
  };
  const handleGestureCancel = () => {
    window.__carlottaGestureCancel?.();
    setAnimGesture('');
  };
  const capitalizePreset = (preset: string): string =>
    preset.length > 0 ? preset.charAt(0).toUpperCase() + preset.slice(1) : preset;

  // Temporary DEV-only recipe tester. Sliders edit local state only; Apply
  // sends one recipe object to the existing controller override mechanism.
  const handleRecipeSlider = (key: string, value: number) => {
    setRecipeWeights((prev) => ({ ...prev, [key]: value }));
  };
  const handleRecipeApply = () => {
    window.__carlottaExpressionRecipe?.({ ...recipeWeights });
  };
  const handleRecipeReset = () => {
    window.__carlottaExpressionRecipeReset?.();
  };
  const handleQuickRecipe = (values: Record<string, number>) => {
    setRecipeWeights((prev) => ({ ...prev, ...values }));
    window.__carlottaExpressionRecipe?.(values);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <div
      className={`relative w-full h-full rounded-3xl overflow-hidden mint-stage shadow-2xl flex flex-col justify-between transition-all border border-white/10 ${
        isDragOver ? 'ring-2 ring-orange-400 bg-orange-950/30' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Top Header Overlay */}
      <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
        {/* Active Emotion Badge with Dynamic Colors & Emoji */}
        <div
          className={`pointer-events-auto flex items-center gap-2 px-3.5 py-1.5 rounded-full glass text-xs font-medium shadow-lg border transition-all duration-300 ${emotionMeta.badgeBg} ${emotionMeta.badgeBorder}`}
        >
          <span className="text-sm">{emotionMeta.emoji}</span>
          <span className={`font-semibold ${emotionMeta.badgeText}`}>{emotionMeta.label}</span>
          <span className="text-slate-400 text-[10px]">({Math.round(emotionIntensity * 100)}%)</span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-300 capitalize text-[11px]">{dominantMood} mood</span>
        </div>

        {/* FBX File Upload Trigger */}
        <label className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-full glass hover:bg-white/10 text-xs text-slate-300 hover:text-orange-400 cursor-pointer transition-colors shadow-lg border border-white/10">
          <Upload className="w-3.5 h-3.5 text-orange-400" />
          <span>{isLoadingFbx ? 'Loading...' : 'Import FBX'}</span>
          <input
            type="file"
            accept=".fbx"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileUpload(e.target.files[0]);
              }
            }}
          />
        </label>
      </div>

      {/* Speaking Pulse Ring */}
      {isSpeaking && (
        <div className="absolute inset-0 pointer-events-none rounded-3xl border-2 border-orange-400/40 animate-ping opacity-20" />
      )}

      {/* Temporary DEV-only animation test control (stripped from prod builds) */}
      {import.meta.env.DEV && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 pointer-events-none flex flex-col items-center gap-1">
          <div className="pointer-events-auto flex items-center gap-1 glass px-2 py-1 rounded-full border border-white/10 shadow-lg">
            {(
              [
                ['Idle', 'idle'],
                ['Listen', 'listening'],
                ['Talk', 'talking'],
                ['Think', 'thinking'],
              ] as const
            ).map(([label, state]) => (
              <button
                key={state}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => handleAnimTest(label, state)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                  animTestState === label
                    ? 'bg-orange-500/80 text-white'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="pointer-events-auto flex items-center gap-1 glass px-2 py-1 rounded-full border border-white/10 shadow-lg">
            {(
              [
                ['Calm', 'calm'],
                ['Happy', 'happy'],
                ['Excited', 'excited'],
                ['Sad', 'sad'],
                ['Angry', 'angry'],
              ] as const
            ).map(([label, emotion]) => (
              <button
                key={emotion}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => handleEmotionTest(label, emotion)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                  animEmotion === label
                    ? 'bg-emerald-500/80 text-white'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleEmotionReset}
              className="px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors text-slate-300 hover:bg-white/10"
            >
              Reset
            </button>
          </div>
          <div className="pointer-events-auto flex items-center gap-1 glass px-2 py-1 rounded-full border border-white/10 shadow-lg">
            {safeExprList.map((preset) => {
              const label = capitalizePreset(preset);
              return (
                <button
                  key={preset}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => handleScanTest(preset)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                    animExpr === label
                      ? 'bg-sky-500/80 text-white'
                      : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              );
            })}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleScanReset}
              className="px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors text-slate-300 hover:bg-white/10"
            >
              Reset
            </button>
          </div>
          <div className="pointer-events-auto flex items-center gap-1 glass px-2 py-1 rounded-full border border-white/10 shadow-lg">
            {(
              [
                ['Wave', 'wave'],
                ['Greet', 'greeting'],
                ['Bye', 'goodbye'],
                ['Point', 'point'],
                ['Shrug', 'shrug'],
                ['Clap', 'clap'],
                ['Bow', 'bow'],
              ] as const
            ).map(([label, gesture]) => (
              <button
                key={gesture}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => handleGestureTest(gesture)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                  animGesture === gesture
                    ? 'bg-violet-500/80 text-white'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleGestureCancel}
              className="px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors text-slate-300 hover:bg-white/10"
            >
              Stop
            </button>
          </div>
        </div>
      )}

      {/* Temporary DEV-only recipe combination tester (stripped from prod builds) */}
      {import.meta.env.DEV && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
          <div
            className="pointer-events-auto glass rounded-xl border border-white/10 shadow-lg p-2 w-44"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="text-[9px] font-bold text-slate-400 tracking-wide px-1 pb-1">RECIPE TEST</div>
            {safeExprList.map((key) => (
              <label key={key} className="flex items-center gap-1.5 px-1 py-0.5">
                <span className="text-[9px] text-slate-300 capitalize w-12 shrink-0">{key}</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={recipeWeights[key] ?? 0}
                  onChange={(e) => handleRecipeSlider(key, parseFloat(e.target.value))}
                  className="flex-1 h-1 accent-orange-500 cursor-pointer"
                />
                <span className="text-[9px] text-slate-300 w-7 text-right tabular-nums">
                  {(recipeWeights[key] ?? 0).toFixed(2)}
                </span>
              </label>
            ))}
            <div className="flex items-center gap-1 px-1 pt-1">
              <button
                type="button"
                onClick={handleRecipeApply}
                className="flex-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-orange-500/80 text-white"
              >
                Apply Recipe
              </button>
              <button
                type="button"
                onClick={handleRecipeReset}
                className="flex-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-slate-300 hover:bg-white/10"
              >
                Reset
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1 px-1 pt-1">
              {(
                [
                  ['Happy Test', { happy: 0.7, relaxed: 0.15 }],
                  ['Strong Happy', { happy: 1.0, relaxed: 0.2 }],
                  ['Excited Test', { happy: 0.85, relaxed: 0.1 }],
                  ['Strong Angry', { angry: 1.0, relaxed: 0.15 }],
                  ['Strong Sad', { sad: 1.0, relaxed: 0.2 }],
                ] as const
              ).map(([label, values]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleQuickRecipe({ ...(values as Record<string, number>) })}
                  className="px-1.5 py-0.5 rounded-md text-[9px] font-medium text-slate-300 bg-white/5 hover:bg-white/15 border border-white/10"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* WebGL Canvas Container or 2D Fallback */}
      {isWebglAvailable ? (
        <div ref={containerRef} className="w-full h-full" />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
          <div className="relative w-36 h-36 rounded-full bg-gradient-to-tr from-orange-500/20 via-orange-400/40 to-amber-300/30 border border-orange-400/50 flex items-center justify-center shadow-2xl backdrop-blur-md">
            <div className={`w-28 h-28 rounded-full bg-slate-900/80 flex items-center justify-center border border-white/10 ${isSpeaking ? 'scale-105 transition-transform duration-200 ring-4 ring-orange-400/50' : ''}`}>
              <Sparkles className={`w-12 h-12 text-orange-400 ${isSpeaking ? 'animate-bounce' : 'animate-pulse'}`} />
            </div>
            {isSpeaking && (
              <div className="absolute inset-0 rounded-full border-2 border-orange-400/60 animate-ping opacity-40" />
            )}
          </div>
          <h3 className="mt-4 text-sm font-semibold text-slate-200">ZOYA Companion</h3>
          <p className="text-xs text-slate-400 max-w-xs mt-1">
            2D Mode active (WebGL context loss or GPU acceleration unavailable).
          </p>
        </div>
      )}

      {/* Temporary DEV-only perf readout (stripped from prod builds) */}
      {import.meta.env.DEV && perfText !== '' && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="glass px-3 py-1 rounded-xl border border-white/10 text-[10px] text-slate-400 tabular-nums whitespace-pre-line text-center">
            {perfText}
          </div>
        </div>
      )}

      {/* Bottom Model Info Overlay */}
      <div className="absolute bottom-4 left-4 right-4 z-10 flex items-center justify-between text-[11px] text-slate-400 pointer-events-none">
        <div className="flex items-center gap-1.5 glass px-3 py-1.5 rounded-xl border border-white/10">
          <Eye className="w-3.5 h-3.5 text-orange-400" />
          <span className="truncate max-w-[200px] text-slate-300">{modelName}</span>
        </div>
        <div className="glass px-3 py-1.5 rounded-xl border border-white/10 text-slate-400">
          Drag to rotate • Scroll to zoom
        </div>
      </div>
    </div>
  );
};
