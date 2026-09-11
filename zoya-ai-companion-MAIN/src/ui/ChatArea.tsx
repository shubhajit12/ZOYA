import React, { useEffect, useRef } from 'react';
import { ChatMessage, EmotionType } from '../types';
import { getEmotionMeta } from '../emotions/emotionEngine';
import { Sparkles, AlertCircle, RefreshCw, Volume2, User, Trash2 } from 'lucide-react';

interface ChatAreaProps {
  messages: ChatMessage[];
  status: 'idle' | 'thinking' | 'speaking' | 'error';
  errorMessage?: string | null;
  onRetry?: () => void;
  onClearChat?: () => void;
  onOpenSettings?: () => void;
  isSpeaking: boolean;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  status,
  errorMessage,
  onRetry,
  onClearChat,
  onOpenSettings,
  isSpeaking,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  return (
    <div className="flex-1 w-full h-full overflow-y-auto px-6 py-6 space-y-5 scrollbar-thin scrollbar-thumb-white/10 relative">
      {/* Top Header Row with Clear Chat Button */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-2 sticky top-0 z-10 bg-[#050506]/80 backdrop-blur-md px-1">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <Sparkles className="w-3.5 h-3.5 text-orange-400" />
          <span>Zoya Conversation</span>
        </div>
        {onClearChat && (
          <button
            onClick={onClearChat}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-400 hover:text-rose-300 glass hover:bg-rose-950/30 border border-white/10 hover:border-rose-500/30 rounded-xl transition-all"
            title="Clear Chat History"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Chat</span>
          </button>
        )}
      </div>

      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-3">
          <div className="w-12 h-12 rounded-2xl glass border border-orange-500/30 flex items-center justify-center glow-amber">
            <Sparkles className="w-6 h-6 text-orange-400" />
          </div>
          <h3 className="text-base font-semibold text-slate-200">Hi, I'm Zoya</h3>
          <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
            I'm your warm, expressive digital companion. Talk to me, share your thoughts, or share your screen.
          </p>
        </div>
      ) : (
        messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.sender === 'user' ? 'items-end' : 'items-start'
            } space-y-1.5`}
          >
            {/* Sender Label */}
            <div className="flex items-center gap-2 px-1 text-[11px] font-medium text-slate-400">
              {msg.sender === 'user' ? (
                <>
                  <span className="text-slate-300">You</span>
                  <User className="w-3 h-3 text-slate-400" />
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-orange-400" />
                  <span className="text-orange-400 font-semibold tracking-wide">Zoya</span>
                  {msg.emotion && (() => {
                    const meta = getEmotionMeta(msg.emotion);
                    return (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full glass border ${meta.badgeBorder} ${meta.badgeBg} ${meta.badgeText} flex items-center gap-1 font-medium`}>
                        <span>{meta.emoji}</span>
                        <span>{meta.label}</span>
                      </span>
                    );
                  })()}
                </>
              )}
            </div>

            {/* Bubble */}
            <div
              className={`max-w-[85%] rounded-2xl px-5 py-3 text-sm leading-relaxed glass border-l-2 ${
                msg.sender === 'user'
                  ? 'border-orange-500 text-slate-100 bg-orange-950/20'
                  : msg.error
                  ? 'border-rose-500 text-rose-200 bg-rose-950/30'
                  : 'border-white/20 text-slate-100'
              }`}
            >
              {msg.text}

              {msg.isStreaming && (
                <span className="inline-block w-2 h-4 ml-1 bg-orange-400 animate-pulse rounded-sm" />
              )}
            </div>
          </div>
        ))
      )}

      {/* Status Bar Indicators */}
      {status === 'thinking' && (
        <div className="flex items-center gap-2 text-xs text-orange-300 glass border border-orange-500/30 px-4 py-2 rounded-xl w-fit animate-pulse glow-amber">
          <Sparkles className="w-3.5 h-3.5 text-orange-400" />
          <span>Zoya is processing...</span>
        </div>
      )}

      {status === 'speaking' && (
        <div className="flex items-center gap-2 text-xs text-orange-300 glass border border-orange-500/30 px-4 py-2 rounded-xl w-fit glow-amber">
          <Volume2 className="w-3.5 h-3.5 animate-pulse text-orange-400" />
          <span>Zoya is speaking...</span>
        </div>
      )}

      {/* Error & Retry State */}
      {status === 'error' && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-rose-300 glass border border-rose-800/80 px-4 py-2.5 rounded-xl w-full">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{errorMessage || 'Connection failed. Groq AI Brain service unreachable.'}</span>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="flex items-center gap-1 px-3 py-1 bg-amber-950/80 hover:bg-amber-900 border border-amber-600/50 rounded-lg font-medium text-amber-200 transition-colors"
              >
                <span>Settings ⚙️</span>
              </button>
            )}
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex items-center gap-1 px-3 py-1 bg-rose-900/80 hover:bg-rose-800 border border-rose-700 rounded-lg font-medium text-white transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Retry</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};
