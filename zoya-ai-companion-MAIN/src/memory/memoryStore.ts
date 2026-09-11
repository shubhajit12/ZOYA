import { MemoryItem } from '../types';

export class MemoryStore {
  private memories: MemoryItem[] = [];
  private storageKey = 'zoya_local_memory_v1';

  constructor() {
    this.loadMemories();
  }

  private loadMemories() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        this.memories = JSON.parse(saved);
      } else {
        // Initial default memories about Zoya & User
        this.memories = [
          {
            id: 'mem_1',
            content: 'User likes a warm, natural, and expressive AI companion experience.',
            category: 'preference',
            timestamp: Date.now(),
          },
        ];
        this.saveMemories();
      }
    } catch (e) {
      console.warn('Failed to load local memories:', e);
      this.memories = [];
    }
  }

  private saveMemories() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.memories));
    } catch (e) {
      console.warn('Failed to save local memories:', e);
    }
  }

  public getMemories(): MemoryItem[] {
    return [...this.memories];
  }

  public addMemory(content: string, category: MemoryItem['category'] = 'general'): MemoryItem {
    const trimmed = content.trim();
    if (!trimmed) throw new Error('Memory content cannot be empty');

    // Avoid exact duplicates
    const existing = this.memories.find((m) => m.content.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;

    const newItem: MemoryItem = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      content: trimmed,
      category,
      timestamp: Date.now(),
    };

    this.memories.unshift(newItem);
    this.saveMemories();
    return newItem;
  }

  public deleteMemory(id: string): boolean {
    const initialLen = this.memories.length;
    this.memories = this.memories.filter((m) => m.id !== id);
    if (this.memories.length !== initialLen) {
      this.saveMemories();
      return true;
    }
    return false;
  }

  public forgetByKeyword(keyword: string): number {
    const lower = keyword.toLowerCase();
    const initialLen = this.memories.length;
    this.memories = this.memories.filter((m) => !m.content.toLowerCase().includes(lower));
    const removedCount = initialLen - this.memories.length;
    if (removedCount > 0) {
      this.saveMemories();
    }
    return removedCount;
  }

  public clearAll(): void {
    this.memories = [];
    this.saveMemories();
  }

  /**
   * Filter and return top N relevant memories for the given input query
   * to avoid flooding Gemini context with irrelevant memory data.
   */
  public getRelevantMemories(query: string, maxCount: number = 4): MemoryItem[] {
    if (this.memories.length === 0) return [];
    if (!query || query.trim().length === 0) {
      return this.memories.slice(0, maxCount);
    }

    const tokens = query
      .toLowerCase()
      .replace(/[^\w\s]/gi, '')
      .split(/\s+/)
      .filter((t) => t.length > 2);

    if (tokens.length === 0) {
      return this.memories.slice(0, maxCount);
    }

    const scored = this.memories.map((mem) => {
      const contentLower = mem.content.toLowerCase();
      let score = 0;
      tokens.forEach((token) => {
        if (contentLower.includes(token)) score += 2;
      });
      // Slight boost for recent memories & preferences
      if (mem.category === 'preference' || mem.category === 'personal') score += 1;
      return { mem, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Filter items with score > 0, or fallback to most recent if no match found
    const matches = scored.filter((s) => s.score > 0).map((s) => s.mem);
    if (matches.length > 0) {
      return matches.slice(0, maxCount);
    }

    return this.memories.slice(0, Math.min(2, maxCount));
  }
}

export const memoryStore = new MemoryStore();
