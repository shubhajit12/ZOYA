import React, { useState } from 'react';
import { UserSettings } from '../types';
import { resolveEffectiveQuality, isValidQualitySetting, type EffectivePerformanceQuality, type PerformanceQualitySetting } from '../mint/performanceQuality';
import { X, Key, Volume2, Mic, Globe, Shield, Monitor, Gauge, Check, Trash2 } from 'lucide-react';

interface SettingsModalProps {
  settings: UserSettings;
  onSaveSettings: (newSettings: Partial<UserSettings>) => void;
  onRequestDeleteProfile: () => void;
  onClose: () => void;
}

/** Display helper: 'low' → 'Low'. Resolution still comes from the central detector. */
function capitalizeTier(tier: EffectivePerformanceQuality): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onSaveSettings,
  onRequestDeleteProfile,
  onClose,
}) => {
  const [userName, setUserName] = useState<string>(settings.userName);
  const [groqApiKey, setGroqApiKey] = useState<string>(settings.groqApiKey || '');
  const [geminiApiKey, setGeminiApiKey] = useState<string>(settings.geminiApiKey || '');
  const [fishApiKey, setFishApiKey] = useState<string>(settings.fishApiKey || '');
  const [fishVoiceId, setFishVoiceId] = useState<string>(settings.fishVoiceId || 'cbe13152c7ff4da98be9a95d448a1f39');
  const [volume, setVolume] = useState<number>(settings.volume);
  const [language, setLanguage] = useState<string>(settings.language);
  const [alwaysOnTop, setAlwaysOnTop] = useState<boolean>(settings.alwaysOnTop);
  const [pcPermissions, setPcPermissions] = useState<boolean>(settings.pcControlPermissions);
  const [mateDesktopCompanionEnabled, setMateDesktopCompanionEnabled] = useState<boolean>(settings.mateDesktopCompanionEnabled ?? true);
  const [performanceQuality, setPerformanceQuality] = useState<PerformanceQualitySetting>(
    isValidQualitySetting(settings.performanceQuality) ? settings.performanceQuality : 'auto'
  );
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings({
      userName,
      groqApiKey,
      geminiApiKey,
      fishApiKey,
      fishVoiceId,
      volume,
      language,
      alwaysOnTop,
      pcControlPermissions: pcPermissions,
      mateDesktopCompanionEnabled,
      performanceQuality,
    });
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050506]/85 backdrop-blur-xl">
      <div className="w-full max-w-lg glass border border-white/10 rounded-3xl p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto glow-amber">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Monitor className="w-5 h-5 text-orange-400" />
            <span className="tracking-wide">Settings & Preferences</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl glass text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          {/* User Profile */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300">Your Preferred Name</label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full bg-[#050506]/80 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* Groq API Key Configuration (AI Brain) */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-orange-400" />
              <span>Groq API Key (AI Chat & Reasoning Brain)</span>
            </label>
            <input
              type="password"
              value={groqApiKey}
              onChange={(e) => setGroqApiKey(e.target.value)}
              placeholder="Leave empty to use process.env.GROQ_API_KEY..."
              className="w-full bg-[#050506]/80 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
            />
            <p className="text-[11px] text-slate-500">
              Powers Zoya's personality, chat replies, reasoning, memory & emotion decisions via Groq.
            </p>
          </div>

          {/* Gemini API Key Configuration (Optional Brain Fallback) */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span>Google Gemini API Key (Optional Brain Fallback)</span>
            </label>
            <input type="password" value={geminiApiKey} onChange={(e) => setGeminiApiKey(e.target.value)} placeholder="Leave empty to use GEMINI_API_KEY..." className="w-full bg-[#050506]/80 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500" />
            <p className="text-[11px] text-slate-500">Used only if Groq is unavailable and Zoya falls back to Gemini for chat.</p>
          </div>

          {/* Fish Audio Voice */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Mic className="w-3.5 h-3.5 text-orange-400" />
              <span>Fish Audio Voice</span>
            </label>
            <div className="rounded-xl border border-white/10 bg-[#050506]/80 px-4 py-3 text-sm text-slate-100">Mitsuri Kanroji</div>
            <label className="block text-[11px] font-semibold text-slate-400">Fish Voice Reference ID</label>
            <input type="text" value={fishVoiceId} onChange={(e) => setFishVoiceId(e.target.value)} className="w-full bg-[#050506] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-orange-500" />
            <p className="text-[11px] text-slate-500">Default is the selected Mitsuri Kanroji voice. Replace the reference ID later to switch voices.</p>
          </div>
          {/* Volume Slider */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-orange-400" />
                <span>Voice Volume</span>
              </span>
              <span>{Math.round(volume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-full accent-orange-500 cursor-pointer"
            />
          </div>

          {/* Language Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-orange-400" />
              <span>Primary Language</span>
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full bg-[#050506] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
            >
              <option value="Auto">Auto-detect (Multilingual)</option>
              <option value="English">English</option>
              <option value="Spanish">Spanish</option>
              <option value="Japanese">Japanese</option>
              <option value="French">French</option>
              <option value="German">German</option>
              <option value="Hindi">Hindi</option>
            </select>
          </div>

          {/* Performance Settings */}
          <div className="space-y-2 border-t border-white/10 pt-4">
            <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-orange-400" />
              <span>Performance Quality</span>
            </label>
            <select
              value={performanceQuality}
              onChange={(e) => setPerformanceQuality(e.target.value as PerformanceQualitySetting)}
              className="w-full bg-[#050506] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
            >
              <option value="auto">Auto (Recommended)</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <p className="text-[11px] text-slate-500">
              {performanceQuality === 'auto'
                ? `Currently using: ${capitalizeTier(resolveEffectiveQuality('auto'))}`
                : 'Manual selection is always respected and never overridden.'}
            </p>
          </div>

          {/* Desktop Companion */}
          <div className="space-y-3 border-t border-white/10 pt-4">
            <label className="flex items-center gap-3 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={mateDesktopCompanionEnabled}
                onChange={(e) => setMateDesktopCompanionEnabled(e.target.checked)}
                className="w-4 h-4 accent-orange-500 rounded"
              />
              <span>Enable Desktop Companion (Mate)</span>
            </label>
            <p className="text-[11px] text-slate-500">
              When enabled, the title-bar minimize button sends Zoya to the desktop Mate companion. Turn this off if you prefer normal window minimization.
            </p>
          </div>

          {/* Checkbox Permissions */}
          <div className="space-y-3 border-t border-white/10 pt-4">
            <label className="flex items-center gap-3 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={alwaysOnTop}
                onChange={(e) => setAlwaysOnTop(e.target.checked)}
                className="w-4 h-4 accent-orange-500 rounded"
              />
              <span>Always on top (Desktop Window)</span>
            </label>

            <label className="flex items-center gap-3 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={pcPermissions}
                onChange={(e) => setPcPermissions(e.target.checked)}
                className="w-4 h-4 accent-orange-500 rounded"
              />
              <span className="flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-orange-400" />
                <span>Allow PC Control Voice Commands</span>
              </span>
            </label>
          </div>

          {/* Destructive Zone - Delete Profile */}
          <div className="border-t border-rose-500/20 pt-4 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h4 className="text-xs font-bold text-rose-400">Profile Danger Zone</h4>
                <p className="text-[11px] text-slate-400">Permanently remove your user profile & settings.</p>
              </div>
              <button
                type="button"
                onClick={onRequestDeleteProfile}
                className="px-3.5 py-2 bg-rose-600/20 hover:bg-rose-600 border border-rose-500/50 text-rose-300 hover:text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-[0_0_10px_rgba(244,63,94,0.2)] flex-shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Profile</span>
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 glass hover:bg-white/10 rounded-xl text-xs text-slate-300 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-[0_0_15px_rgba(242,125,38,0.4)]"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Saved!</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
