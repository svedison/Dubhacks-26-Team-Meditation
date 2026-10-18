import { createHash, randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { audioDir } from './config.js';

// Provider order: MiniMax (team pick: voice "Arrogant Miss") → OpenAI (fallback) → null (browser speechSynthesis).
const MINIMAX_MODEL = () => process.env.MINIMAX_TTS_MODEL || 'speech-02-turbo';
const MINIMAX_VOICE = () => process.env.MINIMAX_VOICE_ID || 'Arrogant_Miss';
const MINIMAX_SPEED = () => Number(process.env.MINIMAX_TTS_SPEED || '0.9');
const OPENAI_VOICE = () => process.env.OPENAI_TTS_VOICE || 'sage';

type Provider = { name: string; cacheKey: string; fetchMp3: (text: string) => Promise<Buffer> };
function provider(): Provider | null {
  if (process.env.MINIMAX_API_KEY) {
    const model = MINIMAX_MODEL(), voice = MINIMAX_VOICE(), speed = MINIMAX_SPEED();
    return {
      name: 'MiniMax', cacheKey: `minimax:${model}:${voice}:${speed}`,
      async fetchMp3(text) {
        const group = process.env.MINIMAX_GROUP_ID;
        const url = `https://api.minimax.io/v1/t2a_v2${group ? `?GroupId=${encodeURIComponent(group)}` : ''}`;
        const response = await fetch(url, {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, text, stream: false, output_format: 'hex', language_boost: process.env.MINIMAX_LANGUAGE_BOOST || 'English',
            voice_setting: { voice_id: voice, speed, vol: 1, pitch: 0 },
            audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
          }),
          signal: AbortSignal.timeout(4_000),
        });
        if (!response.ok) throw new Error(`MiniMax HTTP ${response.status}`);
        const json = await response.json() as { base_resp?: { status_code?: number; status_msg?: string }; data?: { audio?: string } };
        if (json.base_resp?.status_code !== 0 || !json.data?.audio) throw new Error(`MiniMax ${json.base_resp?.status_code}: ${json.base_resp?.status_msg || 'no audio'}`);
        return Buffer.from(json.data.audio, 'hex');
      },
    };
  }
  if (process.env.OPENAI_API_KEY) {
    const voice = OPENAI_VOICE();
    return {
      name: 'OpenAI', cacheKey: `gpt-4o-mini-tts:${voice}:0.9`,
      async fetchMp3(text) {
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, speed: 0.9, response_format: 'mp3' }),
          signal: AbortSignal.timeout(4_000),
        });
        if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
      },
    };
  }
  return null;
}

/** What the voice reads: the caption keeps "911", but MiniMax reads the digits as "one hundred eleven". */
export function speechText(text: string): string {
  return text.replace(/\b911\b/g, 'nine one one');
}

const inFlight = new Map<string, Promise<string | null>>();
export async function synthesize(caption: string): Promise<string | null> {
  const tts = provider();
  if (!tts || !caption.trim()) return null;
  const text = speechText(caption);
  const hash = createHash('sha256').update(`${tts.cacheKey}:${text}`).digest('hex');
  const file = resolve(audioDir, `${hash}.mp3`);
  // Render sets RENDER_EXTERNAL_URL to the service's https URL, so audio links work there without extra config.
  const base = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 8787}`).replace(/\/+$/, '');
  const url = `${base}/audio/${hash}.mp3`;
  try { if ((await stat(file)).size > 0) return url; } catch { /* Not cached. */ }
  const existing = inFlight.get(hash);
  if (existing) return existing;
  const generate = async (): Promise<string | null> => {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const bytes = await tts.fetchMp3(text);
      if (!bytes.length) throw new Error('Empty audio');
      await mkdir(audioDir, { recursive: true });
      await writeFile(temporary, bytes);
      await rename(temporary, file);
      return url;
    } catch (error) {
      console.warn(`${tts.name} TTS unavailable (${error instanceof Error ? error.message : 'error'}); using browser speech synthesis`);
      return null;
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
  };
  const pending = generate();
  inFlight.set(hash, pending);
  try { return await pending; } finally { inFlight.delete(hash); }
}
