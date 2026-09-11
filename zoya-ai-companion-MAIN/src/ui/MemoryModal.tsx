import React, { useState } from 'react';
import { memoryStore } from '../memory/memoryStore';
import { MemoryItem } from '../types';
import { Brain, Trash2, Plus, Search, X, Sparkles } from 'lucide-react';

interface MemoryModalProps {
  onClose: () => void;
}

export const MemoryModal: React.FC<MemoryModalProps> = ({ onClose }) => {
  const [memories, setMemories] = useState<MemoryItem[]>(memoryStore.getMemories());
  const [newContent, setNewContent] = useState<string>('');
  const [category, setCategory] = useState<MemoryItem['category']>('preference');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    memoryStore.addMemory(newContent.trim(), category);
    setMemories(memoryStore.getMemories());
    setNewContent('');
  };

  const handleDelete = (id: string) => {
    memoryStore.deleteMemory(id);
    setMemories(memoryStore.getMemories());
  };

  const handleClearAll = () => {
    if (confirm('Are you sure you want to clear all of Zoya local memories?')) {
      memoryStore.clearAll();
      setMemories([]);
    }
  };

  const filteredMemories = memories.filter((m) =>
    m.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050506]/85 backdrop-blur-xl">
      <div className="w-full max-w-lg glass border border-white/10 rounded-3xl p-6 shadow-2xl space-y-5 max-h-[85vh] flex flex-col glow-amber">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Brain className="w-5 h-5 text-orange-400" />
            <span className="tracking-wide">Zoya Local Memories</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl glass text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Add Memory Form */}
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Tell Zoya to remember something... (e.g. 'I love espresso')"
            className="flex-1 bg-[#050506]/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-orange-500"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as MemoryItem['category'])}
            className="bg-[#050506] border border-white/10 rounded-xl px-2 py-2 text-xs text-slate-300 focus:outline-none"
          >
            <option value="preference">Preference</option>
            <option value="fact">Fact</option>
            <option value="personal">Personal</option>
            <option value="general">General</option>
          </select>
          <button
            type="submit"
            disabled={!newContent.trim()}
            className="px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition-colors disabled:opacity-50 shadow-[0_0_10px_rgba(242,125,38,0.3)]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </form>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search saved memories..."
            className="w-full bg-[#050506]/80 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-300 focus:outline-none"
          />
        </div>

        {/* Memory List */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          {filteredMemories.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">
              No memories found. Add one above or tell Zoya "Remember that I..."
            </div>
          ) : (
            filteredMemories.map((mem) => (
              <div
                key={mem.id}
                className="flex items-center justify-between gap-3 p-3 glass border border-white/10 rounded-xl hover:bg-white/5 transition-colors"
              >
                <div className="space-y-1">
                  <p className="text-xs text-slate-200">{mem.content}</p>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <span className="capitalize px-1.5 py-0.5 rounded glass text-orange-300 border border-orange-500/20">
                      {mem.category}
                    </span>
                    <span>{new Date(mem.timestamp).toLocaleDateString()}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(mem.id)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/10 transition-colors"
                  title="Delete memory"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {memories.length > 0 && (
          <div className="flex justify-between items-center border-t border-white/10 pt-3 text-xs text-slate-400">
            <span>{memories.length} saved memories</span>
            <button
              onClick={handleClearAll}
              className="text-rose-400 hover:underline text-xs"
            >
              Clear All Memories
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
