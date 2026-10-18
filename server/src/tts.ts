import { createHash, randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { audioDir } from './config.js';

const inFlight = new Map<string, Promise<string | null>>();
export async function synthesize(text: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY || !text.trim()) return null;
  const voice = process.env.OPENAI_TTS_VOICE || 'sage';
  const hash = createHash('sha256').update(`gpt-4o-mini-tts:${voice}:0.9:${text}`).digest('hex');
  const file = resolve(audioDir, `${hash}.mp3`);
  const base = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8787}`).replace(/\/+$/, '');
  const url = `${base}/audio/${hash}.mp3`;
  try { if ((await stat(file)).size > 0) return url; } catch { /* Not cached. */ }
  const existing = inFlight.get(hash);
  if (existing) return existing;
  const generate = async (): Promise<string | null> => {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, speed: 0.9, response_format: 'mp3' }),
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) throw new Error('TTS unavailable');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('Empty audio');
      await mkdir(audioDir, { recursive: true });
      await writeFile(temporary, bytes);
      await rename(temporary, file);
      return url;
    } catch {
      console.warn('TTS unavailable; using browser speech synthesis');
      return null;
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
  };
  const pending = generate();
  inFlight.set(hash, pending);
  try { return await pending; } finally { inFlight.delete(hash); }
}
