import { acknowledgeSpoke, awaitSpoke, toElder } from './bus.js';
import type { Emotion, State } from './contracts.js';

export class ConversationState {
  private value: State = 'idle';
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private speech: Promise<void> = Promise.resolve();
  constructor(private emit = toElder, private listenMs = 20_000, private spokeMs = 8_000, private emotionMs = 700) {}
  get current(): State { return this.value; }
  private set(value: State): void {
    if (this.timer) clearTimeout(this.timer);
    this.value = value;
    this.emit({ type: 'state', state: value });
  }
  wake(): void { if (this.value === 'idle') this.listen(); }
  listen(): void {
    if (this.value === 'speaking') return;
    this.set('listening');
    this.timer = setTimeout(() => this.set('idle'), this.listenMs);
    this.timer.unref();
  }
  think(): void {
    if (this.value === 'speaking') throw new Error('Wait for spoke before thinking');
    this.set('thinking');
  }
  speak(after: Emotion): void {
    const version = ++this.generation;
    // Arm the acknowledgement before the pipeline sends the speak event.
    const acknowledged = awaitSpoke(this.spokeMs);
    this.set('speaking');
    this.speech = acknowledged.then(() => {
      if (version !== this.generation) return;
      this.set(after);
      this.timer = setTimeout(() => this.listen(), this.emotionMs);
      this.timer.unref();
    });
  }
  waitForSpeech(): Promise<void> { return this.speech; }
  reset(): void {
    this.generation++;
    acknowledgeSpoke();
    this.speech = Promise.resolve();
    this.set('idle');
  }
}
export const state = new ConversationState();
