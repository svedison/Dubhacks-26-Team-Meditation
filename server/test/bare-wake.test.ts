// "Milo" on its own must wake the device from standby: the interim opens the window before any final arrives, a final
// that is only the name keeps it open without a reply, and the conversation starts fresh either way.
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import type { WebSocket } from 'ws';
import type { Decision } from '../src/llm.js';
import type { ServerEvent } from '../src/contracts.js';

process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.MINIMAX_API_KEY = '';
process.env.DEEPGRAM_API_KEY = '';
const db = await import('../src/db.js');
const clock = await import('../src/clock.js');
const { ConversationPipeline, pipeline } = await import('../src/pipeline.js');
const { acknowledgeSpoke, addClient } = await import('../src/bus.js');
const { state } = await import('../src/state.js');

const chat = (reply = 'How can I help?'): Decision => ({ intent: 'chat', product_id: null, reply, elder_name: null });
const events: ServerEvent[] = [];
const elder = { readyState: 1, send(json: string) { events.push(JSON.parse(json) as ServerEvent); } } as unknown as WebSocket;
let detach = () => {};
beforeEach(() => { pipeline.reset(); db.resetDatabase(); clock.resetClock(); events.length = 0; detach = addClient(elder, 'elder'); });
afterEach(() => { detach(); });
after(() => { pipeline.reset(); clock.stopClock(); db.sqlite.close(); });
const states = () => events.flatMap(e => e.type === 'state' ? [e.state] : []);
const captions = () => events.flatMap(e => e.type === 'transcript' && e.role === 'grandma' ? [e.text] : []);

test('the interim "Milo" wakes the device at once; the final keeps listening without a reply; the request follows without the name', async () => {
  const calls: string[] = [];
  const flow = new ConversationPipeline({ decide: async text => { calls.push(text); return chat(); }, synthesize: async () => null });
  flow.heardInterim('the purple bottle'); // room chatter: still asleep
  assert.equal(state.current, 'idle'); assert.deepEqual(states(), []);
  flow.heardInterim('Milo');
  assert.equal(state.current, 'listening'); assert.deepEqual(states(), ['listening']);
  flow.heardInterim('Milo'); // the next hypothesis of the same word changes nothing
  assert.deepEqual(states(), ['listening']);
  const bare = await flow.handleUtterance('Milo.', 'voice');
  assert.equal(bare.reply_text, ''); assert.equal(state.current, 'listening'); assert.equal(calls.length, 0);
  assert.deepEqual(captions(), ['Milo.']);
  assert.ok(!events.some(e => e.type === 'speak'));
  const next = await flow.handleUtterance('the purple bottle is empty', 'voice');
  assert.equal(next.reply_text, 'How can I help?'); assert.deepEqual(calls, ['the purple bottle is empty']);
  const heard = flow.recentlyHeard();
  assert.deepEqual(heard.map(h => [h.text, h.woke, h.interim ?? false]), [['Milo', true, true], ['Milo.', null, false], ['the purple bottle is empty', null, false]]);
  flow.reset();
});
test('a bare "Milo" whose final arrives with no interim before it still wakes the device silently', async () => {
  const calls: string[] = [];
  const flow = new ConversationPipeline({ decide: async text => { calls.push(text); return chat(); }, synthesize: async () => null });
  for (const heard of ['Milo', 'Milo.', 'Hey Milo!', 'MILO']) {
    state.reset(); events.length = 0;
    const result = await flow.handleUtterance(heard, 'voice');
    assert.equal(result.reply_text, '', heard); assert.equal(state.current, 'listening', heard);
    assert.deepEqual(states(), ['listening'], heard);
  }
  assert.deepEqual(calls, []);
  flow.reset();
});
test('an interim is never a wake while the device is talking or already awake, and nothing wakes without a name to call', async () => {
  const flow = new ConversationPipeline({ decide: async () => chat(), synthesize: async () => null });
  await flow.handleUtterance('Milo, hello there', 'voice');
  assert.equal(state.current, 'happy'); // playing
  events.length = 0;
  flow.heardInterim('Milo');
  assert.deepEqual(states(), []); assert.equal(state.current, 'happy');
  acknowledgeSpoke(); await state.waitForSpeech();
  assert.equal(state.current, 'listening'); events.length = 0;
  flow.heardInterim('Milo');
  assert.deepEqual(states(), []); // already listening: no second state event
  state.reset(); events.length = 0;
  db.saveSettings({ ...db.getSettings(), wake_name: '' }); // first conversation: the name is still to be chosen
  flow.heardInterim('hello');
  assert.equal(state.current, 'idle');
  db.saveSettings({ ...db.getSettings(), wake_name: 'Milo' });
  flow.reset();
});
test('waking on an interim starts a fresh conversation: an offer left from before standby is not confirmed by the new "yes"', async () => {
  const calls: string[] = [];
  const flow = new ConversationPipeline({
    decide: async text => { calls.push(text); return text.includes('purple') ? { intent: 'refill', product_id: 'calcium-120', reply: '', elder_name: null } : chat(); },
    synthesize: async () => null,
  });
  const offer = await flow.handleUtterance('Milo, I want the purple bottle', 'voice');
  assert.match(offer.reply_text, /would you like me to order it\?/);
  acknowledgeSpoke(); await state.waitForSpeech();
  state.reset(); // the window closed: photo frame
  const orders = db.all('orders').length;
  flow.heardInterim('Milo');
  assert.equal(state.current, 'listening');
  const yes = await flow.handleUtterance('yes', 'voice');
  assert.equal(yes.order, undefined); assert.equal(yes.reply_text, 'How can I help?');
  assert.equal(db.all('orders').length, orders);
  assert.deepEqual(calls.at(-1), 'yes'); // routed to Claude as a new sentence, not as consent
  flow.reset();
});
