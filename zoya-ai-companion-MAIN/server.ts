import express from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import Groq from 'groq-sdk';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '20mb' }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin === 'tauri://localhost' || origin === 'http://tauri.localhost' || origin === 'https://tauri.localhost' || origin === 'http://localhost:3000' || origin === 'http://127.0.0.1:3000') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  const getGroqClient = (overrideApiKey?: string) => {
    const key = overrideApiKey || process.env.GROQ_API_KEY;
    if (!key) return null;
    return new Groq({ apiKey: key });
  };

  const getGenAIClient = (overrideApiKey?: string) => {
    const key = overrideApiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY environment variable is not configured.');
    return new GoogleGenAI({
      apiKey: key,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
  };

  const generateGeminiBrain = async (ai: GoogleGenAI, message: string, history: any[], memories: any[], currentMood: string, currentEmotion: string) => {
    const systemInstruction = `
You are ZOYA, a warm, natural, emotionally aware, and expressive digital AI companion.
You live inside a 3D avatar named MINT on the user's desktop.
Core Personality Guidelines:
- Speak naturally, warmly, and expressively like a real companion.
- Never use canned generic AI phrases like "I'm right here with you! Let's continue." or "I'm just an AI" or "How can I assist you today?".
- Adapt your response depth and tone to match the user's emotion and context.
- Current Zoya Internal Mood: ${currentMood || 'cheerful'}.
- Current Momentary Emotion: ${currentEmotion || 'neutral'}.
- Relevant User Memories: ${JSON.stringify(memories || [])}.
Format Requirements:
Return your response strictly in valid JSON matching this schema:
{
  "reply": "Your natural conversational response here",
  "emotion": "one of: neutral, happy, excited, amused, curious, surprised, sad, concerned, angry, embarrassed, shy, thoughtful, confused, affectionate, playful",
  "emotionIntensity": 0.45,
  "mood": "dominant mood string",
  "moodIntensity": 0.5,
  "gesture": "one of: nod, tilt_head, wave, think, shrug, smile_wide, gasp, bow, none",
  "voiceStyle": "natural"
}
`;

    const contents: any[] = [];
    if (Array.isArray(history)) {
      history.slice(-6).forEach((item: any) => {
        contents.push({ role: item.sender === 'user' ? 'user' : 'model', parts: [{ text: item.text }] });
      });
    }
    contents.push({ role: 'user', parts: [{ text: message || 'Hello' }] });

    const candidateModels = ['gemini-2.5-flash', 'gemini-3.7-flash', 'gemini-flash-latest'];
    let lastErr: any = null;
    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents,
          config: { systemInstruction, responseMimeType: 'application/json' },
        });
        if (response.text) return JSON.parse(response.text);
      } catch (err: any) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Gemini completion failed');
  };

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'ZOYA AI Engine (Groq Brain + Fish Audio TTS)' });
  });

  app.post('/api/zoya/face-debug-log', (req, res) => {
    try {
      const { message } = req.body;
      if (message && typeof message === 'string') console.log(message);
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const { message, history, memories, currentMood, currentEmotion, groqApiKey, apiKey } = req.body;
      const effectiveGroqKey = groqApiKey || process.env.GROQ_API_KEY;
      const effectiveGeminiKey = apiKey || process.env.GEMINI_API_KEY;

      const systemInstruction = `
You are ZOYA, a warm, natural, emotionally aware, and expressive digital AI companion.
You live inside a 3D avatar named MINT on the user's desktop.
Personality & Emotional Guidelines:
- Speak naturally, warmly, playfully, and expressively like a true close companion.
- Never sound robotic or generic. Avoid canned phrases like "How can I assist you today?" or "I'm just an AI".
- Accurately reflect human emotions.
- Maintain emotional continuity: Do NOT randomly flip emotions.
- Current Zoya Internal Mood: ${currentMood || 'cheerful'}.
- Current Momentary Emotion: ${currentEmotion || 'happy'}.
- User Memories: ${JSON.stringify(memories || [])}.
Format Requirements:
Return your response strictly in structured JSON matching this schema:
{
  "reply": "Your conversational response",
  "emotion": "one of: neutral, happy, excited, amused, curious, surprised, sad, concerned, angry, embarrassed, shy, thoughtful, confused, affectionate, playful",
  "emotionIntensity": 0.65,
  "mood": "dominant mood",
  "moodIntensity": 0.6,
  "gesture": "one of: nod, tilt_head, wave, think, shrug, smile_wide, gasp, bow, none",
  "voiceStyle": "natural"
}
`;

      if (effectiveGroqKey) {
        try {
          const groq = new Groq({ apiKey: effectiveGroqKey });
          const messages: any[] = [{ role: 'system', content: systemInstruction }];
          if (Array.isArray(history)) {
            history.slice(-6).forEach((item: any) => {
              messages.push({ role: item.sender === 'user' ? 'user' : 'assistant', content: item.text });
            });
          }
          messages.push({ role: 'user', content: message || 'Hello' });

          const completion = await groq.chat.completions.create({
            messages,
            model: 'openai/gpt-oss-20b',
            response_format: { type: 'json_object' },
            temperature: 0.75,
          });

          if (completion?.choices?.[0]?.message?.content) {
            return res.json(JSON.parse(completion.choices[0].message.content));
          }
        } catch (groqErr: any) {
          console.warn('[Groq Chat Fallback] Groq failed, attempting Gemini:', groqErr.message);
        }
      }

      if (effectiveGeminiKey) {
        const ai = getGenAIClient(effectiveGeminiKey);
        return res.json(await generateGeminiBrain(ai, message, history, memories, currentMood, currentEmotion));
      }

      throw new Error('Neither GROQ_API_KEY nor GEMINI_API_KEY is configured. Please provide an API key in Settings.');
    } catch (err: any) {
      console.error('API /api/chat error:', err);
      res.status(500).json({ error: err.message || 'AI Chat request failed' });
    }
  });

  app.post('/api/chat/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const { message, history, memories, currentMood, currentEmotion, groqApiKey, apiKey } = req.body;
      const effectiveGroqKey = groqApiKey || process.env.GROQ_API_KEY;
      const effectiveGeminiKey = apiKey || process.env.GEMINI_API_KEY;
      const systemInstruction = `
You are ZOYA, a warm, natural, emotionally aware, and expressive digital AI companion.
Current Mood: ${currentMood || 'cheerful'}, Current Emotion: ${currentEmotion || 'happy'}.
Memories: ${JSON.stringify(memories || [])}.
Respond warmly, naturally, and concisely to your friend.
`;

      let streamedText = '';
      let streamSucceeded = false;

      if (effectiveGroqKey) {
        try {
          const groq = new Groq({ apiKey: effectiveGroqKey });
          const messages: any[] = [{ role: 'system', content: systemInstruction }];
          if (Array.isArray(history)) {
            history.slice(-6).forEach((item: any) => {
              messages.push({ role: item.sender === 'user' ? 'user' : 'assistant', content: item.text });
            });
          }
          messages.push({ role: 'user', content: message || 'Hello' });

          const stream = await groq.chat.completions.create({
            messages,
            model: 'openai/gpt-oss-20b',
            stream: true,
            temperature: 0.75,
          });

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || '';
            if (delta) {
              streamedText += delta;
              res.write(`data: ${JSON.stringify({ delta })}\n\n`);
            }
          }
          streamSucceeded = true;
        } catch (groqStreamErr: any) {
          console.warn('[Groq Stream Warning] Groq streaming failed, trying Gemini stream:', groqStreamErr.message);
        }
      }

      if (!streamSucceeded && effectiveGeminiKey) {
        try {
          const ai = getGenAIClient(effectiveGeminiKey);
          const contents: any[] = [];
          if (Array.isArray(history)) {
            history.slice(-6).forEach((item: any) => {
              contents.push({ role: item.sender === 'user' ? 'user' : 'model', parts: [{ text: item.text }] });
            });
          }
          contents.push({ role: 'user', parts: [{ text: message || 'Hello' }] });

          const candidateModels = ['gemini-2.5-flash', 'gemini-3.7-flash'];
          let geminiStream: any = null;
          for (const m of candidateModels) {
            try {
              geminiStream = await ai.models.generateContentStream({ model: m, contents, config: { systemInstruction } });
              break;
            } catch (e) {}
          }

          if (geminiStream) {
            for await (const chunk of geminiStream) {
              const delta = chunk.text || '';
              if (delta) {
                streamedText += delta;
                res.write(`data: ${JSON.stringify({ delta })}\n\n`);
              }
            }
            streamSucceeded = true;
          }
        } catch (geminiErr: any) {
          console.error('[Gemini Stream Error]', geminiErr);
        }
      }

      if (!streamSucceeded) throw new Error('Streaming failed. Please configure GROQ_API_KEY or GEMINI_API_KEY in Settings.');
      res.write(`data: ${JSON.stringify({ done: true, fullText: streamedText })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: any) {
      console.error('API /api/chat/stream error:', err);
      res.write(`data: ${JSON.stringify({ error: err.message || 'Stream connection failed' })}\n\n`);
      res.end();
    }
  });

  // Fish Audio is the only TTS provider.
  const fishTtsGenerate = async (cleanText: string, apiKey: string, referenceId: string) => {
    const endpoint = 'https://api.fish.audio/v1/tts';
    const model = 's2.1-pro-free';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', model },
      body: JSON.stringify({ text: cleanText, reference_id: referenceId, format: 'mp3' }),
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      let message = bodyText || `Fish Audio TTS request failed (HTTP ${response.status})`;
      try { const parsed = JSON.parse(bodyText); message = parsed.message || parsed.error?.message || parsed.error || message; } catch {}
      const err: any = new Error(message); err.status = response.status;
      if (response.status === 429) { err.isQuotaExceeded = true; err.retryAfter = 60; }
      throw err;
    }
    const audioBytes = Buffer.from(await response.arrayBuffer());
    if (audioBytes.length < 50) throw new Error('Fish Audio returned empty or invalid audio data.');
    const base64Audio = audioBytes.toString('base64');
    console.log(`[Fish TTS] Success: ${audioBytes.length} bytes via ${model}, voice=${referenceId}`);
    return { audioUrl: `data:audio/mpeg;base64,${base64Audio}`, base64Audio, format: 'mp3', usedEndpoint: endpoint, usedModel: model, usedAuth: 'Fish Audio API key (FISH_API_KEY / user override)' };
  };

  app.post('/api/tts', async (req, res) => {
    try {
      const { text, fishApiKey, fishVoiceId } = req.body;
      if (!text || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Text prompt is required for TTS' });
      const cleanText = text.trim();
      const apiKey = (typeof fishApiKey === 'string' && fishApiKey.trim()) || process.env.FISH_API_KEY;
      const referenceId = (typeof fishVoiceId === 'string' && fishVoiceId.trim()) || process.env.FISH_VOICE_REFERENCE_ID || 'cbe13152c7ff4da98be9a95d448a1f39';
      if (!apiKey) return res.status(400).json({ error: 'Fish Audio API key is not configured. Add your Fish Audio API key in Zoya Settings or set FISH_API_KEY in the environment.' });
      const result = await fishTtsGenerate(cleanText, apiKey, referenceId);
      return res.json({ audioUrl: result.audioUrl, base64Audio: result.base64Audio, format: result.format, endpoint: result.usedEndpoint, model: result.usedModel, authMethod: result.usedAuth });
    } catch (err: any) {
      const status = err.status || 500; const isQuota = err.isQuotaExceeded || status === 429;
      console.error(`[Fish TTS] ${isQuota ? 'Rate limited' : 'Error'}:`, err.message);
      res.status(status).json({ error: err.message || 'Fish Audio text-to-speech generation failed', ...(isQuota ? { isQuotaExceeded: true, retryAfter: err.retryAfter || 60 } : {}) });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const viteModule = await (0, eval)('import("vite")');
    const vite = await viteModule.createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Zoya Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
