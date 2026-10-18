import { randomUUID } from 'node:crypto';
import { all, get, getSettings, saveSettings } from './db.js';
import { now } from './clock.js';
import { toElder } from './bus.js';
import { state } from './state.js';
import { extractWakeName, isOnlyWakeName, matchesWakeName, normalize } from './wake.js';
import { decide, FALLBACK_REPLY, type Context, type Decision } from './llm.js';
import { synthesize } from './tts.js';
import * as risk from './modules/risk.js';
import { placeOrder } from './modules/orders.js';
import { VisaSandboxError } from './modules/visa-sandbox.js';
import { createAlert, extendAlert, saveGrandmaNote, handleAnswer as memoryAnswer, registerOrder, setSpeaker, takeRefillSuggestion, type ProactiveSpeech } from './modules/memory.js';
import type { Card, Emotion, Order, Source, UtteranceResult } from './contracts.js';

interface ReplyPlan { text: string; emotion: Emotion; card?: Card; order?: Order; scamText?: string }
export interface PipelineDependencies { decide: typeof decide; synthesize: typeof synthesize }
export class ConversationPipeline {
  private pending: { productId: string; priceCents: number } | null = null;
  private awaitingName = false;
  private noteFor: string | null = null;
  private lastScam: { id: string; at: number } | null = null;
  private chatRounds = 0;
  private history: Context['history'] = [];
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private dependencies: PipelineDependencies = { decide, synthesize }) {
    // D's Memory module speaks on its own (delivery / dose / reminder prompts); serialise it with normal replies.
    setSpeaker(event => this.enqueue(() => this.proactive(event)));
  }
  /** Run `job` after the utterance currently being handled (if any). */
  enqueue(job: () => Promise<unknown>): void {
    const version = this.generation;
    this.queue = this.queue.then(() => (version === this.generation ? job() : undefined)).catch(() => {});
  }
  private async proactive(event: ProactiveSpeech): Promise<void> {
    await state.waitForSpeech();
    let audio_url: string | null = null;
    try { audio_url = await this.dependencies.synthesize(event.text); } catch { /* Browser fallback. */ }
    if (state.current === 'idle') state.wake(); // the device starts the conversation, no wake word needed for the answer
    state.speak('happy');
    toElder({ type: 'transcript', role: 'ai', text: event.text });
    toElder(event.type === 'ask' ? { type: 'ask', kind: event.kind ?? 'reminder', text: event.text, audio_url } : { type: 'speak', text: event.text, audio_url });
    this.history.push({ role: 'assistant', content: event.text });
    this.history = this.history.slice(-8);
  }

  reset(): void {
    this.generation++;
    this.pending = null; this.awaitingName = false; this.noteFor = null; this.lastScam = null;
    this.chatRounds = 0; this.history = []; this.queue = Promise.resolve();
    state.reset();
  }
  handleUtterance(text: string, source: Source): Promise<UtteranceResult> {
    const version = this.generation;
    const job = this.queue.then(async () => {
      try { return await this.process(text.trim(), source, version); }
      catch {
        if (version !== this.generation) return this.silent();
        console.warn('Conversation step failed; using spoken fallback');
        this.pending = null;
        return this.respond({ text: FALLBACK_REPLY, emotion: 'worried' }, version);
      }
    });
    this.queue = job.catch(() => {});
    return job;
  }
  private silent(): UtteranceResult { return { reply_text: '', audio_url: null, state: state.current }; }
  private async respond(plan: ReplyPlan, version: number): Promise<UtteranceResult> {
    let audio_url: string | null = null;
    try { audio_url = await this.dependencies.synthesize(plan.text); } catch { /* Browser fallback. */ }
    if (version !== this.generation) return this.silent();
    if (plan.card) toElder({ type: 'card', ...plan.card });
    state.speak(plan.emotion);
    toElder({ type: 'transcript', role: 'ai', text: plan.text });
    toElder({ type: 'speak', text: plan.text, audio_url });
    if (plan.scamText) {
      const alert = createAlert('red', 7, 'Check on Mom', `Milo blocked a possible scam request: ${plan.scamText}`);
      this.noteFor = alert.id; this.lastScam = { id: alert.id, at: Date.now() };
    }
    this.history.push({ role: 'assistant', content: plan.text });
    this.history = this.history.slice(-8);
    return { reply_text: plan.text, audio_url, state: state.current, ...(plan.card ? { card: plan.card } : {}), ...(plan.order ? { order: plan.order } : {}) };
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
    if (!product) return { text: "I can only order from our trusted shelf; what else would you like?", emotion: 'alert' };
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
  private async confirm(version: number): Promise<ReplyPlan> {
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
    try { order = await placeOrder(draft, () => version === this.generation); }
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
  private async process(text: string, source: Source, version: number): Promise<UtteranceResult> {
    await state.waitForSpeech();
    if (version !== this.generation || !text) return this.silent();
    const settings = getSettings();
    toElder({ type: 'transcript', role: 'grandma', text });
    if (state.current === 'idle') {
      this.pending = null; this.chatRounds = 0; this.history = [];
      if (source === 'voice' && !matchesWakeName(text, settings.wake_name)) return this.silent();
      state.wake(); // Keyboard is an explicit interaction, so it opens the window.
    } else state.listen();
    // The elder paused after the name ("Milo." ... "the purple bottle is empty"): keep listening, the request follows.
    if (source === 'voice' && settings.wake_name && isOnlyWakeName(text, settings.wake_name)) return this.silent();
    state.think();
    const context: Context = { products: all('products'), settings, chatRounds: this.chatRounds,
      pendingProductId: this.pending?.productId || null, awaitingName: this.awaitingName, history: [...this.history] };
    this.history.push({ role: 'user', content: text });

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
      const alertId = this.noteFor; this.noteFor = null;
      if (!risk.isScam(text)) {
        decided = await this.dependencies.decide(text, context);
        if (version !== this.generation) return this.silent();
        if (!['refill', 'new_request', 'risky_product', 'scam'].includes(decided.intent)) {
          saveGrandmaNote(alertId, text);
          return this.respond({ text: "Thank you; I've added your words to the message for your daughter.", emotion: 'worried' }, version);
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
    if (risk.isScam(text)) return this.respond(this.scam(text), version);
    if (!settings.wake_name && !this.awaitingName) {
      this.awaitingName = true;
      return this.respond({ text: "I'm your AI shopping helper; what would you like to call me?", emotion: 'happy' }, version);
    }
    if (settings.wake_name) this.awaitingName = false;
    if (this.awaitingName) {
      const name = extractWakeName(text);
      if (name) {
        saveSettings({ ...getSettings(), wake_name: name }); this.awaitingName = false;
        return this.respond({ text: `You can call me ${name}; what would you like to shop for?`, emotion: 'happy' }, version);
      }
    }
    const normalized = normalize(text);
    let decision: Decision;
    if (decided) decision = decided;
    else if (this.pending && /^(yes|yes please|yeah|yep|okay|ok|sure|please do|order it|go ahead|yes order it)$/.test(normalized)) {
      decision = { intent: 'confirm_yes', product_id: null, reply: '', elder_name: null };
    } else if (this.pending && /^(no|no thanks|no thank you|cancel|cancel it|never mind|nope)$/.test(normalized)) {
      decision = { intent: 'confirm_no', product_id: null, reply: '', elder_name: null };
    } else decision = await this.dependencies.decide(text, context);
    if (version !== this.generation) return this.silent();
    let plan: ReplyPlan;
    switch (decision.intent) {
      case 'scam': plan = this.scam(text); break;
      case 'refill': case 'new_request': case 'risky_product':
        this.chatRounds = 0; plan = this.offer(decision.product_id, text); break;
      case 'confirm_yes':
        plan = /\b(if|unless|maybe|not|don't)\b/i.test(text)
          ? { text: 'Would you like me to place this order?', emotion: 'worried' }
          : await this.confirm(version);
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
    return this.respond(plan, version);
  }
}
export const pipeline = new ConversationPipeline();
export const handleUtterance = (text: string, source: Source): Promise<UtteranceResult> => pipeline.handleUtterance(text, source);
