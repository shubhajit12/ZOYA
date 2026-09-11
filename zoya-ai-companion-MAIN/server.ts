import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Modality } from '@google/genai';
import Groq from 'groq-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '20mb' }));

  // Shared Groq client helper (AI Brain)
  const getGroqClient = (overrideApiKey?: string) => {
    const key = overrideApiKey || process.env.GROQ_API_KEY;
    if (!key) {
      return null;
    }
    return new Groq({ apiKey: key });
  };

  // Shared Gemini client helper (Voice / TTS & Fallback Brain)
  const getGenAIClient = (overrideApiKey?: string) => {
    const key = overrideApiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY environment variable is not configured.');
    }
    return new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  };

  // Helper for Gemini AI Brain Fallback
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
        contents.push({
          role: item.sender === 'user' ? 'user' : 'model',
          parts: [{ text: item.text }],
        });
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
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
          },
        });
        if (response.text) {
          return JSON.parse(response.text);
        }
      } catch (err: any) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Gemini completion failed');
  };

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'ZOYA AI Engine (Groq Brain + Gemini Voice)' });
  });

  // Face debug log endpoint — forwards browser facial test output to terminal
  app.post('/api/zoya/face-debug-log', (req, res) => {
    try {
      const { message } = req.body;
      if (message && typeof message === 'string') {
        console.log(message);
      }
      res.json({ ok: true });
    } catch {
      res.json({ ok: true }); // never crash the app
    }
  });

  // 1. Groq AI Brain Chat Endpoint (Structured JSON Output with Gemini fallback)
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
- Accurately reflect human emotions. Be empathetic when the user is down, cheerful when celebrating, curious about questions, slightly shy/blushing when complimented, and affectionate with loved ones.
- Maintain emotional continuity: Do NOT randomly flip emotions. Subtle transitions build realism.
- Current Zoya Internal Mood: ${currentMood || 'cheerful'}.
- Current Momentary Emotion: ${currentEmotion || 'happy'}.
- User Memories: ${JSON.stringify(memories || [])}.

Format Requirements:
Return your response strictly in structured JSON matching this schema:
{
  "reply": "Your conversational response",
  "emotion": "one of: neutral, happy, excited, amused, curious, surprised, sad, concerned, angry, embarrassed, shy, thoughtful, confused, affectionate, playful",
  "emotionIntensity": 0.65,
  "mood": "dominant mood (e.g. cheerful, calm, thoughtful, playful, melancholic)",
  "moodIntensity": 0.6,
  "gesture": "one of: nod, tilt_head, wave, think, shrug, smile_wide, gasp, bow, none",
  "voiceStyle": "natural"
}
`;

      // Try Groq First if key is available
      if (effectiveGroqKey) {
        try {
          const groq = new Groq({ apiKey: effectiveGroqKey });
          const modelName = 'openai/gpt-oss-20b';

          const messages: any[] = [{ role: 'system', content: systemInstruction }];
          if (Array.isArray(history)) {
            history.slice(-6).forEach((item: any) => {
              messages.push({
                role: item.sender === 'user' ? 'user' : 'assistant',
                content: item.text,
              });
            });
          }
          messages.push({ role: 'user', content: message || 'Hello' });

          const completion = await groq.chat.completions.create({
            messages,
            model: modelName,
            response_format: { type: 'json_object' },
            temperature: 0.75,
          });

          if (completion?.choices?.[0]?.message?.content) {
            const parsed = JSON.parse(completion.choices[0].message.content);
            return res.json(parsed);
          }
        } catch (groqErr: any) {
          console.warn('[Groq Chat Fallback] Groq failed, attempting Gemini:', groqErr.message);
        }
      }

      // Fallback to Gemini Brain
      if (effectiveGeminiKey) {
        const ai = getGenAIClient(effectiveGeminiKey);
        const geminiRes = await generateGeminiBrain(ai, message, history, memories, currentMood, currentEmotion);
        return res.json(geminiRes);
      }

      throw new Error('Neither GROQ_API_KEY nor GEMINI_API_KEY is configured. Please provide an API key in Settings.');
    } catch (err: any) {
      console.error('API /api/chat error:', err);
      res.status(500).json({ error: err.message || 'AI Chat request failed' });
    }
  });

  // 2. Groq AI Brain Streaming Endpoint (Server-Sent Events with Gemini Fallback)
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

      // Attempt Groq Streaming
      if (effectiveGroqKey) {
        try {
          const groq = new Groq({ apiKey: effectiveGroqKey });
          const modelName = 'openai/gpt-oss-20b';

          const messages: any[] = [{ role: 'system', content: systemInstruction }];
          if (Array.isArray(history)) {
            history.slice(-6).forEach((item: any) => {
              messages.push({
                role: item.sender === 'user' ? 'user' : 'assistant',
                content: item.text,
              });
            });
          }
          messages.push({ role: 'user', content: message || 'Hello' });

          const stream = await groq.chat.completions.create({
            messages,
            model: modelName,
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

      // Fallback: Gemini Streaming if Groq failed or key not set
      if (!streamSucceeded && effectiveGeminiKey) {
        try {
          const ai = getGenAIClient(effectiveGeminiKey);
          const contents: any[] = [];
          if (Array.isArray(history)) {
            history.slice(-6).forEach((item: any) => {
              contents.push({
                role: item.sender === 'user' ? 'user' : 'model',
                parts: [{ text: item.text }],
              });
            });
          }
          contents.push({ role: 'user', parts: [{ text: message || 'Hello' }] });

          const candidateModels = ['gemini-2.5-flash', 'gemini-3.7-flash'];
          let geminiStream: any = null;

          for (const m of candidateModels) {
            try {
              geminiStream = await ai.models.generateContentStream({
                model: m,
                contents,
                config: { systemInstruction },
              });
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

      if (!streamSucceeded) {
        throw new Error('Streaming failed. Please configure GROQ_API_KEY or GEMINI_API_KEY in Settings.');
      }

      // Send structured emotion analysis at stream completion
      res.write(`data: ${JSON.stringify({ done: true, fullText: streamedText })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: any) {
      console.error('API /api/chat/stream error:', err);
      res.write(`data: ${JSON.stringify({ error: err.message || 'Stream connection failed' })}\n\n`);
      res.end();
    }
  });

  // ── TTS Provider: Server-side helpers ──────────────────────────────────────

  /** Prepend a 44-byte RIFF WAV header to 16-bit PCM mono audio data. */
  const pcmToWav = (pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer => {
    const headerLength = 44;
    const dataLength = pcmBuffer.length;
    const wavBuffer = Buffer.alloc(headerLength + dataLength);

    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + dataLength, 4);
    wavBuffer.write('WAVE', 8);
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16);
    wavBuffer.writeUInt16LE(1, 20); // 1 = PCM
    wavBuffer.writeUInt16LE(numChannels, 22);
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
    wavBuffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
    wavBuffer.writeUInt16LE(bitsPerSample, 34);
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(dataLength, 40);

    pcmBuffer.copy(wavBuffer, 44);
    return wavBuffer;
  };

  // Rate limit / 429 Cooldown state (shared across all TTS providers)
  let ttsQuotaCooldownUntil: number = 0;
  let lastQuotaErrorMessage: string = '';

  /**
   * Gemini TTS Provider — calls Google Generative AI TTS endpoint.
   * Isolates ALL Gemini-specific code here so future providers
   * (local, Hugging Face, etc.) can be added as sibling functions.
   */
  const geminiTtsGenerate = async (
    cleanText: string,
    voiceName: string,
    apiKey: string,
  ): Promise<{
    audioUrl: string; base64Audio: string; format: string; usedEndpoint: string; usedModel: string; usedAuth: string;
  }> => {
    // Primary: gemini-3.1-flash-tts-preview, Fallback: gemini-2.5-flash-preview-tts
    const candidateModels = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
    let lastGenErr: any = null;

    for (const modelName of candidateModels) {
      try {
        const genEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const genRes = await fetch(genEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: cleanText }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: voiceName || 'Leda' },
                },
              },
            },
          }),
        });

        if (genRes.ok) {
          const genData = await genRes.json();
          const inlineData = genData.candidates?.[0]?.content?.parts?.[0]?.inlineData;
          const rawBase64 = inlineData?.data;

          if (rawBase64 && rawBase64.length > 50) {
            const rawBuffer = Buffer.from(rawBase64, 'base64');
            const wavBuffer = rawBuffer.subarray(0, 4).toString('ascii') === 'RIFF'
              ? rawBuffer
              : pcmToWav(rawBuffer, 24000, 1, 16);

            const base64Audio = wavBuffer.toString('base64');
            console.log(`[Gemini TTS] Success: ${wavBuffer.length} bytes via model ${modelName}`);
            return {
              audioUrl: `data:audio/wav;base64,${base64Audio}`,
              base64Audio,
              format: 'wav',
              usedEndpoint: `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
              usedModel: modelName,
              usedAuth: 'API Key (GEMINI_TTS_API_KEY / GEMINI_API_KEY)',
            };
          }
        } else if (genRes.status === 429) {
          const genErrJson = await genRes.json().catch(() => ({}));
          const quotaMsg = genErrJson.error?.message || 'Gemini TTS rate limit / quota exceeded (429).';
          lastQuotaErrorMessage = quotaMsg;
          ttsQuotaCooldownUntil = Date.now() + 60000;
          console.warn(`[Gemini TTS] Quota exceeded: ${quotaMsg} (60s cooldown)`);
          const err: any = new Error(`[TTS] Gemini quota exceeded: ${quotaMsg}`);
          err.isQuotaExceeded = true;
          err.status = 429;
          throw err;
        } else if (genRes.status === 403) {
          const genErrJson = await genRes.json().catch(() => ({}));
          const authMsg = genErrJson.error?.message || 'Gemini TTS request forbidden (403).';
          console.warn(`[Gemini TTS] Key forbidden (403): ${authMsg}`);
          const err: any = new Error(`Gemini TTS request forbidden (403): ${authMsg}`);
          err.status = 403;
          throw err;
        } else {
          const genErrJson = await genRes.json().catch(() => ({}));
          const shortErrMsg = genErrJson.error?.message || `Status ${genRes.status}`;
          lastGenErr = new Error(`TTS model ${modelName} returned status ${genRes.status}: ${shortErrMsg}`);
        }
      } catch (err: any) {
        if (err.isQuotaExceeded || err.status === 403) throw err;
        lastGenErr = err;
      }
    }

    throw lastGenErr || new Error('Gemini TTS audio generation failed on all candidate models.');
  };

  /**
   * Google Cloud TTS Provider — calls Cloud Text-to-Speech API via GCP metadata auth.
   * Only invoked when `provider === 'google-cloud'`.
   */
  const googleCloudTtsGenerate = async (
    cleanText: string,
    voiceName: string,
    languageCode: string,
  ): Promise<{
    audioUrl: string; base64Audio: string; format: string; usedEndpoint: string; usedModel: string; usedAuth: string;
  } | null> => {
    let accessToken = '';
    try {
      const tokenRes = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
        headers: { 'Metadata-Flavor': 'Google' },
      });
      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        accessToken = tokenData.access_token || '';
      }
    } catch (metaErr: any) {
      console.warn('[Cloud TTS Auth Warning] Could not fetch metadata token:', metaErr.message);
    }

    if (!accessToken) return null;

    const cloudEndpoint = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';
    const cloudModel = 'gemini-3.1-flash-tts-preview';

    try {
      const cloudRes = await fetch(cloudEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Goog-User-Project': 'ais-asia-southeast1-41f9a9454f',
        },
        body: JSON.stringify({
          input: { text: cleanText },
          voice: { languageCode, name: voiceName || 'Leda' },
          audioConfig: { audioEncoding: 'MP3' },
          model: cloudModel,
        }),
      });

      const cloudData = await cloudRes.json().catch(() => ({}));

      if (cloudRes.ok && cloudData.audioContent) {
        const base64Audio = cloudData.audioContent;
        console.log(`[Cloud TTS] Success: ${base64Audio.length} base64 chars`);
        return {
          audioUrl: `data:audio/mp3;base64,${base64Audio}`,
          base64Audio,
          format: 'mp3',
          usedEndpoint: cloudEndpoint,
          usedModel: cloudModel,
          usedAuth: 'OAuth2 Bearer Token (GCP Metadata Service)',
        };
      }
    } catch (fetchErr: any) {
      console.warn('[Cloud TTS] Request failed:', fetchErr.message);
    }
    return null;
  };

  /**
   * TTS Provider Router — dispatches to the correct provider.
   * Add new providers here (local TTS, Hugging Face, etc.).
   */
  app.post('/api/tts', async (req, res) => {
    try {
      const { text, voiceName = 'Leda', geminiApiKey, provider = 'gemini' } = req.body;
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Text prompt is required for TTS' });
      }

      const cleanText = text.trim();

      // Check server-side 429 cooldown
      const now = Date.now();
      if (now < ttsQuotaCooldownUntil) {
        const remainingSec = Math.ceil((ttsQuotaCooldownUntil - now) / 1000);
        console.warn(`[TTS] Cooldown active (${remainingSec}s). Skipping upstream call.`);
        return res.status(429).json({
          error: `TTS quota exceeded: ${lastQuotaErrorMessage || 'Rate limit active'}. Cooldown for ${remainingSec}s.`,
          isQuotaExceeded: true,
          retryAfter: remainingSec,
          status: 429,
        });
      }

      // Resolve TTS API key: user override → GEMINI_TTS_API_KEY → GOOGLE_TTS_API_KEY → GEMINI_API_KEY
      const apiKey =
        (typeof geminiApiKey === 'string' && geminiApiKey.trim()) ||
        process.env.GEMINI_TTS_API_KEY ||
        process.env.GOOGLE_TTS_API_KEY ||
        process.env.GEMINI_API_KEY;

      // Auto-detect language for Cloud TTS (Hindi, Bangla, English)
      let languageCode = 'en-US';
      if (/[\u0900-\u097F]/.test(cleanText)) {
        languageCode = 'hi-IN';
      } else if (/[\u0980-\u09FF]/.test(cleanText)) {
        languageCode = 'bn-IN';
      }

      // ── Provider routing ────────────────────────────────────────
      let result: { audioUrl: string; base64Audio: string; format: string; usedEndpoint: string; usedModel: string; usedAuth: string } | null = null;
      let cloudTtsStatus = '';

      // Provider 1: Google Cloud TTS (if explicitly requested)
      if (provider === 'google-cloud') {
        result = await googleCloudTtsGenerate(cleanText, voiceName, languageCode);
        if (!result) {
          cloudTtsStatus = 'Disabled or unavailable in GCP project';
        }
      }

      // Provider 2: Google Generative AI Gemini TTS (default)
      if (!result) {
        if (!apiKey) {
          return res.status(400).json({
            error: 'Google TTS API key is not configured. Please set your Gemini TTS API key in Settings (⚙️) or set GEMINI_TTS_API_KEY in environment variables.',
            endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
          });
        }
        result = await geminiTtsGenerate(cleanText, voiceName, apiKey);
      }

      return res.json({
        audioUrl: result.audioUrl,
        base64Audio: result.base64Audio,
        format: result.format,
        endpoint: result.usedEndpoint,
        model: result.usedModel,
        authMethod: result.usedAuth,
        cloudTtsStatus: cloudTtsStatus || 'Success',
      });
    } catch (err: any) {
      const status = err.status || 500;
      const isQuota = err.isQuotaExceeded || status === 429;
      console.error(`[TTS] ${isQuota ? 'Quota exceeded' : 'Error'}:`, err.message);
      res.status(status).json({
        error: err.message || 'Text-to-Speech generation failed',
        ...(isQuota ? { isQuotaExceeded: true, retryAfter: err.retryAfter || 60 } : {}),
      });
    }
  });

  // Vite Middleware for Development vs Static Serving for Production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Zoya Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
