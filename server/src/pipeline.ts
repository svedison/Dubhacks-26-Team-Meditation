import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { all, get, getSettings, saveSettings } from './db.js';
import { now } from './clock.js';
import { toElder } from './bus.js';
import { state } from './state.js';
import { extractWakeName, isOnlyWakeName, matchesWakeName, normalize } from './wake.js';
import { shortlist } from './shelf.js';
import { decide, fallbackDecision, FALLBACK_REPLY, type Context, type Decision } from './llm.js';
import { synthesize } from './tts.js';
import * as risk from './modules/risk.js';
import { placeOrder } from './modules/orders.js';
import { VisaSandboxError } from './modules/visa-sandbox.js';
import { createAlert, extendAlert, saveGrandmaNote, handleAnswer as memoryAnswer, registerOrder, setSpeaker, takeRefillSuggestion, updateAlert, type ProactiveSpeech } from './modules/memory.js';
import type { Card, Emotion, Order, Source, UtteranceResult } from './contracts.js';

/** `onSpoken` runs once the device has finished playing this reply (or the 8 s playback timeout passed). */
interface ReplyPlan { text: string; emotion: Emotion; card?: Card; order?: Order; scamText?: string; onSpoken?: () => void }
export interface PipelineDependencies { decide: typeof decide; synthesize: typeof synthesize }
export interface PipelineTimeouts {
  /** One Claude or TTS call. The providers give up after 4 s on their own; this guard sits above them. */
  step: number;
  /** A turn that makes no progress for this long is released with the spoken fallback. Last resort for anything unforeseen. */
  stage: number;
  /** Longest wait for the rest of a sentence the elder is still saying. */
  hold: number;
  /** After the emergency warning has been heard: time the elder has to say "stop" before 911 is called. */
  countdown: number;
}
export const DEFAULT_TIMEOUTS: PipelineTimeouts = { step: 5_000, stage: 10_000, hold: 6_000, countdown: 5_000 };
// "Milo, stop" / "no" / "don't" / "I'm fine" during the countdown. Matched against normalize()d text (apostrophes become spaces).
const STOP_911 = /^(?:(?:hey |ok |okay )?milo )?(?:no\b|stop\b|don t\b|dont\b|do not\b|wait\b|cancel\b|never ?mind\b|i m (?:ok|okay|fine|alright|all right)\b|no need\b)/;
const EMERGENCY_WARNING = "That sounds serious. I'm calling 911 in five seconds. Say 'stop' if you don't want me to.";
const EMERGENCY_CALLING = 'Calling 911 now. Help is on the way; stay with me.';
const EMERGENCY_STOPPED = "Okay, I won't call 911. I'm letting your daughter know right now.";
const EMERGENCY_ONGOING = 'Help is on the way. Stay with me.';
interface Emergency { text: string; alertId: string; phase: 'warning' | 'countdown' | 'called' | 'stopped'; at: number; timer?: ReturnType<typeof setTimeout> }

// A turn moves queued → waiting (the device is still playing the previous answer) → holding (the elder is still
// talking) → thinking (Claude) → responding (TTS, then the speak event) → done. Up to and including thinking, a
// further voice fragment is the rest of the same sentence: it replaces the turn with the joined text.
type Stage = 'queued' | 'waiting' | 'holding' | 'thinking' | 'responding' | 'done';
const JOINABLE: ReadonlySet<Stage> = new Set(['queued', 'waiting', 'holding', 'thinking']);
interface Job {
  id: number; text: string; display: string; displayed: boolean; source: Source; version: number;
  alive: boolean; stage: Stage; stageAt: number; arrivedAt: number; claudeMs: number;
  controller: AbortController; watchdog?: () => void;
  historyEntry: Context['history'][number] | null; consumedNote: string | null;
}
export interface PipelineStatus {
  state: UtteranceResult['state'];
  turn: { id: number; source: Source; stage: Stage; stage_ms: number; text: string } | null;
  emergency: Emergency['phase'] | null;
}

export class ConversationPipeline {
  private pending: { productId: string; priceCents: number } | null = null;
  private awaitingName = false;
  private noteFor: string | null = null;
  private lastScam: { id: string; at: number } | null = null;
  private chatRounds = 0;
  private history: Context['history'] = [];
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;
  private latest: Job | null = null; // newest turn; a voice fragment may still join it
  private running: Job | null = null;
  private mic = { speechAt: 0, endAt: 0 };
  private emergency: Emergency | null = null;
  private readonly timeouts: PipelineTimeouts;
  constructor(private dependencies: PipelineDependencies = { decide, synthesize }, timeouts: Partial<PipelineTimeouts> = {}) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
    // D's Memory module speaks on its own (delivery / dose / reminder prompts); serialise it with normal replies.
    setSpeaker(event => this.enqueue(() => this.proactive(event)));
  }
  /** Run `job` after the utterance currently being handled (if any). */
  enqueue(job: () => Promise<unknown>): void {
    const version = this.generation;
    this.queue = this.queue.then(() => (version === this.generation ? job() : undefined)).catch(() => {});
  }
  private proactive(event: ProactiveSpeech): Promise<void> { return this.announce(event.text, 'happy', event); }
  /** Milo speaks on her own (Memory prompt, 911 call): after any current playback, with TTS, emotion first. */
  private async announce(text: string, emotion: Emotion, event?: ProactiveSpeech): Promise<void> {
    await state.waitForSpeech();
    const audio_url = await this.bounded(`"${text.slice(0, 30)}" TTS`, () => this.dependencies.synthesize(text), () => null);
    if (state.current === 'idle') state.wake(); // the device starts the conversation, no wake word needed for the answer
    state.speak(emotion);
    toElder({ type: 'transcript', role: 'ai', text });
    toElder(event?.type === 'ask' ? { type: 'ask', kind: event.kind ?? 'reminder', text, audio_url } : { type: 'speak', text, audio_url });
    this.history.push({ role: 'assistant', content: text });
    this.history = this.history.slice(-8);
  }

  // ---------- emergency: act first, let her stop it ----------
  // "My chest hurts" / "I fell": Milo does not advise, it acts. The warning is spoken, then she has `countdown` ms to say
  // stop; silence means the call goes out (she may not be able to talk). The daughter's red card arrives at once and is
  // rewritten with the outcome. In the demo the call is simulated: the frame shows "Calling 911 now".
  private startEmergency(text: string): ReplyPlan {
    this.pending = null; this.noteFor = null;
    if (this.emergency?.timer) clearTimeout(this.emergency.timer);
    const alert = createAlert('red', null, 'Emergency', 'Milo is calling 911 unless she stops it in the next few seconds. Call her now.', text);
    this.emergency = { text, alertId: alert.id, phase: 'warning', at: Date.now() };
    const version = this.generation;
    console.warn(`[pipeline] EMERGENCY from "${text.slice(0, 80)}": warning spoken, 911 countdown follows`);
    return { text: EMERGENCY_WARNING, emotion: 'alert', onSpoken: () => this.armCountdown(version) };
  }
  private armCountdown(version: number): void {
    const emergency = this.emergency;
    if (!emergency || emergency.phase !== 'warning' || version !== this.generation) return;
    emergency.phase = 'countdown';
    emergency.timer = setTimeout(() => this.enqueue(() => this.call911(version)), this.timeouts.countdown); // ref'd on purpose
  }
  private async call911(version: number): Promise<void> {
    const emergency = this.emergency;
    if (!emergency || emergency.phase !== 'countdown' || version !== this.generation) return;
    emergency.phase = 'called'; emergency.at = Date.now();
    updateAlert(emergency.alertId, '911 was called. Call her now.');
    console.warn(`[pipeline] EMERGENCY: 911 call placed (simulated) for "${emergency.text.slice(0, 80)}"`);
    await this.announce(EMERGENCY_CALLING, 'alert');
  }
  private stopEmergency(): ReplyPlan {
    const emergency = this.emergency!;
    clearTimeout(emergency.timer);
    emergency.phase = 'stopped'; emergency.at = Date.now();
    updateAlert(emergency.alertId, 'She stopped the 911 call herself. Call her now.');
    console.warn('[pipeline] EMERGENCY: the elder stopped the 911 call');
    return { text: EMERGENCY_STOPPED, emotion: 'worried' };
  }

  reset(): void {
    this.generation++;
    if (this.latest) this.abandon(this.latest, 'reset');
    if (this.running) this.abandon(this.running, 'reset');
    this.latest = null; this.running = null;
    if (this.emergency?.timer) clearTimeout(this.emergency.timer);
    this.emergency = null;
    this.pending = null; this.awaitingName = false; this.noteFor = null; this.lastScam = null;
    this.chatRounds = 0; this.history = []; this.queue = Promise.resolve();
    this.mic = { speechAt: 0, endAt: 0 };
    state.reset();
  }
  /** For /api/health: what the conversation is doing right now. */
  status(): PipelineStatus {
    const job = this.running ?? (this.latest?.alive ? this.latest : null);
    return { state: state.current, turn: job ? { id: job.id, source: job.source, stage: job.stage, stage_ms: Date.now() - job.stageAt, text: job.text.slice(0, 80) } : null,
      emergency: this.emergency?.phase ?? null };
  }
  /** The iPad uploads mic chunks only while the elder is talking (`speech=1`) and marks the last chunk of a sentence `end=1`. */
  noteMic(kind: 'speech' | 'end'): void { this.mic[kind === 'speech' ? 'speechAt' : 'endAt'] = Date.now(); }
  private elderTalking(at = Date.now()): boolean { return this.mic.speechAt > this.mic.endAt && at - this.mic.speechAt < 1_500; }
  /** A sentence end reached the mic after this turn's text arrived: Deepgram's final for it is on its way. */
  private finalPending(job: Job, at = Date.now()): boolean { return this.mic.endAt > job.arrivedAt && at - this.mic.endAt < 1_500; }

  handleUtterance(text: string, source: Source): Promise<UtteranceResult> {
    const clean = text.trim();
    const version = this.generation;
    const previous = this.continuedTurn(source, version);
    const job: Job = {
      id: ++this.seq, text: previous ? `${previous.text} ${clean}` : clean,
      display: previous && !previous.displayed ? `${previous.display} ${clean}` : clean, displayed: false,
      source, version, alive: true, stage: 'queued', stageAt: Date.now(), arrivedAt: Date.now(), claudeMs: 0,
      controller: new AbortController(), historyEntry: null, consumedNote: null,
    };
    if (previous) this.abandon(previous, `the sentence went on; turn #${job.id} takes the joined text`);
    this.latest = job;
    const run = this.queue.then(() => this.run(job));
    this.queue = run.catch(() => {});
    return run;
  }
  /** The previous voice turn, when it is still unanswered and this voice fragment is the rest of the same sentence. */
  private continuedTurn(source: Source, version: number): Job | null {
    const previous = this.latest;
    if (source !== 'voice' || !previous || !previous.alive || previous.source !== 'voice' || previous.version !== version) return null;
    return JOINABLE.has(previous.stage) ? previous : null;
  }
  private dead(job: Job): boolean { return !job.alive || job.version !== this.generation; }
  private setStage(job: Job, stage: Stage): void { job.stage = stage; job.stageAt = Date.now(); job.watchdog?.(); }
  private abandon(job: Job, why: string): void {
    if (!job.alive) return;
    job.alive = false;
    job.controller.abort();
    if (job.historyEntry) this.history = this.history.filter(entry => entry !== job.historyEntry);
    if (job.consumedNote && !this.noteFor) this.noteFor = job.consumedNote;
    console.info(`[pipeline] turn #${job.id} dropped while ${job.stage}: ${why}`);
  }
  private silent(): UtteranceResult { return { reply_text: '', audio_url: null, state: state.current }; }

  /** One turn with a watchdog: whatever stalls inside, the queue moves on and the elder hears something. */
  private async run(job: Job): Promise<UtteranceResult> {
    if (this.dead(job)) return this.silent();
    this.running = job;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expire!: (result: Promise<UtteranceResult>) => void;
    const watchdog = new Promise<UtteranceResult>(resolve => { expire = resolve; });
    job.watchdog = () => {
      clearTimeout(timer);
      timer = setTimeout(() => expire(this.release(job)), this.timeouts.stage); // ref'd: part of an in-flight turn
    };
    job.watchdog();
    try { return await Promise.race([this.attempt(job), watchdog]); }
    finally {
      clearTimeout(timer); job.watchdog = undefined; job.alive = false; job.stage = 'done';
      if (this.running === job) this.running = null;
    }
  }
  private async attempt(job: Job): Promise<UtteranceResult> {
    try { return await this.process(job); }
    catch (error) {
      if (this.dead(job)) return this.silent();
      console.warn(`[pipeline] turn #${job.id} failed while ${job.stage} (${error instanceof Error ? error.message : 'error'}); using spoken fallback`);
      this.pending = null;
      try { return await this.respond({ text: FALLBACK_REPLY, emotion: 'worried' }, job); }
      catch { state.recover(); return this.silent(); }
    }
  }
  /** The watchdog fired: drop the turn, apologise once, and reopen the listening window. */
  private async release(job: Job): Promise<UtteranceResult> {
    console.warn(`[pipeline] turn #${job.id} made no progress for ${this.timeouts.stage} ms while ${job.stage} ("${job.text.slice(0, 60)}"); releasing the conversation`);
    const current = job.alive && job.version === this.generation;
    this.abandon(job, 'watchdog');
    if (!current) return this.silent();
    this.pending = null;
    const apology: Job = { ...job, alive: true, controller: new AbortController(), watchdog: undefined, historyEntry: null, consumedNote: null };
    try { return await this.respond({ text: FALLBACK_REPLY, emotion: 'worried' }, apology); }
    catch { state.recover(); return this.silent(); }
    finally { apology.alive = false; }
  }
  /** Resolve with `fallback()` when `work` neither settles in time nor succeeds; a stuck provider never stalls a turn. */
  private bounded<T>(label: string, work: () => Promise<T>, fallback: () => T): Promise<T> {
    return new Promise<T>(resolve => {
      const timer = setTimeout(() => { console.warn(`[pipeline] ${label} gave nothing back after ${this.timeouts.step} ms; going on without it`); resolve(fallback()); }, this.timeouts.step);
      Promise.resolve().then(work).then(
        value => { clearTimeout(timer); resolve(value); },
        error => { clearTimeout(timer); console.warn(`[pipeline] ${label} failed (${error instanceof Error ? error.message : 'error'})`); resolve(fallback()); },
      );
    });
  }
  /** The elder is still talking (or just stopped and Deepgram's final is due): wait for the rest of the sentence. */
  private async hold(job: Job): Promise<void> {
    this.setStage(job, 'holding');
    const started = Date.now();
    while (!this.dead(job) && Date.now() - started < this.timeouts.hold) {
      const at = Date.now();
      if (!this.elderTalking(at) && !this.finalPending(job, at)) return;
      await delay(50);
    }
  }
  private async decide(job: Job, context: Context): Promise<Decision> {
    this.setStage(job, 'thinking');
    const started = Date.now();
    const decision = await this.bounded(`turn #${job.id} Claude`, () => this.dependencies.decide(job.text, context, job.controller.signal), fallbackDecision);
    job.claudeMs = Date.now() - started;
    // Claude answered, but the elder went on talking meanwhile: let the rest of the sentence replace this turn.
    if (!this.dead(job) && job.source === 'voice' && (this.elderTalking() || this.finalPending(job))) await this.hold(job);
    return decision;
  }

  private async respond(plan: ReplyPlan, job: Job): Promise<UtteranceResult> {
    this.setStage(job, 'responding');
    const started = Date.now();
    const audio_url = await this.bounded(`turn #${job.id} TTS`, () => this.dependencies.synthesize(plan.text), () => null);
    if (this.dead(job)) return this.silent();
    if (plan.card) toElder({ type: 'card', ...plan.card });
    if (plan.order) toElder({ type: 'order', ...plan.order });
    state.speak(plan.emotion);
    toElder({ type: 'transcript', role: 'ai', text: plan.text });
    toElder({ type: 'speak', text: plan.text, audio_url });
    if (plan.scamText) {
      const alert = createAlert('red', 7, 'Check on Mom', `Milo blocked a possible scam request: ${plan.scamText}`);
      this.noteFor = alert.id; this.lastScam = { id: alert.id, at: Date.now() };
    }
    this.history.push({ role: 'assistant', content: plan.text });
    this.history = this.history.slice(-8);
    if (plan.onSpoken) { const onSpoken = plan.onSpoken; void state.waitForSpeech().then(onSpoken); }
    this.setStage(job, 'done');
    console.info(`[pipeline] turn #${job.id} -> ${plan.emotion} after ${Date.now() - job.arrivedAt} ms (Claude ${job.claudeMs} ms, TTS ${Date.now() - started} ms)`);
    return { reply_text: plan.text, audio_url, state: state.current, ...(plan.card ? { card: plan.card } : {}), ...(plan.order ? { order: plan.order } : {}) };
  }
  /** Something real she wants that the shelf does not carry yet: Milo takes on the sourcing; the family only gets a wish note. */
  private wish(text: string): ReplyPlan {
    createAlert('normal', null, 'A new wish', `She asked for something that is not on her shelf yet: "${text.trim()}". Milo is looking for a trusted option; you can also add one to her shelf.`);
    return { text: "I don't have that on my shelf yet. Let me find a trusted one for you; I'll have it ready by tomorrow.", emotion: 'happy' };
  }
  private scam(text: string): ReplyPlan {
    this.pending = null;
    return { text: "That sounds like a scam; I'll let your daughter know, okay?", emotion: 'alert', scamText: text };
  }
  private offer(productId: string | null, text: string): ReplyPlan {
    this.pending = null;
    const result = risk.check(productId, text);
    if (result.reason === 'scam') return this.scam(text);
    const product = productId ? get('products', productId) : undefined;
    if (!product) return this.wish(text);
    if (!result.ok) {
      if (result.alternative) {
        this.pending = { productId: result.alternative.id, priceCents: result.alternative.price_cents };
        return {
          text: `I can't order that item; would you like ${result.alternative.name} for $${(result.alternative.price_cents / 100).toFixed(2)} instead?`,
          emotion: 'alert', card: { product, alternative: result.alternative },
        };
      }
      return { text: "I can't order that item because it did not pass our safety check.", emotion: 'alert', card: { product } };
    }
    this.pending = { productId: product.id, priceCents: product.price_cents };
    return { text: `${product.name} is $${(product.price_cents / 100).toFixed(2)}; would you like me to order it?`, emotion: 'happy', card: { product } };
  }
  private async confirm(job: Job): Promise<ReplyPlan> {
    const pending = this.pending;
    this.pending = null; // Consume before awaiting payment; duplicate yes cannot charge twice.
    if (!pending) return { text: 'What would you like me to order?', emotion: 'worried' };
    const product = get('products', pending.productId);
    if (!product || !risk.check(product.id, '').ok) return this.offer(pending.productId, '');
    if (product.price_cents !== pending.priceCents) return this.offer(product.id, '');
    const created_at = now();
    const delivery = new Date(created_at);
    delivery.setUTCDate(delivery.getUTCDate() + 5);
    const draft: Order = { id: `ord_${randomUUID()}`, product_id: product.id, price_cents: product.price_cents,
      status: 'simulated_paid', block_reason: null, created_at, deliver_on: delivery.toISOString().slice(0, 10), received: false };
    let order: Order | null;
    try { order = await placeOrder(draft, () => !this.dead(job)); }
    catch (error) {
      if (error instanceof VisaSandboxError) return {
        text: "Your order wasn't placed. Please ask for the item again when you're ready.", emotion: 'worried',
      };
      throw error;
    }
    if (!order) return { text: '', emotion: 'worried' };
    registerOrder(order); // D schedules the delivery question and, once received, the dose reminders.
    const text = order.status === 'simulated_paid'
      ? "Your simulated order is placed; I'll let you know when it arrives."
      : "Your order is placed; I'll let you know when it arrives.";
    return { text, emotion: 'happy', order };
  }
  private async process(job: Job): Promise<UtteranceResult> {
    this.setStage(job, 'waiting');
    await state.waitForSpeech();
    if (this.dead(job) || !job.text) return this.silent();
    const settings = getSettings();
    toElder({ type: 'transcript', role: 'grandma', text: job.display }); job.displayed = true;
    if (state.current === 'idle') {
      this.pending = null; this.chatRounds = 0; this.history = [];
      if (job.source === 'voice' && !matchesWakeName(job.text, settings.wake_name)) return this.silent();
      state.wake(); // Keyboard is an explicit interaction, so it opens the window.
    } else if (state.current !== 'thinking') state.listen(); // a joined sentence keeps the thinking face it already shows
    // The elder paused after the name ("Milo." ... "the purple bottle is empty"): keep listening, the request follows.
    if (job.source === 'voice' && settings.wake_name && isOnlyWakeName(job.text, settings.wake_name)) return this.silent();
    // Still talking when the first half arrived: do not ask Claude about half a sentence.
    if (job.source === 'voice' && this.elderTalking()) { await this.hold(job); if (this.dead(job)) return this.silent(); }
    this.setStage(job, 'thinking');
    state.think();
    const text = job.text;
    const context: Context = { products: shortlist(text, all('products'), this.pending?.productId ?? null), settings, chatRounds: this.chatRounds,
      pendingProductId: this.pending?.productId || null, awaitingName: this.awaitingName, history: [...this.history] };
    job.historyEntry = { role: 'user', content: text };
    this.history.push(job.historyEntry);

    // Emergency outranks everything: the countdown only listens for "stop", and serious words start it without Claude.
    const normalized = normalize(text);
    const emergency = this.emergency;
    if (emergency && (emergency.phase === 'warning' || emergency.phase === 'countdown')) {
      if (STOP_911.test(normalized)) return this.respond(this.stopEmergency(), job);
      state.listen(); return this.silent(); // more symptoms are not a reason to stop
    }
    if (emergency?.phase === 'called' && Date.now() - emergency.at < 90_000 && risk.isEmergency(text)) {
      return this.respond({ text: EMERGENCY_ONGOING, emotion: 'alert' }, job);
    }
    if (risk.isEmergency(text)) return this.respond(this.startEmergency(text), job);

    // The rest of a scam sentence that STT split in two ("...someone called." / "They said buy a gift card today"):
    // one warning and one red card are enough, so fold the second half into the same alert and keep listening.
    if (this.lastScam && Date.now() - this.lastScam.at < 15_000 && risk.isScam(text)) {
      extendAlert(this.lastScam.id, text); state.listen();
      return this.silent();
    }
    // The next answer to the notification question is a note, never purchase consent. A new shopping request
    // (or another scam) right after the warning is routed normally instead of being swallowed as the note.
    let decided: Decision | null = null;
    if (this.noteFor) {
      const alertId = this.noteFor; this.noteFor = null; job.consumedNote = alertId;
      if (!risk.isScam(text)) {
        decided = await this.decide(job, context);
        if (this.dead(job)) return this.silent();
        if (!['refill', 'new_request', 'risky_product', 'scam'].includes(decided.intent)) {
          saveGrandmaNote(alertId, text);
          return this.respond({ text: "Thank you; I've added your words to the message for your daughter.", emotion: 'worried' }, job);
        }
      }
    }
    // Answers to D's prompts (got the parcel? start reminders? taken it?) never go to the shopping router.
    const memoryReply = memoryAnswer(text);
    if (memoryReply !== null) {
      if (!memoryReply) state.listen(); // D recorded it silently; keep the window open
      return { reply_text: memoryReply, audio_url: null, state: state.current };
    }
    // Local safety rules still work when Claude is unavailable.
    if (risk.isScam(text)) return this.respond(this.scam(text), job);
    if (!settings.wake_name && !this.awaitingName) {
      this.awaitingName = true;
      return this.respond({ text: "I'm your AI shopping helper; what would you like to call me?", emotion: 'happy' }, job);
    }
    if (settings.wake_name) this.awaitingName = false;
    if (this.awaitingName) {
      const name = extractWakeName(text);
      if (name) {
        saveSettings({ ...getSettings(), wake_name: name }); this.awaitingName = false;
        return this.respond({ text: `You can call me ${name}; what would you like to shop for?`, emotion: 'happy' }, job);
      }
    }
    let decision: Decision;
    if (decided) decision = decided;
    else if (this.pending && /^(yes|yes please|yeah|yep|okay|ok|sure|please do|order it|go ahead|yes order it)$/.test(normalized)) {
      decision = { intent: 'confirm_yes', product_id: null, reply: '', elder_name: null };
    } else if (this.pending && /^(no|no thanks|no thank you|cancel|cancel it|never mind|nope)$/.test(normalized)) {
      decision = { intent: 'confirm_no', product_id: null, reply: '', elder_name: null };
    } else decision = await this.decide(job, context);
    if (this.dead(job)) return this.silent();
    this.setStage(job, 'responding'); // decided: from here on a new fragment is a new turn, never a replacement
    let plan: ReplyPlan;
    switch (decision.intent) {
      case 'scam': plan = this.scam(text); break;
      case 'emergency': plan = this.startEmergency(text); break;
      case 'unwell': {
        // Everyday discomfort: stay with her, no shelf, no disclaimer loop. Claude's sentence, unless it slipped into refusing.
        this.pending = null;
        const warm = decision.reply !== FALLBACK_REPLY && !/medical advice|can'?t help|cannot help|unable to help/i.test(decision.reply);
        plan = { text: warm ? decision.reply : "I'm sorry you're not feeling well. I'm right here with you; tell me if anything feels worse.", emotion: 'worried' };
        break;
      }
      case 'refill': case 'new_request': case 'risky_product':
        this.chatRounds = 0; plan = this.offer(decision.product_id, text); break;
      case 'confirm_yes':
        plan = /\b(if|unless|maybe|not|don't)\b/i.test(text)
          ? { text: 'Would you like me to place this order?', emotion: 'worried' }
          : await this.confirm(job);
        break;
      case 'confirm_no': this.pending = null; plan = { text: "Okay, I won't order it.", emotion: 'happy' }; break;
      case 'name_answer': {
        const name = this.awaitingName && decision.elder_name ? extractWakeName(decision.elder_name) : null;
        if (name) { saveSettings({ ...getSettings(), wake_name: name }); this.awaitingName = false; }
        plan = { text: name ? `You can call me ${name}; how can I help you shop?` : 'What would you like to call me?', emotion: 'happy' };
        break;
      }
      default: {
        this.pending = null;
        if (decision.reply !== FALLBACK_REPLY) this.chatRounds++;
        plan = { text: decision.reply === FALLBACK_REPLY ? FALLBACK_REPLY : this.chatRounds > 2 ? 'What would you like to find on our shopping shelf?' : decision.reply, emotion: decision.reply === FALLBACK_REPLY ? 'worried' : 'happy' };
        // Refill note from D: ask once, in passing, and let a plain "yes" order it.
        const refill = decision.reply === FALLBACK_REPLY ? null : takeRefillSuggestion();
        if (refill) {
          const product = get('products', refill.productId);
          if (product && risk.check(product.id, '').ok) {
            this.pending = { productId: product.id, priceCents: product.price_cents };
            plan = { text: `${plan.text} ${refill.text}`, emotion: 'happy', card: { product } };
          }
        }
      }
    }
    return this.respond(plan, job);
  }
}
export const pipeline = new ConversationPipeline();
export const handleUtterance = (text: string, source: Source): Promise<UtteranceResult> => pipeline.handleUtterance(text, source);
