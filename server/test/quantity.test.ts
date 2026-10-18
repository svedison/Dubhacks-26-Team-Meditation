// "I want three boxes of tissues" orders three; "six bottles of calcium" is more than usual, so Milo asks why first and
// never orders more than the category cap; the family is told about bigger orders, never asked.
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import type { WebSocket } from 'ws';
import type { Decision } from '../src/llm.js';
import type { Alert, ServerEvent } from '../src/contracts.js';

process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = '';
process.env.MINIMAX_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.DEEPGRAM_API_KEY = '';
process.env.VISA_SANDBOX_PREFLIGHT = '0';
const db = await import('../src/db.js');
const clock = await import('../src/clock.js');
const risk = await import('../src/modules/risk.js');
const { parseQuantity, quantityLimits } = await import('../src/quantity.js');
const { ConversationPipeline, pipeline } = await import('../src/pipeline.js');
const { acknowledgeSpoke, addClient } = await import('../src/bus.js');
const { state } = await import('../src/state.js');
const { historicalOrder } = await import('../src/seed.js');

const guardianEvents: ServerEvent[] = [];
let detach = () => {};
beforeEach(() => { pipeline.reset(); db.resetDatabase(); clock.resetClock(); guardianEvents.length = 0;
  detach = addClient({ readyState: 1, send(json: string) { guardianEvents.push(JSON.parse(json) as ServerEvent); } } as unknown as WebSocket, 'guardian'); });
afterEach(() => { detach(); }); // one guardian socket per test, or every card is counted once per leftover socket
after(() => { pipeline.reset(); clock.stopClock(); db.sqlite.close(); });
const request = (product_id: string, quantity: number | null): Decision => ({ intent: 'new_request', product_id, reply: '', elder_name: null, quantity });
const chat = (reply: string): Decision => ({ intent: 'chat', product_id: null, reply, elder_name: null, quantity: null });
// D's anomaly rules may add their own cards (stock for 90+ days, etc.); these tests look at the quantity card only.
const alerts = () => guardianEvents.filter((e): e is ServerEvent & Alert => e.type === 'alert' && e.title === 'A bigger order than usual');
const spoke = async () => { acknowledgeSpoke(); await state.waitForSpeech(); };

test('quantity words and digits are read; sizes, strengths and percentages are not', () => {
  assert.equal(parseQuantity('I want three boxes of tissues'), 3);
  assert.equal(parseQuantity('Milo, get me 2 bottles of calcium'), 2);
  assert.equal(parseQuantity('a dozen eggs please'), null); // one carton: a size, not a count
  assert.equal(parseQuantity('a dozen packs of tissues'), 12);
  assert.equal(parseQuantity('half a dozen boxes of crackers'), 6);
  assert.equal(parseQuantity('a couple of apples'), 2);
  assert.equal(parseQuantity('two more packs of the same'), 2);
  assert.equal(parseQuantity('I want 2% milk'), null);
  assert.equal(parseQuantity('vitamin B12 and the 600 mg calcium'), null);
  assert.equal(parseQuantity('Nature Made vitamin C 1000 mg tablets'), null);
  assert.equal(parseQuantity('the purple bottle is empty'), null);
  assert.deepEqual(quantityLimits('supplement'), { ask: 2, max: 3 });
  assert.deepEqual(quantityLimits('food'), { ask: 6, max: 12 });
});
test('an ordinary quantity is ordered as said: total price, quantity on the card and on the order, no family card', async () => {
  const flow = new ConversationPipeline({ decide: async () => request('tissues', 3), synthesize: async () => null });
  const offer = await flow.handleUtterance('Milo, I want three boxes of tissues.', 'keyboard');
  assert.match(offer.reply_text, /^Three packs of .*Tissues.* come to \$26\.97; would you like me to order them\?$/);
  assert.equal(offer.card?.quantity, 3);
  await spoke();
  const done = await flow.handleUtterance('yes', 'keyboard');
  assert.equal(done.order?.quantity, 3); assert.equal(done.order?.price_cents, 2697);
  assert.match(done.reply_text, /^Your order is placed: three packs of .*Tissues.*, \$26\.97\. I'll let you know when it arrives\.$/);
  assert.equal(alerts().length, 0);
  assert.ok(db.all('orders').some(o => o.quantity === 3 && o.price_cents === 2697));
  flow.reset();
});
test('too many supplements: Milo asks why, caps at three, orders after the reason, and tells the family', async () => {
  const flow = new ConversationPipeline({ decide: async () => request('calcium-120', 6), synthesize: async () => null });
  const ask = await flow.handleUtterance('Milo, I want six bottles of calcium.', 'keyboard');
  assert.equal(ask.reply_text, 'Six packs of Calcium 600mg, 120 tablets is more than usual. Is there a reason you need that many?');
  assert.equal(ask.state, 'worried'); assert.equal(ask.card?.quantity, 6);
  await spoke();
  const bareYes = await flow.handleUtterance('Yes.', 'keyboard'); // "yes there is" is not a reason yet
  assert.equal(bareYes.reply_text, 'Could you tell me why you need that many?');
  await spoke();
  const reason = await flow.handleUtterance('My sister takes them too and she is visiting all winter.', 'keyboard');
  assert.equal(reason.reply_text, "Thank you. I can order up to three at a time, so let's make it three: $54.00. Shall I order them?");
  assert.equal(reason.card?.quantity, 3);
  await spoke();
  const done = await flow.handleUtterance('yes please', 'keyboard');
  assert.equal(done.order?.quantity, 3); assert.equal(done.order?.price_cents, 5400);
  assert.match(done.reply_text, /^Your order is placed: three packs of Calcium 600mg, 120 tablets, \$54\.00\./);
  assert.equal(alerts().length, 1);
  assert.equal(alerts()[0].level, 'normal'); assert.equal(alerts()[0].title, 'A bigger order than usual');
  assert.match(alerts()[0].body, /three packs of Calcium 600mg, 120 tablets \(\$54\.00\)\. She said: "My sister takes them too/);
  flow.reset();
});
test('no reason starts with one; a new number re-offers; never mind cancels; a scam reason is a scam', async () => {
  const flow = new ConversationPipeline({ decide: async () => request('calcium-120', 5), synthesize: async () => null });
  await flow.handleUtterance('five bottles of calcium', 'keyboard'); await spoke();
  const one = await flow.handleUtterance('No, no reason.', 'keyboard');
  assert.match(one.reply_text, /^Then let's start with one\. Calcium 600mg, 120 tablets is \$18\.00/); assert.equal(one.card?.quantity, 1);
  await spoke();
  await flow.handleUtterance('five bottles of calcium', 'keyboard'); await spoke();
  const two = await flow.handleUtterance('Make it two bottles then.', 'keyboard');
  assert.equal(two.reply_text, 'Two packs of Calcium 600mg, 120 tablets come to $36.00; would you like me to order them?');
  await spoke();
  await flow.handleUtterance('five bottles of calcium', 'keyboard'); await spoke();
  assert.equal((await flow.handleUtterance('Never mind.', 'keyboard')).reply_text, "Okay, I won't order it.");
  await spoke();
  await flow.handleUtterance('five bottles of calcium', 'keyboard'); await spoke();
  const scam = await flow.handleUtterance('Someone called and said I must buy them today.', 'keyboard');
  assert.match(scam.reply_text, /sounds like a scam/); assert.equal(scam.state, 'alert');
  assert.equal(db.all('orders').length, 1); // nothing was ordered in this test
  flow.reset();
});
test('a big everyday order asks once and goes through up to twelve; payment rejects a total that does not match the shelf', async () => {
  const flow = new ConversationPipeline({ decide: async () => request('bananas', 8), synthesize: async () => null });
  const ask = await flow.handleUtterance('eight bunches of bananas', 'keyboard');
  assert.match(ask.reply_text, /^Eight packs of .*Bananas.* is more than usual/);
  await spoke();
  const ok = await flow.handleUtterance('We are having the grandchildren over.', 'keyboard');
  assert.match(ok.reply_text, /^Thank you\. Eight packs of .*Bananas.* come to \$6\.00; shall I order them\?$/);
  await spoke();
  const done = await flow.handleUtterance('yes', 'keyboard');
  assert.equal(done.order?.quantity, 8); assert.equal(done.order?.price_cents, 600);
  assert.equal(alerts().length, 1);
  await assert.rejects(risk.pay({ ...historicalOrder, id: 'bad-total', received: false, quantity: 2 }), /does not match/);
  assert.equal((await risk.pay({ ...historicalOrder, id: 'ok-total', received: false, quantity: 2, price_cents: 3600 })).status, 'simulated_paid');
  flow.reset();
});
test('chat replies about orders name the quantity', async () => {
  const flow = new ConversationPipeline({ decide: async () => request('tissues', 2), synthesize: async () => null });
  await flow.handleUtterance('two boxes of tissues', 'keyboard'); await spoke();
  await flow.handleUtterance('yes', 'keyboard'); await spoke();
  let seen = '';
  const asker = new ConversationPipeline({ decide: async (_t, context) => { seen = context.recentOrders!.at(-1)!.product; return chat('ok'); }, synthesize: async () => null });
  await asker.handleUtterance('What did I buy today?', 'keyboard');
  assert.match(seen, /^2 × .*Tissues/);
  flow.reset(); asker.reset();
});
