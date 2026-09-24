import React from 'react';
import {
  Globe,
  Brain,
  Settings,
  Minimize2,
  Maximize2,
  X,
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
  mateDesktopCompanionEnabled: boolean;
  onMinimize: () => void;
  minecraftStatus?: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  userName,
  emotionalState,
  isScreenSharing,
  onToggleScreenShare,
  onOpenBrowser,
  onOpenMemory,
  onOpenSettings,
  mateDesktopCompanionEnabled,
  onMinimize,
  minecraftStatus,
}) => {
  const meta = getEmotionMeta(emotionalState.currentEmotion);

  const handleCompanionMinimize = async (event: React.MouseEvent) => {
    event.stopPropagation();

    if (!mateDesktopCompanionEnabled) {
      try {
        await tauriBridge.minimizeWindow();
        onMinimize();
      } catch (error) {
        console.error('[ZOYA] Normal window minimize failed:', error);
      }
      return;
    }

    try {
      await tauriBridge.enterCompanion();
      onMinimize();
    } catch (error) {
      console.error('[ZOYA] Mate companion handoff failed:', error);
    }
  };

  const handleWindowDrag = async (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    try {
      await tauriBridge.startWindowDrag();
    } catch (error) {
      console.error('[ZOYA] Window drag failed:', error);
    }
  };

  const handleMaximize = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await tauriBridge.toggleMaximizeWindow();
    } catch (error) {
      console.error('[ZOYA] Maximize/restore failed:', error);
    }
  };

  const handleClose = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await tauriBridge.closeWindow();
    } catch (error) {
      console.error('[ZOYA] Window close failed:', error);
    }
  };

  return (
    <header
      className="zoya-titlebar"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10000,
        height: 56,
        minHeight: 56,
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        background: '#050506',
        borderBottom: '2px solid rgba(242, 125, 38, 0.4)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.55)',
        userSelect: 'none',
      }}
    >
      <div
        className="flex-1 h-full flex items-center min-w-0 cursor-move"
        data-tauri-drag-region
        onMouseDown={handleWindowDrag}
      >
        <div className="flex items-center gap-3 px-5 min-w-0">
          <div className="w-7 h-7 rounded-full border border-orange-500/50 flex items-center justify-center shrink-0">
            <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse shadow-[0_0_10px_#f27d26]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-[0.18em] text-orange-500 uppercase flex items-center gap-2 whitespace-nowrap">
              <span>ZOYA</span>
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

      <div className="flex items-center h-full gap-2 px-2">
        {minecraftStatus && (
          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl glass border border-white/10 text-[10px] font-semibold tracking-wide" title="Minecraft integration status">
            <span className={`w-1.5 h-1.5 rounded-full ${minecraftStatus === 'CONNECTED' ? 'bg-emerald-400' : minecraftStatus === 'ERROR' ? 'bg-red-400' : 'bg-amber-400'}`} />
            <span className="text-slate-300">MC {minecraftStatus}</span>
          </div>
        )}

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

        <button onClick={onOpenBrowser} className="w-9 h-9 rounded-xl glass flex items-center justify-center text-slate-300 hover:text-orange-400 hover:bg-white/10 transition-colors" title="Built-in Browser">
          <Globe className="w-4 h-4" />
        </button>
        <button onClick={onOpenMemory} className="w-9 h-9 rounded-xl glass flex items-center justify-center text-slate-300 hover:text-orange-400 hover:bg-white/10 transition-colors" title="Zoya Local Memories">
          <Brain className="w-4 h-4" />
        </button>
        <button onClick={onOpenSettings} className="w-9 h-9 rounded-xl glass flex items-center justify-center text-slate-300 hover:text-orange-400 hover:bg-white/10 transition-colors" title="Settings">
          <Settings className="w-4 h-4" />
        </button>

        <div className="w-px h-7 bg-white/10 mx-1" />

        <button
          onMouseDown={handleCompanionMinimize}
          className="w-10 h-14 flex items-center justify-center text-slate-300 hover:text-orange-400 hover:bg-white/10 transition-colors"
          title={mateDesktopCompanionEnabled ? "Send ZOYA to desktop companion" : "Minimize ZOYA window"}
        >
          <Minimize2 className="w-4 h-4" />
        </button>
        <button
          onMouseDown={handleMaximize}
          className="w-10 h-14 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
          title="Maximize / Restore"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onMouseDown={handleClose}
          className="w-10 h-14 flex items-center justify-center text-slate-300 hover:text-white hover:bg-red-500/80 transition-colors"
          title="Close ZOYA"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
