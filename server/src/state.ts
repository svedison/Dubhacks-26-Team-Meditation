import { acknowledgeSpoke, awaitSpoke, toElder } from './bus.js';
import type { Emotion, State } from './contracts.js';

// idle → listening (20 s window) → thinking → happy|worried|alert (shown WHILE the audio plays; the `speak`/`ask`
// event follows immediately) → `spoke` from the device → listening → 20 s silence → idle.
// A asked for the emotion before speech so the face is already red when the scam warning is heard.
export class ConversationState {
  private value: State = 'idle';
  private speaking = false;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private speech: Promise<void> = Promise.resolve();
  constructor(private emit = toElder, private listenMs = 20_000, private spokeMs = 8_000) {}
  get current(): State { return this.value; }
  get isSpeaking(): boolean { return this.speaking; }
  private set(value: State): void {
    if (this.timer) clearTimeout(this.timer);
    this.value = value;
    this.emit({ type: 'state', state: value });
  }
  wake(): void { if (this.value === 'idle') this.listen(); }
  listen(): void {
    if (this.speaking) return;
    this.set('listening');
    this.timer = setTimeout(() => this.set('idle'), this.listenMs);
    this.timer.unref();
  }
  think(): void {
    if (this.speaking) throw new Error('Wait for spoke before thinking');
    this.set('thinking');
  }
  /** Show `emotion` now, then return to listening once the device reports `spoke` (or after a timeout). */
  speak(emotion: Emotion): void {
    const version = ++this.generation;
    // Arm the acknowledgement before the pipeline sends the speak event.
    const acknowledged = awaitSpoke(this.spokeMs);
    this.speaking = true;
    this.set(emotion);
    this.speech = acknowledged.then(() => {
      if (version !== this.generation) return;
      this.speaking = false;
      this.listen();
    });
  }
  waitForSpeech(): Promise<void> { return this.speech; }
  reset(): void {
    this.generation++;
    acknowledgeSpoke();
    this.speaking = false;
    this.speech = Promise.resolve();
    this.set('idle');
  }
}
export const state = new ConversationState();
