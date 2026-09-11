import React, { useState } from 'react';
import { Send, Mic, MicOff, Tv, Square } from 'lucide-react';

interface MessageInputProps {
  onSendMessage: (text: string) => void;
  onStartVoiceInput: () => void;
  onStopVoiceInput: () => void;
  isListening: boolean;
  isSpeaking: boolean;
  onInterruptSpeech: () => void;
  isScreenSharing: boolean;
  screenFrameAttached: boolean;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  onStartVoiceInput,
  onStopVoiceInput,
  isListening,
  isSpeaking,
  onInterruptSpeech,
  isScreenSharing,
  screenFrameAttached,
}) => {
  const [text, setText] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSendMessage(text.trim());
    setText('');
  };

  return (
    <div className="w-full p-4 bg-[#050506]/90 border-t border-white/5 backdrop-blur-xl">
      {/* Screen Frame Active Badge */}
      {isScreenSharing && (
        <div className="mb-2 flex items-center gap-2 text-xs text-orange-300 glass border border-orange-500/30 px-3 py-1 rounded-lg w-fit">
          <Tv className="w-3.5 h-3.5 text-orange-400" />
          <span>Screen Context Sharing Active (Zoya sees screen)</span>
        </div>
      )}

      {/* Speech Interruption Floating Button */}
      {isSpeaking && (
        <div className="mb-2 flex items-center justify-between glass border border-orange-500/30 px-3 py-1.5 rounded-xl text-xs text-orange-300 glow-amber">
          <span>Zoya is speaking...</span>
          <button
            onClick={onInterruptSpeech}
            className="flex items-center gap-1 px-2.5 py-1 bg-orange-600/80 hover:bg-orange-500 rounded-lg text-[11px] font-medium text-white transition-colors"
          >
            <Square className="w-3 h-3" />
            <span>Stop Speech</span>
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-center gap-3 glass rounded-2xl p-2 border border-white/10 glow-amber">
        {/* Audio Visualizer Waveform Bar Graphic when active/listening */}
        <div className="hidden sm:flex gap-1 items-center px-2">
          <div className={`w-1 h-3 rounded-full transition-all ${isListening || isSpeaking ? 'bg-orange-500 animate-pulse h-5' : 'bg-orange-500/40'}`} />
          <div className={`w-1 h-5 rounded-full transition-all ${isListening || isSpeaking ? 'bg-orange-500 animate-pulse h-7' : 'bg-orange-500/60'}`} />
          <div className={`w-1 h-8 rounded-full transition-all ${isListening || isSpeaking ? 'bg-orange-400 animate-pulse h-10' : 'bg-orange-500'}`} />
          <div className={`w-1 h-4 rounded-full transition-all ${isListening || isSpeaking ? 'bg-orange-500 animate-pulse h-6' : 'bg-orange-500/50'}`} />
          <div className={`w-1 h-2 rounded-full transition-all ${isListening || isSpeaking ? 'bg-orange-500 animate-pulse h-4' : 'bg-orange-500/30'}`} />
        </div>

        {/* Text Area Input */}
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={isListening ? 'Listening to your voice...' : 'Talk to Zoya...'}
          className="flex-1 bg-transparent border-none px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-colors"
        />

        {/* Mic / Voice Input Button */}
        <button
          type="button"
          onClick={isListening ? onStopVoiceInput : onStartVoiceInput}
          className={`p-3 rounded-xl transition-all ${
            isListening
              ? 'bg-rose-600 text-white animate-pulse ring-2 ring-rose-500'
              : 'glass hover:bg-white/10 text-slate-300 hover:text-orange-400'
          }`}
          title={isListening ? 'Stop Recording' : 'Voice Input'}
        >
          {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        {/* Send Button */}
        <button
          type="submit"
          disabled={!text.trim()}
          className="w-11 h-11 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-30 disabled:hover:bg-orange-600 text-white flex items-center justify-center transition-all shadow-[0_0_15px_rgba(242,125,38,0.4)]"
          title="Send Message"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
