// "My chest hurts" is not a shopping request and not a chat: Milo acts (911 countdown the elder can stop) and the
// daughter's red card follows the outcome: only 911 actually called tells her; if the elder says stop, her wish wins.
// Everyday "I'm not feeling well" gets a warm sentence, never a shelf pitch.
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { WebSocket } from 'ws';
import type { Decision } from '../src/llm.js';
import type { Alert, ServerEvent } from '../src/contracts.js';

process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.MINIMAX_API_KEY = '';
process.env.DEEPGRAM_API_KEY = '';
const db = await import('../src/db.js');
const clock = await import('../src/clock.js');
const risk = await import('../src/modules/risk.js');
const { ConversationPipeline, pipeline } = await import('../src/pipeline.js');
const { acknowledgeSpoke, addClient } = await import('../src/bus.js');
const { state } = await import('../src/state.js');

const elderEvents: ServerEvent[] = [], guardianEvents: ServerEvent[] = [];
const socket = (sink: ServerEvent[]) => ({ readyState: 1, send(json: string) { sink.push(JSON.parse(json) as ServerEvent); } } as unknown as WebSocket);
let detach: (() => void)[] = [];
beforeEach(() => {
  pipeline.reset(); db.resetDatabase(); clock.resetClock(); elderEvents.length = 0; guardianEvents.length = 0;
  detach = [addClient(socket(elderEvents), 'elder'), addClient(socket(guardianEvents), 'guardian')];
});
afterEach(() => { for (const off of detach) off(); });
after(() => { pipeline.reset(); clock.stopClock(); db.sqlite.close(); });
const alerts = () => guardianEvents.filter((e): e is ServerEvent & Alert => e.type === 'alert');
const spoke = async () => { acknowledgeSpoke(); await state.waitForSpeech(); };
const noClaude = async (): Promise<Decision> => { throw new Error('Claude must not be asked during an emergency'); };

test('local rule: warning, 911 after the countdown sends the red card, no second countdown while help is coming', async () => {
  const flow = new ConversationPipeline({ decide: noClaude, synthesize: async () => null }, { countdown: 60 });
  const result = await flow.handleUtterance('I feel dizzy and my chest hurts.', 'keyboard');
  assert.match(result.reply_text, /calling 911 in five seconds/i);
  assert.equal(state.current, 'alert');
  assert.equal(alerts().length, 0); // the card waits for the outcome
  assert.equal(db.all('alerts').length, 0);
  assert.equal(flow.status().emergency, 'warning');
  await spoke(); // the warning has been heard; now she has `countdown` ms
  await delay(5); assert.equal(flow.status().emergency, 'countdown');
  await delay(150);
  assert.equal(flow.status().emergency, 'called');
  assert.ok(elderEvents.some(e => e.type === 'speak' && /^Calling 911 now/.test(e.text)));
  assert.equal(state.current, 'alert');
  assert.equal(alerts().length, 1);
  assert.equal(alerts()[0].level, 'red'); assert.equal(alerts()[0].title, 'Emergency');
  assert.equal(alerts()[0].grandma_note, 'I feel dizzy and my chest hurts.');
  assert.match(alerts()[0].body, /911 was called/);
  assert.equal(db.all('alerts').length, 1);
  await spoke();
  const again = await flow.handleUtterance('my chest hurts so much', 'keyboard');
  assert.equal(again.reply_text, 'Help is on the way. Stay with me.');
  assert.equal(db.all('alerts').length, 1);
  flow.reset();
});
test('"stop" during the countdown cancels the call; other words do not; the family is never told', async () => {
  const flow = new ConversationPipeline({ decide: noClaude, synthesize: async () => null }, { countdown: 250 });
  await flow.handleUtterance('I fell down in the kitchen and my hip hurts.', 'keyboard');
  await spoke();
  assert.equal(flow.status().emergency, 'countdown');
  const more = await flow.handleUtterance('it hurts so much', 'keyboard');
  assert.equal(more.reply_text, ''); assert.equal(state.current, 'listening'); assert.equal(flow.status().emergency, 'countdown');
  const stop = await flow.handleUtterance('Milo, stop! I am okay.', 'keyboard');
  assert.equal(stop.reply_text, "Okay, I won't call 911. I'm right here with you."); assert.equal(state.current, 'worried');
  assert.equal(flow.status().emergency, 'stopped');
  await delay(350); // the countdown would have fired by now
  assert.equal(elderEvents.some(e => e.type === 'speak' && /^Calling 911 now/.test(e.text)), false);
  assert.equal(alerts().length, 0); assert.equal(db.all('alerts').length, 0);
  flow.reset();
});
test('reset during the countdown cancels it', async () => {
  const flow = new ConversationPipeline({ decide: noClaude, synthesize: async () => null }, { countdown: 60 });
  await flow.handleUtterance("I can't breathe", 'keyboard');
  await spoke();
  flow.reset(); db.resetDatabase();
  await delay(120);
  assert.equal(flow.status().emergency, null);
  assert.equal(elderEvents.some(e => e.type === 'speak' && /^Calling 911 now/.test(e.text)), false);
});
test('Claude intents: emergency starts the countdown; unwell stays warm and never steers to the shelf', async () => {
  const decide = async (text: string): Promise<Decision> => text.includes('breathe')
    ? { intent: 'emergency', product_id: null, reply: 'x', elder_name: null }
    : { intent: 'unwell', product_id: null, reply: text.includes('third') ? "As an AI I can't give medical advice, please see a doctor." : "I'm sorry you're not feeling well; I'm right here with you.", elder_name: null };
  const flow = new ConversationPipeline({ decide, synthesize: async () => null }, { countdown: 60 });
  const replies: string[] = [];
  for (const text of ["I'm not feeling well today.", "I'm still not feeling well.", 'third time: still not well.']) {
    replies.push((await flow.handleUtterance(text, 'keyboard')).reply_text); assert.equal(state.current, 'worried'); await spoke();
  }
  assert.equal(replies[0], "I'm sorry you're not feeling well; I'm right here with you.");
  assert.match(replies[2], /I'm right here with you/); assert.doesNotMatch(replies[2], /medical advice/);
  assert.equal(replies.some(r => /shopping shelf/.test(r)), false);
  assert.equal(alerts().length, 0); // everyday discomfort does not page the daughter
  const warning = await flow.handleUtterance('I can hardly breathe', 'keyboard'); // not in the local rule; Claude decides
  assert.match(warning.reply_text, /calling 911/); assert.equal(flow.status().emergency, 'warning');
  assert.equal(alerts().length, 0); // the red card waits for the outcome of the countdown
  flow.reset();
});
test('the local rule knows the difference between now and a story, and "help me find calcium" is shopping', () => {
  for (const text of ["I can't breathe", 'my chest hurts', 'I fell down the stairs', 'she passed out', 'call 911', '救命', 'I think I am having a stroke']) {
    assert.equal(risk.isEmergency(text), true, text);
  }
  for (const text of ['My chest hurt last week but it is fine now', 'help me find the calcium', 'I need help with my order', 'the purple bottle is empty', 'yesterday I fell asleep early']) {
    assert.equal(risk.isEmergency(text), false, text);
  }
});
