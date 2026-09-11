import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Globe, Send, ExternalLink, ShieldAlert } from 'lucide-react';

interface BuiltInBrowserProps {
  onSendContextToZoya: (url: string, title: string, content: string) => void;
  onClose?: () => void;
}

export const BuiltInBrowser: React.FC<BuiltInBrowserProps> = ({ onSendContextToZoya, onClose }) => {
  const [urlInput, setUrlInput] = useState<string>('https://en.wikipedia.org/wiki/Special:Random');
  const [activeUrl, setActiveUrl] = useState<string>('https://en.wikipedia.org/wiki/Special:Random');
  const [history, setHistory] = useState<string[]>(['https://en.wikipedia.org/wiki/Special:Random']);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleNavigate = (targetUrl: string) => {
    let formatted = targetUrl.trim();
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      if (formatted.includes('.') && !formatted.includes(' ')) {
        formatted = `https://${formatted}`;
      } else {
        formatted = `https://www.google.com/search?q=${encodeURIComponent(formatted)}`;
      }
    }

    setUrlInput(formatted);
    setActiveUrl(formatted);
    const newHistory = [...history.slice(0, historyIndex + 1), formatted];
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setIsLoading(true);
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      setUrlInput(prev);
      setActiveUrl(prev);
    }
  };

  const handleForward = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      setUrlInput(next);
      setActiveUrl(next);
    }
  };

  const handleSendPageContext = () => {
    onSendContextToZoya(
      activeUrl,
      'Web Page Context',
      `Browsing web context from: ${activeUrl}. Please review this reference URL for information.`
    );
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
      {/* Top Browser Bar */}
      <div className="flex items-center gap-2 p-3 bg-slate-950 border-b border-slate-800">
        <button
          onClick={handleBack}
          disabled={historyIndex <= 0}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 hover:bg-slate-800 transition-colors"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={handleForward}
          disabled={historyIndex >= history.length - 1}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 hover:bg-slate-800 transition-colors"
          title="Forward"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => setIsLoading(true)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Refresh"
        >
          <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
        </button>

        {/* Address Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleNavigate(urlInput);
          }}
          className="flex-1 flex items-center bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-1.5 focus-within:border-emerald-500 transition-colors"
        >
          <Globe className="w-4 h-4 text-emerald-400 mr-2 flex-shrink-0" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="w-full bg-transparent text-xs text-slate-200 focus:outline-none"
            placeholder="Search or enter web address..."
          />
        </form>

        {/* Send Page Context to Zoya */}
        <button
          onClick={handleSendPageContext}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-medium transition-colors"
          title="Share web context with Zoya"
        >
          <Send className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Ask Zoya About Page</span>
        </button>
      </div>

      {/* Frame Display */}
      <div className="relative flex-1 bg-slate-950">
        <iframe
          src={activeUrl}
          className="w-full h-full border-none"
          onLoad={() => setIsLoading(false)}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title="Embedded Zoya Browser"
        />

        {/* Note overlay for x-frame-options handling */}
        <div className="absolute bottom-3 right-3 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700 text-[11px] text-slate-400 flex items-center gap-2 shadow-lg">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
          <span>If external sites block embedding, click to open:</span>
          <a
            href={activeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-400 hover:underline flex items-center gap-1 font-medium"
          >
            <span>Open Tab</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
};
