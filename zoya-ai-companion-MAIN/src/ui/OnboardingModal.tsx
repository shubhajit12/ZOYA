import React, { useState } from 'react';
import { Sparkles, Heart, Key } from 'lucide-react';

interface OnboardingModalProps {
  onComplete: (userName: string, groqApiKey?: string, fishApiKey?: string, geminiApiKey?: string) => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ onComplete }) => {
  const [name, setName] = useState<string>('');
  const [groqApiKey, setGroqApiKey] = useState<string>('');
  const [fishApiKey, setFishApiKey] = useState<string>('');
  const [geminiApiKey, setGeminiApiKey] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onComplete(name.trim(), groqApiKey.trim() || undefined, fishApiKey.trim() || undefined, geminiApiKey.trim() || undefined);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050506]/85 backdrop-blur-xl">
      <div className="w-full max-w-md glass border border-white/10 rounded-3xl p-8 shadow-2xl space-y-6 glow-amber">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-16 h-16 rounded-full border border-orange-500/50 flex items-center justify-center shadow-[0_0_20px_rgba(242,125,38,0.3)]">
            <Sparkles className="w-8 h-8 text-orange-400 animate-pulse" />
          </div>

          <h2 className="text-xl font-bold tracking-wider uppercase text-orange-500">Welcome to ZOYA</h2>
          <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
            Your warm digital AI companion powered by Groq (AI Brain) and Fish Audio (Voice).
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              What should Zoya call you?
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name..."
              className="w-full bg-[#050506]/80 border border-white/10 focus:border-orange-500 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-orange-400" />
              <span>Groq API Key (AI Brain / Chat)</span>
            </label>
            <input
              type="password"
              value={groqApiKey}
              onChange={(e) => setGroqApiKey(e.target.value)}
              placeholder="gsk_... (Optional if set in environment)"
              className="w-full bg-[#050506]/80 border border-white/10 focus:border-orange-500 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none transition-colors"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Used for Groq chat, personality, & reasoning. Get key at console.groq.com
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span>Fish Audio API Key (Zoya Voice)</span>
            </label>
            <input type="password" value={fishApiKey} onChange={(e) => setFishApiKey(e.target.value)} placeholder="Optional if set in FISH_API_KEY" className="w-full bg-[#050506]/80 border border-white/10 focus:border-orange-500 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none transition-colors" />
            <p className="text-[10px] text-slate-500 mt-1">Used for Fish Audio voice generation.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-slate-400" />
              <span>Gemini API Key (Optional Brain Fallback)</span>
            </label>
            <input type="password" value={geminiApiKey} onChange={(e) => setGeminiApiKey(e.target.value)} placeholder="Optional if set in GEMINI_API_KEY" className="w-full bg-[#050506]/80 border border-white/10 focus:border-orange-500 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none transition-colors" />
          </div>        <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-3 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-all shadow-[0_0_20px_rgba(242,125,38,0.4)] flex items-center justify-center gap-2"
          >
            <span>Meet Zoya</span>
            <Heart className="w-4 h-4 fill-white" />
          </button>
        </form>
      </div>
    </div>
  );
};

