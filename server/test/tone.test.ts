// From the first iPad run: no "I'm Milo, an AI" prefix, no shelf pitch when she is talking about food,
// "what did I buy today?" answered from the ledger, store photos reach the product card.
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import type { Context, Decision } from '../src/llm.js';

process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = '';
process.env.MINIMAX_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.DEEPGRAM_API_KEY = '';
const db = await import('../src/db.js');
const clock = await import('../src/clock.js');
const { tidyReply, readDecision } = await import('../src/llm.js');
const { ConversationPipeline, pipeline } = await import('../src/pipeline.js');
const { shelfSeed } = await import('../src/seed.js');
const { shelfMatches } = await import('../src/shelf.js');
beforeEach(() => { pipeline.reset(); db.resetDatabase(); clock.resetClock(); });
after(() => { pipeline.reset(); clock.stopClock(); db.sqlite.close(); });
const chat = (reply: string): Decision => ({ intent: 'chat', product_id: null, reply, elder_name: null });

test('the model\'s "I\'m Milo, an AI helper, and" opener is removed; real sentences are untouched', () => {
  assert.equal(tidyReply("I'm Milo, an AI helper, and I can get you bananas, bread, or oats, which sounds good?"), 'I can get you bananas, bread, or oats, which sounds good?');
  assert.equal(tidyReply("I'm an AI, and I'm glad you're feeling fine now."), "I'm glad you're feeling fine now.");
  assert.equal(tidyReply("I'm Milo. Bananas are $0.75; shall I order them?"), 'Bananas are $0.75; shall I order them?');
  assert.equal(tidyReply("I'm your AI helper in the picture frame, but I'm right here with you."), "I'm right here with you.");
  assert.equal(tidyReply("I'm sorry you're not feeling well; I'm your friend and I'm right here with you."), "I'm sorry you're not feeling well; I'm your friend and I'm right here with you.");
  assert.equal(tidyReply("I'm an AI."), "I'm an AI."); // a direct answer to "are you a person?" stays
  const content = [{ type: 'text' as const, text: JSON.stringify(chat("I'm Milo, an AI, and today you ordered calcium for $18.")), citations: null }];
  assert.equal(readDecision({ stop_reason: 'end_turn', content }, shelfSeed).reply, 'Today you ordered calcium for $18.');
});
test('talking about food or shopping is never steered to the shelf pitch, however many rounds', async () => {
  const flow = new ConversationPipeline({ decide: async text => chat(`About "${text}": bananas, bread or soup?`), synthesize: async () => null });
  const replies: string[] = [];
  for (const text of ['I want some food.', 'I want some food.', 'I want some food.', 'What did I buy today?']) {
    replies.push((await flow.handleUtterance(text, 'keyboard')).reply_text);
  }
  assert.ok(replies.every(r => r.startsWith('About')), JSON.stringify(replies));
  // Pure small talk still gets the gentle nudge after two rounds, worded as an offer, not a shelf command.
  for (const text of ['Nice weather today.', 'My neighbour came by this morning.', 'The TV was loud last night.']) replies.push((await flow.handleUtterance(text, 'keyboard')).reply_text);
  assert.equal(replies.at(-1), "Is there anything you'd like me to get for you today?");
  assert.doesNotMatch(replies.join(' '), /shopping shelf/);
  flow.reset();
});
test('Claude sees today\'s date and the recent orders, so "what did I buy today?" has facts to answer from', async () => {
  const seen: { context: Context | null } = { context: null };
  const flow = new ConversationPipeline({ decide: async (_text, context) => { seen.context = context; return chat('You ordered calcium today.'); }, synthesize: async () => null });
  await flow.handleUtterance('What did I buy today?', 'keyboard');
  const context = seen.context!;
  assert.match(context.now!, /^2026-10-17/);
  assert.equal(context.recentOrders!.length, 1); // the seeded September calcium order
  assert.equal(context.recentOrders![0].product, 'Calcium 600mg, 120 tablets');
  assert.equal(context.recentOrders![0].ordered_on, '2026-09-10');
  assert.equal(context.recentOrders![0].received, true);
  flow.reset();
});
test('shelf matching: everyday words count as shopping; the seed carries store photos for the real items only', () => {
  assert.equal(shelfMatches('I want some bananas', shelfSeed), true);
  assert.equal(shelfMatches('we are out of TP', shelfSeed), true);
  assert.equal(shelfMatches('the purple bottle is empty', shelfSeed), true);
  assert.equal(shelfMatches('nice weather today', shelfSeed), false);
  assert.equal(shelfMatches('the TV was loud last night', shelfSeed), false);
  const withPhoto = shelfSeed.filter(p => p.image_url);
  assert.ok(withPhoto.length >= 80, `${withPhoto.length} products with a store photo`);
  assert.ok(withPhoto.every(p => p.image_url!.startsWith('https://')));
  assert.equal(shelfSeed.find(p => p.id === 'calcium-120')!.image_url, null); // the demo record keeps the elder page's own picture
  assert.equal(db.get('products', 'oats')!.image_url, shelfSeed.find(p => p.id === 'oats')!.image_url); // survives the database round trip
});
test('Claude may pick any catalog id, not only a shortlisted one; ids outside the catalog are still rejected', async () => {
  const seen: { context: Context | null } = { context: null };
  const flow = new ConversationPipeline({
    decide: async (_text, context) => { seen.context = context; return { intent: 'new_request', product_id: 'vitamin-c', reply: '', elder_name: null }; },
    synthesize: async () => null,
  });
  // "What did I buy today?" matches nothing on the shelf, so vitamin C is not among the full records...
  const result = await flow.handleUtterance('Milo, what did I buy today? Oh, and vitamin C.', 'keyboard');
  const context = seen.context!;
  assert.ok(context.catalog!.length >= 100);
  assert.ok(context.catalog!.some(p => p.id === 'vitamin-c' && /Vitamin C/.test(p.name)));
  assert.ok(context.products.length <= 12);
  // ...yet choosing it works, because the whole catalog is choosable.
  assert.equal(result.card?.product.id, 'vitamin-c');
  flow.reset();
  const content = (reply: Decision) => [{ type: 'text' as const, text: JSON.stringify(reply), citations: null }];
  const decision: Decision = { intent: 'new_request', product_id: 'vitamin-c', reply: 'x', elder_name: null };
  assert.equal(readDecision({ stop_reason: 'end_turn', content: content(decision) }, [{ id: 'vitamin-c' }]).product_id, 'vitamin-c');
  assert.equal(readDecision({ stop_reason: 'end_turn', content: content(decision) }, [{ id: 'oats' }]).product_id, null); // not choosable -> fallback
});
