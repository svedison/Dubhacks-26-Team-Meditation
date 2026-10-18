// A plain question from Milo is asked with a friendly face: "What would you like me to order?" and
// "Would you like me to place this order?" are not bad news, so the iPad must not show the worried face for them.
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import type { Decision } from '../src/llm.js';

process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = '';
process.env.MINIMAX_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.DEEPGRAM_API_KEY = '';
process.env.VISA_SANDBOX_PREFLIGHT = '0';
const db = await import('../src/db.js');
const clock = await import('../src/clock.js');
const { ConversationPipeline, pipeline } = await import('../src/pipeline.js');
const { acknowledgeSpoke } = await import('../src/bus.js');
const { state } = await import('../src/state.js');

beforeEach(() => { pipeline.reset(); db.resetDatabase(); clock.resetClock(); });
after(() => { pipeline.reset(); clock.stopClock(); db.sqlite.close(); });
const decision = (intent: Decision['intent'], product_id: string | null = null): Decision => ({ intent, product_id, reply: '', elder_name: null, quantity: null });
const spoke = async () => { acknowledgeSpoke(); await state.waitForSpeech(); };

test('a yes with nothing offered asks what to order, with the happy face', async () => {
  const flow = new ConversationPipeline({ decide: async () => decision('confirm_yes'), synthesize: async () => null });
  const reply = await flow.handleUtterance('Yes, please.', 'keyboard');
  assert.equal(reply.reply_text, 'What would you like me to order?');
  assert.equal(reply.state, 'happy');
  flow.reset();
});

test('a hedged yes asks again before ordering, with the happy face', async () => {
  const replies = [decision('new_request', 'tissues'), decision('confirm_yes')];
  const flow = new ConversationPipeline({ decide: async () => replies.shift()!, synthesize: async () => null });
  await flow.handleUtterance('Milo, I need tissues.', 'keyboard');
  await spoke();
  const reply = await flow.handleUtterance('Yes, maybe later.', 'keyboard');
  assert.equal(reply.reply_text, 'Would you like me to place this order?');
  assert.equal(reply.state, 'happy');
  assert.equal(reply.order, undefined);
  flow.reset();
});
