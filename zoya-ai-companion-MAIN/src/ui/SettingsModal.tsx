import React, { useEffect, useState } from 'react';
import { UserSettings } from '../types';
import { tauriBridge } from '../native/tauriBridge';
import { resolveEffectiveQuality, isValidQualitySetting, type EffectivePerformanceQuality, type PerformanceQualitySetting } from '../mint/performanceQuality';
import { X, Key, Volume2, Mic, Globe, Shield, Monitor, Gauge, Check, Trash2, Gamepad2, Play, Square } from 'lucide-react';

interface SettingsModalProps {
  settings: UserSettings;
  onSaveSettings: (newSettings: Partial<UserSettings>) => void;
  onRequestDeleteProfile: () => void;
  onClose: () => void;
}

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
  const [minecraftEnabled, setMinecraftEnabled] = useState<boolean>(settings.minecraftIntegrationEnabled ?? false);
  const [minecraftHost, setMinecraftHost] = useState<string>(settings.minecraftServerAddress || '127.0.0.1');
  const [minecraftPort, setMinecraftPort] = useState<number>(settings.minecraftServerPort || 25565);
  const [minecraftVersion, setMinecraftVersion] = useState<string>(settings.minecraftVersion || '');
  const [minecraftOwnerUsername, setMinecraftOwnerUsername] = useState<string>(settings.minecraftOwnerUsername || settings.userName || '');
  const [minecraftSkinUrl, setMinecraftSkinUrl] = useState<string>(settings.minecraftSkinUrl || '');
  const [minecraftSkinProvider, setMinecraftSkinProvider] = useState<'auto' | 'custom' | 'disabled'>(settings.minecraftSkinProvider || 'auto');
  const [minecraftSkinCommand, setMinecraftSkinCommand] = useState<string>(settings.minecraftSkinCommand || '/skin url "%URL%"');
  const [minecraftNaturalMovementEnabled, setMinecraftNaturalMovementEnabled] = useState<boolean>(settings.minecraftNaturalMovementEnabled ?? false);
  const [minecraftStatus, setMinecraftStatus] = useState<string>('BRIDGE NOT RUNNING');
  const [minecraftError, setMinecraftError] = useState<string>('');
  const [minecraftBusy, setMinecraftBusy] = useState<boolean>(false);
  const [minecraftState, setMinecraftState] = useState<any>(null);

  const MINECRAFT_BOT_USERNAME = 'Zoya';

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch('http://127.0.0.1:32123/status', { cache: 'no-store' });
        if (!response.ok) throw new Error('Bridge unavailable');
        const data = await response.json();
        if (!cancelled) {
          setMinecraftStatus(data.status || 'DISCONNECTED');
          setMinecraftError(data.error || '');
        }
        try {
          const stateResponse = await fetch('http://127.0.0.1:32123/state', { cache: 'no-store' });
          if (stateResponse.ok && !cancelled) setMinecraftState(await stateResponse.json());
        } catch {}
      } catch {
        if (!cancelled) {
          setMinecraftStatus('BRIDGE NOT RUNNING');
          setMinecraftError('Launch the bot to start the Minecraft Bridge.');
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const handleLaunchMinecraft = async () => {
    setMinecraftBusy(true);
    setMinecraftStatus('CONNECTING');
    setMinecraftError('');
    try {
      await onSaveSettings({
        minecraftIntegrationEnabled: minecraftEnabled,
        minecraftServerAddress: minecraftHost.trim() || '127.0.0.1',
        minecraftServerPort: minecraftPort || 25565,
        minecraftBotUsername: MINECRAFT_BOT_USERNAME,
        minecraftOwnerUsername: minecraftOwnerUsername.trim(),
        minecraftVersion: minecraftVersion.trim(),
        minecraftSkinUrl: minecraftSkinUrl.trim(),
        minecraftSkinProvider,
        minecraftSkinCommand: minecraftSkinCommand.trim() || '/skin url "%URL%"',
        minecraftNaturalMovementEnabled,
      });
      await tauriBridge.launchMinecraftBot({
        host: minecraftHost.trim() || '127.0.0.1',
        port: minecraftPort || 25565,
        username: MINECRAFT_BOT_USERNAME,
        auth: 'offline',
        groqApiKey: settings.groqApiKey || '',
        ...(minecraftVersion.trim() ? { version: minecraftVersion.trim() } : {}),
        ...(minecraftSkinUrl.trim() ? { skinUrl: minecraftSkinUrl.trim() } : {}),
        skinProvider: minecraftSkinProvider,
        skinCommand: minecraftSkinCommand.trim() || '/skin url "%URL%"',
        movementEnabled: minecraftNaturalMovementEnabled,
        autoConnect: true,
      });
    } catch (error) {
      setMinecraftError(error instanceof Error ? error.message : String(error));
    } finally {
      setMinecraftBusy(false);
    }
  };

  const handleStopMinecraft = async () => {
    setMinecraftBusy(true);
    try {
      await tauriBridge.stopMinecraftBot();
      setMinecraftStatus('DISCONNECTED');
    } catch (error) {
      setMinecraftError(error instanceof Error ? error.message : String(error));
    } finally {
      setMinecraftBusy(false);
    }
  };

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
      minecraftIntegrationEnabled: minecraftEnabled,
      minecraftServerAddress: minecraftHost.trim() || '127.0.0.1',
      minecraftServerPort: minecraftPort || 25565,
      minecraftBotUsername: MINECRAFT_BOT_USERNAME,
      minecraftOwnerUsername: minecraftOwnerUsername.trim(),
      minecraftVersion: minecraftVersion.trim(),
      minecraftSkinUrl: minecraftSkinUrl.trim(),
      minecraftSkinProvider,
      minecraftSkinCommand: minecraftSkinCommand.trim() || '/skin url "%URL%"',
      minecraftNaturalMovementEnabled,
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
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Monitor className="w-5 h-5 text-orange-400" />
            <span className="tracking-wide">Settings & Preferences</span>
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-xl glass text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300">Your Preferred Name</label>
            <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} className="w-full bg-[#050506]/80 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500" />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-orange-400" />
              <span>Groq API Key (AI Chat & Reasoning Brain)</span>
            </label>
            <input type="password" value={groqApiKey} onChange={(e) => setGroqApiKey(e.target.value)} placeholder="Leave empty to use process.env.GROQ_API_KEY..." className="w-full bg-[#050506]/80 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500" />
            <p className="text-[11px] text-slate-500">Powers Zoya's personality, chat replies, reasoning, memory & emotion decisions via Groq.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span>Google Gemini API Key (Optional Brain Fallback)</span>
            </label>
            <input type="password" value={geminiApiKey} onChange={(e) => setGeminiApiKey(e.target.value)} placeholder="Leave empty to use GEMINI_API_KEY..." className="w-full bg-[#050506]/80 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500" />
            <p className="text-[11px] text-slate-500">Used only if Groq is unavailable and Zoya falls back to Gemini for chat.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5"><Mic className="w-3.5 h-3.5 text-orange-400" /><span>Fish Audio Voice</span></label>
            <div className="rounded-xl border border-white/10 bg-[#050506]/80 px-4 py-3 text-sm text-slate-100">Mitsuri Kanroji</div>
            <label className="block text-[11px] font-semibold text-slate-400">Fish Audio API Key</label>
            <input type="password" value={fishApiKey} onChange={(e) => setFishApiKey(e.target.value)} placeholder="Paste your Fish Audio API key" className="w-full bg-[#050506] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500" />
            <p className="text-[11px] text-slate-500">Used for Zoya's voice generation through Fish Audio.</p>
            <label className="block text-[11px] font-semibold text-slate-400">Fish Voice Reference ID</label>
            <input type="text" value={fishVoiceId} onChange={(e) => setFishVoiceId(e.target.value)} className="w-full bg-[#050506] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-orange-500" />
            <p className="text-[11px] text-slate-500">Default is the selected Mitsuri Kanroji voice. Replace the reference ID later to switch voices.</p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold text-slate-300"><span className="flex items-center gap-1.5"><Volume2 className="w-3.5 h-3.5 text-orange-400" /><span>Voice Volume</span></span><span>{Math.round(volume * 100)}%</span></div>
            <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-full accent-orange-500 cursor-pointer" />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-orange-400" /><span>Primary Language</span></label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full bg-[#050506] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500">
              <option value="Auto">Auto-detect (Multilingual)</option><option value="English">English</option><option value="Spanish">Spanish</option><option value="Japanese">Japanese</option><option value="French">French</option><option value="German">German</option><option value="Hindi">Hindi</option>
            </select>
          </div>

          <div className="space-y-2 border-t border-white/10 pt-4">
            <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5 text-orange-400" /><span>Performance Quality</span></label>
            <select value={performanceQuality} onChange={(e) => setPerformanceQuality(e.target.value as PerformanceQualitySetting)} className="w-full bg-[#050506] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500">
              <option value="auto">Auto (Recommended)</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
            <p className="text-[11px] text-slate-500">{performanceQuality === 'auto' ? `Currently using: ${capitalizeTier(resolveEffectiveQuality('auto'))}` : 'Manual selection is always respected and never overridden.'}</p>
          </div>

          <div className="space-y-3 border-t border-white/10 pt-4">
            <label className="flex items-center gap-3 text-xs text-slate-300 cursor-pointer"><input type="checkbox" checked={mateDesktopCompanionEnabled} onChange={(e) => setMateDesktopCompanionEnabled(e.target.checked)} className="w-4 h-4 accent-orange-500 rounded" /><span>Enable Desktop Companion (Mate)</span></label>
            <p className="text-[11px] text-slate-500">When enabled, the title-bar minimize button sends Zoya to the desktop Mate companion. Turn this off if you prefer normal window minimization.</p>
          </div>

          <div className="space-y-3 border-t border-white/10 pt-4">
            <label className="flex items-center gap-3 text-xs text-slate-300 cursor-pointer"><input type="checkbox" checked={alwaysOnTop} onChange={(e) => setAlwaysOnTop(e.target.checked)} className="w-4 h-4 accent-orange-500 rounded" /><span>Always on top (Desktop Window)</span></label>
            <label className="flex items-center gap-3 text-xs text-slate-300 cursor-pointer"><input type="checkbox" checked={pcPermissions} onChange={(e) => setPcPermissions(e.target.checked)} className="w-4 h-4 accent-orange-500 rounded" /><span className="flex items-center gap-1"><Shield className="w-3.5 h-3.5 text-orange-400" /><span>Allow PC Control Voice Commands</span></span></label>
          </div>

          <div className="space-y-4 border-t border-white/10 pt-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5"><Gamepad2 className="w-3.5 h-3.5 text-orange-400" /><span>Minecraft Integration</span></label>
              <p className="text-[11px] text-slate-500 mt-1">Launch the standalone ZOYA Minecraft bot. The debug terminal stays running even if ZOYA is closed.</p>
            </div>

            <label className="flex items-center gap-3 text-xs text-slate-300 cursor-pointer"><input type="checkbox" checked={minecraftEnabled} onChange={(e) => setMinecraftEnabled(e.target.checked)} className="w-4 h-4 accent-orange-500 rounded" /><span>Enable Minecraft Integration</span></label>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><label className="block text-[11px] font-semibold text-slate-400">Server Address</label><input type="text" value={minecraftHost} onChange={(e) => setMinecraftHost(e.target.value)} placeholder="127.0.0.1" className="w-full bg-[#050506] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500" /></div>
              <div className="space-y-1.5"><label className="block text-[11px] font-semibold text-slate-400">Server Port</label><input type="number" min="1" max="65535" value={minecraftPort} onChange={(e) => setMinecraftPort(Number(e.target.value) || 25565)} className="w-full bg-[#050506] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500" /></div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-slate-400">Owner Minecraft Username</label>
              <input type="text" value={minecraftOwnerUsername} onChange={(e) => setMinecraftOwnerUsername(e.target.value)} placeholder="Your Minecraft username" className="w-full bg-[#050506] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500" />
              <p className="text-[10px] text-slate-500">Used for private /w permission requests when another player asks Zoya to perform an action.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-slate-400">Bot Username</label>
                <div className="w-full bg-[#050506]/80 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-100">Zoya</div>
                <p className="text-[10px] text-slate-500">Fixed bot identity.</p>
              </div>
              <div className="space-y-1.5"><label className="block text-[11px] font-semibold text-slate-400">Minecraft Version</label><input type="text" value={minecraftVersion} onChange={(e) => setMinecraftVersion(e.target.value)} placeholder="Auto" className="w-full bg-[#050506] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500" /></div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-slate-400">Skin Provider</label>
                <select value={minecraftSkinProvider} onChange={(e) => setMinecraftSkinProvider(e.target.value as 'auto' | 'custom' | 'disabled')} className="w-full bg-[#050506] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500">
                  <option value="auto">Auto (SkinsRestorer-compatible)</option>
                  <option value="custom">Custom Command</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-slate-400">Custom Skin URL <span className="font-normal text-slate-500">(Optional)</span></label>
                <input type="url" value={minecraftSkinUrl} onChange={(e) => setMinecraftSkinUrl(e.target.value)} placeholder="https://.../skin.png" disabled={minecraftSkinProvider === 'disabled'} className="w-full bg-[#050506] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500 disabled:opacity-50" />
                <p className="text-[10px] text-slate-500">Optional. Zoya does not bundle or install a skin plugin; the selected provider sends a server command.</p>
              </div>
              {minecraftSkinProvider === 'custom' && <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-slate-400">Custom Command Template</label>
                <input type="text" value={minecraftSkinCommand} onChange={(e) => setMinecraftSkinCommand(e.target.value)} placeholder='/skin url "%URL%"' className="w-full bg-[#050506] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500" />
                <p className="text-[10px] text-slate-500">Use <code>%URL%</code> for the skin URL and <code>%USERNAME%</code> for Zoya's username.</p>
              </div>}
            </div>

            <label className="flex items-center gap-3 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" checked={minecraftNaturalMovementEnabled} onChange={(e) => setMinecraftNaturalMovementEnabled(e.target.checked)} className="w-4 h-4 accent-orange-500 rounded" />
              <span>Allow Autonomous Minecraft Movement</span>
            </label>
            <p className="text-[10px] text-slate-500">Allows Zoya's autonomous brain to choose movement/exploration when no higher-priority action is active. You can disable this at any time.</p>

            <div className="rounded-xl border border-white/10 bg-[#050506]/80 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between"><span className="text-[11px] font-semibold text-slate-400">Bridge Status</span><span className="text-[11px] font-bold text-slate-200">{minecraftStatus}</span></div>
              {minecraftState?.available && minecraftState.player && <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
                <span>Position: <b className="text-slate-200">{minecraftState.player.position.x}, {minecraftState.player.position.y}, {minecraftState.player.position.z}</b></span>
                <span>Dimension: <b className="text-slate-200">{minecraftState.world?.dimension || 'unknown'}</b></span>
                <span>Weather: <b className="text-slate-200">{minecraftState.world?.isRaining ? 'Rain' : 'Clear'}</b></span>
                <span>Thunder: <b className="text-slate-200">{minecraftState.world?.thunderState ?? '—'}</b></span>
                <span>Below: <b className="text-slate-200">{minecraftState.environment?.blockBelowDisplayName || minecraftState.environment?.blockBelow || '—'}</b></span>
                <span>Light: <b className="text-slate-200">{minecraftState.environment?.light ?? '—'}</b></span>
                <span>Sky Light: <b className="text-slate-200">{minecraftState.environment?.skyLight ?? '—'}</b></span>
                <span>Health: <b className="text-slate-200">{minecraftState.player.health ?? '—'}</b></span>
                <span>Hunger: <b className="text-slate-200">{minecraftState.player.food ?? '—'}</b></span>
                <span>Selected: <b className="text-slate-200">{minecraftState.selectedItem?.displayName || 'Empty'}</b></span>
                <span>Nearby: <b className="text-slate-200">{minecraftState.nearbyEntities?.length ?? 0}</b></span>
              </div>}
              {minecraftError && <p className="text-[10px] text-rose-400 mt-1 break-words">{minecraftError}</p>}
            </div>

            <div className="flex gap-3">
              <button type="button" disabled={!minecraftEnabled || minecraftBusy} onClick={handleLaunchMinecraft} className="flex-1 px-4 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"><Play className="w-3.5 h-3.5" /> Launch Bot</button>
              <button type="button" disabled={minecraftBusy} onClick={handleStopMinecraft} className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-white/10"><Square className="w-3.5 h-3.5" /> Stop Bot</button>
            </div>
          </div>

          <div className="border-t border-rose-500/20 pt-4 space-y-2">
            <div className="flex items-center justify-between gap-4"><div><h4 className="text-xs font-bold text-rose-400">Profile Danger Zone</h4><p className="text-[11px] text-slate-400">Permanently remove your user profile & settings.</p></div><button type="button" onClick={onRequestDeleteProfile} className="px-3.5 py-2 bg-rose-600/20 hover:bg-rose-600 border border-rose-500/50 text-rose-300 hover:text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-[0_0_10px_rgba(244,63,94,0.2)] flex-shrink-0"><Trash2 className="w-3.5 h-3.5" /><span>Delete Profile</span></button></div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 glass hover:bg-white/10 rounded-xl text-xs text-slate-300 font-medium">Cancel</button>
            <button type="submit" className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-[0_0_15px_rgba(242,125,38,0.4)]">{savedSuccess ? <><Check className="w-4 h-4" /><span>Saved!</span></> : <span>Save Changes</span>}</button>
          </div>
        </form>
      </div>
    </div>
  );
};
