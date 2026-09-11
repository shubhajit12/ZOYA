import React from 'react';
import { AlertTriangle, Trash2, ShieldAlert, Check, X } from 'lucide-react';

interface ActionConfirmModalProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ActionConfirmModal: React.FC<ActionConfirmModalProps> = ({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  isDestructive = true,
  onConfirm,
  onCancel,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050506]/85 backdrop-blur-xl">
      <div
        className={`w-full max-w-md glass border ${
          isDestructive ? 'border-rose-500/40' : 'border-orange-500/40'
        } rounded-3xl p-6 shadow-2xl space-y-5 glow-amber`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl glass border ${
              isDestructive ? 'border-rose-500/50 text-rose-400' : 'border-orange-500/50 text-orange-400'
            } flex items-center justify-center`}
          >
            {isDestructive ? <Trash2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">{title}</h3>
            <p className="text-[11px] text-slate-400">Confirmation Required</p>
          </div>
        </div>

        <div className="p-3.5 bg-[#050506]/90 rounded-xl border border-white/10 text-xs text-slate-200 leading-relaxed">
          {description}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 glass hover:bg-white/10 rounded-xl text-xs text-slate-300 font-medium flex items-center gap-1.5 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            <span>{cancelLabel}</span>
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isDestructive
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                : 'bg-orange-600 hover:bg-orange-500 text-white shadow-[0_0_15px_rgba(242,125,38,0.4)]'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
