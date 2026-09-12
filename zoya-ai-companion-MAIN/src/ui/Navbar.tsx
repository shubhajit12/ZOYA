import React from 'react';
import {
  Globe,
  Brain,
  Settings,
  Minimize2,
  Tv,
} from 'lucide-react';
import { EmotionalState } from '../types';
import { getEmotionMeta } from '../emotions/emotionEngine';
import { tauriBridge } from '../native/tauriBridge';

interface NavbarProps {
  userName: string;
  emotionalState: EmotionalState;
  isScreenSharing: boolean;
  onToggleScreenShare: () => void;
  onOpenBrowser: () => void;
  onOpenMemory: () => void;
  onOpenSettings: () => void;
  onMinimize: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  userName,
  emotionalState,
  isScreenSharing,
  onToggleScreenShare,
  onOpenBrowser,
  onOpenMemory,
  onOpenSettings,
  onMinimize,
}) => {
  const meta = getEmotionMeta(emotionalState.currentEmotion);

  const handleCompanionMinimize = async () => {
    onMinimize();
    await tauriBridge.enterCompanion();
  };

  return (
    <header className="w-full h-16 bg-[#050506]/90 backdrop-blur-xl border-b border-white/5 px-6 flex items-center justify-between z-20 shadow-lg">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full border border-orange-500/50 flex items-center justify-center">
            <div className="w-2.5 h-2.5 bg-orange-500 rounded-full animate-pulse shadow-[0_0_10px_#f27d26]" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-[0.2em] text-orange-500 uppercase flex items-center gap-2">
              <span>Zoya Desktop</span>
              <span className="text-[10px] font-semibold tracking-normal text-orange-400/90 bg-orange-950/60 border border-orange-500/30 px-2 py-0.5 rounded-full">
                AI Companion
              </span>
            </h1>
          </div>
        </div>

        <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full glass border text-xs transition-all ${meta.badgeBg} ${meta.badgeBorder}`}>
          <span className="text-sm">{meta.emoji}</span>
          <span className={`font-semibold ${meta.badgeText}`}>{meta.label}</span>
          <span className="text-slate-400 text-[10px]">({Math.round(emotionalState.emotionIntensity * 100)}%)</span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-300 capitalize text-[11px]">{emotionalState.mood.dominantMood} mood</span>
        </div>
      </div>

      <div className="flex items-center gap-4 sm:gap-6">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleScreenShare}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
              isScreenSharing
                ? 'bg-orange-500/20 text-orange-300 border border-orange-500/50 animate-pulse glow-amber'
                : 'glass text-slate-300 hover:text-white hover:bg-white/10'
            }`}
            title={isScreenSharing ? 'Stop Screen Share' : 'Enable Screen Share Context'}
          >
            <Tv className={`w-3.5 h-3.5 ${isScreenSharing ? 'text-orange-400' : 'text-slate-400'}`} />
            <span className="hidden md:inline">{isScreenSharing ? 'Screen Live' : 'Share Screen'}</span>
          </button>

          <button
            onClick={onOpenBrowser}
            className="w-9 h-9 rounded-xl glass flex items-center justify-center text-slate-300 hover:text-orange-400 hover:bg-white/10 transition-colors"
            title="Built-in Browser"
          >
            <Globe className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenMemory}
            className="w-9 h-9 rounded-xl glass flex items-center justify-center text-slate-300 hover:text-orange-400 hover:bg-white/10 transition-colors"
            title="Zoya Local Memories"
          >
            <Brain className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenSettings}
            className="w-9 h-9 rounded-xl glass flex items-center justify-center text-slate-300 hover:text-orange-400 hover:bg-white/10 transition-colors"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          <div className="w-[1px] h-6 bg-white/10 mx-1" />

          <button
            onClick={handleCompanionMinimize}
            className="w-9 h-9 rounded-xl glass flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Send ZOYA to desktop companion"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
