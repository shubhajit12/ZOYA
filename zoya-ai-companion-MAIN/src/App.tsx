import React, { useState, useEffect } from 'react';
import { Navbar } from './ui/Navbar';
import { ChatArea } from './ui/ChatArea';
import { MessageInput } from './ui/MessageInput';
import { MintCanvas } from './mint/MintCanvas';
import { BuiltInBrowser } from './browser/BuiltInBrowser';
import { OnboardingModal } from './ui/OnboardingModal';
import { SettingsModal } from './ui/SettingsModal';
import { MemoryModal } from './ui/MemoryModal';
import { ConfirmationModal } from './ui/ConfirmationModal';
import { ActionConfirmModal } from './ui/ActionConfirmModal';
import { MinimizedWidget } from './ui/MinimizedWidget';

import { emotionEngine } from './emotions/emotionEngine';
import { memoryStore } from './memory/memoryStore';
import { groqClient } from './ai/groqClient';
import { voicePipeline } from './voice/voicePipeline';
import { screenService } from './screen/screenService';
import { pcControlService } from './pc/pcControl';
import { tauriBridge } from './native/tauriBridge';
import { ChatMessage, UserSettings, EmotionalState, PcCommand, AnimationIntent } from './types';

const STORAGE_SETTINGS_KEY = 'zoya_user_settings_v1';
const STORAGE_CHAT_KEY = 'zoya_chat_history_v1';

const DEFAULT_SETTINGS: UserSettings = {
  userName: 'User',
  groqApiKey: '',
  geminiApiKey: '',
  fishApiKey: '',
  fishVoiceId: 'cbe13152c7ff4da98be9a95d448a1f39',
  volume: 0.9,
  speechSpeed: 1.0,
  language: 'Auto',
  alwaysOnTop: false,
  minimizedMode: false,
  mateDesktopCompanionEnabled: true,
  pcControlPermissions: true,
  screenShareAllowed: true,
  theme: 'dark',
  hasCompletedOnboarding: false,
  performanceQuality: 'auto',
  minecraftIntegrationEnabled: false,
  minecraftServerAddress: '127.0.0.1',
  minecraftServerPort: 25565,
  minecraftBotUsername: 'Zoya',
  minecraftVersion: '',
  minecraftSkinUrl: '',
  minecraftSkinProvider: 'auto',
  minecraftSkinCommand: '/skin url "%URL%"',
};

export default function App() {
  const [settings, setSettings] = useState<UserSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SETTINGS_KEY);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [emotionalState, setEmotionalState] = useState<EmotionalState>(() =>
    emotionEngine.getState()
  );

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_CHAT_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {}
    return [
      {
        id: 'msg_welcome',
        sender: 'zoya',
        text: "Hi! I'm Zoya. I'm right here with you on your desktop. How are you doing today?",
        timestamp: Date.now(),
        emotion: 'happy',
        emotionIntensity: 0.5,
      },
    ];
  });

  const [status, setStatus] = useState<'idle' | 'thinking' | 'speaking' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [animationIntent, setAnimationIntent] = useState<AnimationIntent>('idle');

  // Modal Toggles
  const [showOnboarding, setShowOnboarding] = useState<boolean>(!settings.hasCompletedOnboarding);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showMemory, setShowMemory] = useState<boolean>(false);
  const [showBrowser, setShowBrowser] = useState<boolean>(false);
  const [pendingPcCommand, setPendingPcCommand] = useState<PcCommand | null>(null);

  // Confirmation Modals for Destructive Actions
  const [showConfirmDeleteProfile, setShowConfirmDeleteProfile] = useState<boolean>(false);
  const [showConfirmClearChat, setShowConfirmClearChat] = useState<boolean>(false);

  // The native companion hides this main webview. When it restores the
  // window, remount the normal main workspace so MintCanvas is recreated and
  // Carlotta loads again instead of leaving the old minimized chat widget up.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') setIsMinimized(false);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Save settings & chat history
  useEffect(() => {
    try {
      if (!settings.hasCompletedOnboarding) {
        localStorage.removeItem(STORAGE_SETTINGS_KEY);
      } else {
        localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(settings));
      }
    } catch {}
  }, [settings]);

  useEffect(() => {
    try {
      if (messages.length === 0) {
        localStorage.removeItem(STORAGE_CHAT_KEY);
      } else {
        localStorage.setItem(STORAGE_CHAT_KEY, JSON.stringify(messages.slice(-30)));
      }
    } catch {}
  }, [messages]);

  const handleConfirmDeleteProfile = () => {
    try {
      localStorage.removeItem(STORAGE_SETTINGS_KEY);
      localStorage.removeItem(STORAGE_CHAT_KEY);
      localStorage.removeItem('zoya_local_memory_v1');
      localStorage.removeItem('zoya_emotional_state_v1');
    } catch (e) {
      console.warn('Failed to clear settings & profile from localStorage:', e);
    }
    memoryStore.clearAll();
    emotionEngine.resetEmotion();
    setEmotionalState(emotionEngine.getState());
    setSettings(DEFAULT_SETTINGS);
    setMessages([]);
    setShowSettings(false);
    setShowConfirmDeleteProfile(false);
    setShowOnboarding(true);
  };

  const handleConfirmClearChat = () => {
    try {
      localStorage.removeItem(STORAGE_CHAT_KEY);
    } catch (e) {
      console.warn('Failed to clear chat history from localStorage:', e);
    }
    setMessages([]);
    setShowConfirmClearChat(false);
  };

  // Sync speak status tick
  useEffect(() => {
    const interval = setInterval(() => {
      const speaking = voicePipeline.getIsSpeaking();
      setIsSpeaking(speaking);
      if (speaking) {
        setStatus('speaking');
        setAnimationIntent('talking');
      } else if (status === 'speaking') {
        setStatus('idle');
        // Return to idle animation after speaking ends
        setAnimationIntent('idle');
      }
    }, 200);
    return () => clearInterval(interval);
  }, [status]);

  const handleSendMessage = async (text: string) => {
    voicePipeline.interruptSpeech();
    setAnimationIntent('listening');

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      sender: 'user',
      text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setStatus('thinking');
    setErrorMessage(null);

    const pcCmd = pcControlService.parseCommand(text);
    if (pcCmd) {
      if (pcCmd.isDangerous) {
        setPendingPcCommand(pcCmd);
        setStatus('idle');
        return;
      } else {
        await pcControlService.executeCommand(pcCmd);
      }
    }

    if (text.toLowerCase().startsWith('remember that ') || text.toLowerCase().startsWith('remember ')) {
      const memText = text.replace(/^remember\s+(that\s+)?/i, '').trim();
      if (memText) {
        memoryStore.addMemory(memText, 'preference');
      }
    } else if (text.toLowerCase().startsWith('forget that ') || text.toLowerCase().startsWith('forget ')) {
      const forgetText = text.replace(/^forget\s+(that\s+)?/i, '').trim();
      memoryStore.forgetByKeyword(forgetText);
    }

    const updatedState = emotionEngine.recordUserEvent(`User: ${text.slice(0, 40)}`);
    setEmotionalState(updatedState);

    const relevantMemories = memoryStore.getRelevantMemories(text, 3).map((m) => m.content);

    try {
      const historyContext = messages.map((m) => ({ sender: m.sender, text: m.text }));
      const t0 = performance.now();
      console.log(`[Zoya Perf] T0: User message sent ("${text}")`);

      voicePipeline.configureFish(settings.fishApiKey || undefined, settings.fishVoiceId || undefined);
      voicePipeline.beginSpeechStream(t0);

      const zoyaMsgId = `zoya_${Date.now()}`;
      let isFirstChunk = true;
      let fullTextAcc = '';

      setMessages((prev) => [
        ...prev,
        {
          id: zoyaMsgId,
          sender: 'zoya',
          text: '',
          timestamp: Date.now(),
          emotion: updatedState.currentEmotion,
          emotionIntensity: updatedState.emotionIntensity,
        },
      ]);

      await groqClient.streamMessage(
        text,
        historyContext,
        relevantMemories,
        updatedState.mood.dominantMood,
        updatedState.currentEmotion,
        (chunkDelta) => {
          if (isFirstChunk) {
            isFirstChunk = false;
            const tFirstToken = performance.now() - t0;
            console.log(`[Zoya Perf] Brain first token: +${tFirstToken.toFixed(1)}ms`);
            setStatus('idle');
            setAnimationIntent('talking');
          }

          fullTextAcc += chunkDelta;

          setMessages((prev) =>
            prev.map((m) => (m.id === zoyaMsgId ? { ...m, text: fullTextAcc } : m))
          );

          voicePipeline.pushStreamChunk(chunkDelta);
        },
        (finalText, inferredEmotion) => {
          const tStreamDone = performance.now() - t0;
          console.log(`[Zoya Perf] Brain stream completed: +${tStreamDone.toFixed(1)}ms`);

          const newEmotionState = emotionEngine.updateEmotion(
            inferredEmotion.emotion,
            inferredEmotion.intensity,
            `Zoya expressed ${inferredEmotion.emotion}`
          );
          setEmotionalState(newEmotionState);

          setMessages((prev) =>
            prev.map((m) =>
              m.id === zoyaMsgId
                ? {
                    ...m,
                    text: finalText,
                    emotion: newEmotionState.currentEmotion,
                    emotionIntensity: newEmotionState.emotionIntensity,
                  }
                : m
            )
          );

          voicePipeline.endSpeechStream(finalText);

          if (inferredEmotion.animation) {
            setAnimationIntent(inferredEmotion.animation);
          }
          setStatus('idle');
        },
        (errMessage) => {
          console.warn('AI Brain stream error:', errMessage);
          setStatus('error');
          setErrorMessage(errMessage || 'AI Brain streaming error. Please check your API key in Settings.');
          voicePipeline.interruptSpeech();
        },
        settings.groqApiKey || undefined,
        settings.geminiApiKey || undefined
      );
    } catch (err: any) {
      console.warn('AI chat brain error:', err);
      setStatus('error');
      setErrorMessage(err.message || 'AI Brain service unreachable. Please check API key configuration in Settings.');
      voicePipeline.interruptSpeech();
    }
  };

  const handleStartVoiceInput = () => {
    voicePipeline.interruptSpeech();
    setIsListening(true);

    voicePipeline.listen(
      (transcript) => {
        setIsListening(false);
        handleSendMessage(transcript);
      },
      (err) => {
        setIsListening(false);
        console.warn('STT Error:', err);
      }
    );
  };

  const handleStopVoiceInput = () => {
    setIsListening(false);
  };

  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      screenService.stopScreenShare();
      setIsScreenSharing(false);
    } else {
      const active = await screenService.startScreenShare();
      setIsScreenSharing(active);
    }
  };

  const handleSaveSettings = (newSettings: Partial<UserSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      if (newSettings.alwaysOnTop !== undefined) {
        tauriBridge.setAlwaysOnTop(newSettings.alwaysOnTop);
      }
      // Apply Fish Audio settings immediately so Settings changes take effect
      // without requiring another chat turn or app restart.
      if (newSettings.fishApiKey !== undefined || newSettings.fishVoiceId !== undefined) {
        voicePipeline.configureFish(
          updated.fishApiKey || undefined,
          updated.fishVoiceId || undefined
        );
      }
      return updated;
    });
  };

  const handleConfirmPcCommand = async () => {
    if (pendingPcCommand) {
      await pcControlService.executeCommand(pendingPcCommand);
      setPendingPcCommand(null);
    }
  };

  return (
    <div className="w-screen h-screen bg-[#050506] text-slate-200 flex flex-col font-sans overflow-hidden select-none pt-14">
      <Navbar
        userName={settings.userName}
        emotionalState={emotionalState}
        isScreenSharing={isScreenSharing}
        onToggleScreenShare={handleToggleScreenShare}
        onOpenBrowser={() => setShowBrowser(!showBrowser)}
        onOpenMemory={() => setShowMemory(true)}
        onOpenSettings={() => setShowSettings(true)}
        mateDesktopCompanionEnabled={settings.mateDesktopCompanionEnabled}
        onMinimize={() => setIsMinimized(true)}
      />

      {isMinimized ? (
        <MinimizedWidget
          emotionalState={emotionalState}
          messages={messages}
          onSendMessage={handleSendMessage}
          onRestore={() => setIsMinimized(false)}
          isListening={isListening}
          onToggleVoice={isListening ? handleStopVoiceInput : handleStartVoiceInput}
          isSpeaking={isSpeaking}
        />
      ) : (
        <main className="flex-1 w-full h-[calc(100vh-3.5rem)] flex flex-col md:flex-row p-6 gap-6 overflow-hidden">
          <section className="w-full md:w-1/2 h-[45%] md:h-full flex flex-col">
            <MintCanvas
              currentEmotion={emotionalState.currentEmotion}
              emotionIntensity={emotionalState.emotionIntensity}
              dominantMood={emotionalState.mood.dominantMood}
              isSpeaking={isSpeaking}
              animationIntent={animationIntent}
              performanceQuality={settings.performanceQuality ?? 'auto'}
            />
          </section>

          <section className="w-full md:w-1/2 h-[55%] md:h-full flex flex-col glass rounded-3xl border border-white/10 overflow-hidden shadow-2xl glow-amber">
            {showBrowser ? (
              <BuiltInBrowser
                onSendContextToZoya={(url, title, content) => {
                  setShowBrowser(false);
                  handleSendMessage(`Can you help me analyze this website link: ${url}`);
                }}
                onClose={() => setShowBrowser(false)}
              />
            ) : (
              <>
                <ChatArea
                  messages={messages}
                  status={status}
                  errorMessage={errorMessage}
                  onRetry={() => {
                    const lastUserMsg = [...messages].reverse().find((m) => m.sender === 'user');
                    if (lastUserMsg) handleSendMessage(lastUserMsg.text);
                  }}
                  onClearChat={() => setShowConfirmClearChat(true)}
                  onOpenSettings={() => setShowSettings(true)}
                  isSpeaking={isSpeaking}
                />

                <MessageInput
                  onSendMessage={handleSendMessage}
                  onStartVoiceInput={handleStartVoiceInput}
                  onStopVoiceInput={handleStopVoiceInput}
                  isListening={isListening}
                  isSpeaking={isSpeaking}
                  onInterruptSpeech={() => voicePipeline.interruptSpeech()}
                  isScreenSharing={isScreenSharing}
                  screenFrameAttached={isScreenSharing}
                />
              </>
            )}
          </section>
        </main>
      )}

      {showOnboarding && (
        <OnboardingModal
          onComplete={(name, groqApiKey, fishApiKey, geminiApiKey) => {
            handleSaveSettings({
              userName: name,
              ...(groqApiKey ? { groqApiKey } : {}),
              ...(fishApiKey ? { fishApiKey } : {}),
              ...(geminiApiKey ? { geminiApiKey } : {}),
              hasCompletedOnboarding: true,
            });
            setShowOnboarding(false);
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSaveSettings={handleSaveSettings}
          onRequestDeleteProfile={() => setShowConfirmDeleteProfile(true)}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showMemory && <MemoryModal onClose={() => setShowMemory(false)} />}

      {pendingPcCommand && (
        <ConfirmationModal
          command={pendingPcCommand}
          onConfirm={handleConfirmPcCommand}
          onCancel={() => setPendingPcCommand(null)}
        />
      )}

      {showConfirmDeleteProfile && (
        <ActionConfirmModal
          title="Delete your Zoya profile?"
          description="This will permanently remove your locally stored profile information and associated personal data. Zoya will reset to first-launch onboarding."
          confirmLabel="Delete Profile"
          cancelLabel="Cancel"
          isDestructive={true}
          onConfirm={handleConfirmDeleteProfile}
          onCancel={() => setShowConfirmDeleteProfile(false)}
        />
      )}

      {showConfirmClearChat && (
        <ActionConfirmModal
          title="Clear this conversation?"
          description="This will permanently remove your active conversation messages. Your user profile, settings, and stored memories will remain untouched."
          confirmLabel="Clear Chat"
          cancelLabel="Cancel"
          isDestructive={true}
          onConfirm={handleConfirmClearChat}
          onCancel={() => setShowConfirmClearChat(false)}
        />
      )}
    </div>
  );
}
