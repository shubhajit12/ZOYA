import React from 'react';
import { PcCommand } from '../types';
import { ShieldAlert, Check, X } from 'lucide-react';

interface ConfirmationModalProps {
  command: PcCommand;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  command,
  onConfirm,
  onCancel,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050506]/85 backdrop-blur-xl">
      <div className="w-full max-w-md glass border border-orange-500/40 rounded-3xl p-6 shadow-2xl space-y-5 glow-amber">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl glass border border-orange-500/50 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">Security Authorization Required</h3>
            <p className="text-xs text-slate-400">Zoya detected a desktop system command.</p>
          </div>
        </div>

        <div className="p-3.5 bg-[#050506]/90 rounded-xl border border-white/10 text-xs text-slate-200 space-y-1">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-orange-400">
            Target Command:
          </span>
          <p className="font-mono text-slate-300 break-all">{command.description}</p>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Do you want to authorize Zoya to proceed with executing this action?
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 glass hover:bg-white/10 rounded-xl text-xs text-slate-300 font-medium flex items-center gap-1.5 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            <span>Deny</span>
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-[0_0_15px_rgba(242,125,38,0.4)]"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Authorize Command</span>
          </button>
        </div>
      </div>
    </div>
  );
};
