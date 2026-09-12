import React, { useState } from 'react';
import { ChatMessage, EmotionalState } from '../types';
import { getEmotionMeta } from '../emotions/emotionEngine';
import { MintCanvas } from '../mint/MintCanvas';
import { Sparkles, Maximize2, Send, Mic, MicOff, Volume2 } from 'lucide-react';

interface MinimizedWidgetProps {
  emotionalState: EmotionalState;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onRestore: () => void;
  isListening: boolean;
  onToggleVoice: () => void;
  isSpeaking: boolean;
}

export const MinimizedWidget: React.FC<MinimizedWidgetProps> = ({
  emotionalState,
  messages,
  onSendMessage,
  onRestore,
  isListening,
  onToggleVoice,
  isSpeaking,
}) => {
  const [inputText, setInputText] = useState<string>('');
  const meta = getEmotionMeta(emotionalState.currentEmotion);

  const lastZoyaMessage = [...messages].reverse().find((m) => m.sender === 'zoya');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#050506]">
      {/* Compact desktop-companion stage. The model is intentionally kept alive
          in minimized mode instead of replacing Carlotta with a static icon. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[240px] flex items-end justify-center">
        <div className="pointer-events-auto companion-landed h-[230px] w-[190px]">
          <MintCanvas
            currentEmotion={emotionalState.currentEmotion}
            emotionIntensity={emotionalState.emotionIntensity}
            dominantMood={emotionalState.mood.dominantMood}
            isSpeaking={isSpeaking}
            animationIntent={isSpeaking ? 'talking' : 'idle'}
            performanceQuality="auto"
          />
        </div>
      </div>

      {/* Lightweight minimized chat control remains available beside the companion. */}
      <div className="fixed bottom-5 left-5 z-[60] w-[340px] glass border border-orange-500/40 rounded-3xl p-4 shadow-2xl backdrop-blur-xl space-y-3 glow-amber">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full border border-orange-500/50 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-orange-400" />
            </div>
            <span className="text-xs font-bold tracking-wider text-orange-500 uppercase">ZOYA</span>
            <span className={`text-[10px] glass border ${meta.badgeBorder} ${meta.badgeBg} ${meta.badgeText} px-2 py-0.5 rounded-full font-medium flex items-center gap-1`}>
              <span>{meta.emoji}</span>
              <span>{meta.label}</span>
            </span>
          </div>

          <button
            onClick={onRestore}
            className="p-1.5 rounded-xl glass text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Restore Full ZOYA View"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 glass border border-white/10 rounded-2xl text-xs text-slate-200 min-h-[50px] flex items-center border-l-2 border-l-orange-500">
          {isSpeaking ? (
            <div className="flex items-center gap-2 text-orange-300">
              <Volume2 className="w-3.5 h-3.5 text-orange-400 animate-pulse" />
              <span className="truncate">{lastZoyaMessage?.text || 'Speaking...'}</span>
            </div>
          ) : (
            <p className="line-clamp-2">{lastZoyaMessage?.text || 'Ready when you are!'}</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2 glass rounded-2xl p-1.5 border border-white/10">
          <button
            type="button"
            onClick={onToggleVoice}
            className={`p-2 rounded-xl text-xs transition-colors ${
              isListening
                ? 'bg-rose-600 text-white animate-pulse'
                : 'glass hover:bg-white/10 text-slate-400 hover:text-orange-400'
            }`}
          >
            {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type to Zoya..."
            className="flex-1 bg-transparent border-none px-2 py-1 text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
          />

          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-2 bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-30 rounded-xl transition-all shadow-[0_0_10px_rgba(242,125,38,0.4)]"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>

      <style>{`
        @keyframes zoyaCompanionLanding {
          0% { transform: translateY(-70vh) scale(0.72); opacity: 0.35; }
          58% { transform: translateY(12px) scale(1.04); opacity: 1; }
          78% { transform: translateY(-5px) scale(0.99); }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        .companion-landed {
          animation: zoyaCompanionLanding 900ms cubic-bezier(.2,.8,.25,1) both;
        }
      `}</style>
    </div>
  );
};
