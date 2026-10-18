import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortlist, SHORTLIST_LIMIT } from '../src/shelf.js';
import { shelfSeed } from '../src/seed.js';
import type { Product } from '../src/contracts.js';

const item = (id: string, name: string, category: string, aliases: string[] = []): Product =>
  ({ id, name, price_cents: 500, category, certification: null, aliases, label_dose: null, units: 1, units_per_dose: 1, risk: null });
// A 100-item shelf: the demo items plus everyday groceries, household and personal care.
const big: Product[] = [...shelfSeed,
  item('bananas', 'Bananas, 1 bunch', 'food', ['nanas']), item('whole-milk', 'Whole milk, 1 gallon', 'food'),
  item('eggs-12', 'Large eggs, dozen', 'food'), item('bread', 'Whole wheat bread, 1 loaf', 'food'),
  item('toilet-paper', 'Toilet paper, 12 rolls', 'household', ['tp', 'bathroom tissue']), item('paper-towels', 'Paper towels, 6 rolls', 'household'),
  item('denture-tabs', 'Denture cleanser tablets, 120 count', 'personal-care', ['denture tablets']),
  item('acetaminophen', 'Acetaminophen 500mg, 100 caplets', 'otc', ['tylenol', 'pain reliever']),
  item('cat-food', 'Cat food, 12 cans', 'pet', ['food for the cat']),
  ...Array.from({ length: 71 }, (_, i) => item(`filler-${i}`, `Pantry item ${i}, 1 pack`, 'food')),
];

test('a small shelf is passed whole, so the demo catalogue is unchanged', () => {
  assert.deepEqual(shortlist('the purple bottle is empty', shelfSeed), shelfSeed);
});
test('a big shelf is cut to the items the sentence is about, aliases first', () => {
  const picked = shortlist('Milo, the purple bottle is almost empty', big);
  assert.ok(picked.length <= SHORTLIST_LIMIT);
  assert.equal(picked[0].id, 'calcium-120');
  assert.equal(shortlist('I want bananas and some milk', big).slice(0, 2).map(p => p.id).sort().join(), 'bananas,whole-milk');
  assert.equal(shortlist('we are out of TP', big)[0].id, 'toilet-paper');
  assert.equal(shortlist('I need Tylenol for my knee', big)[0].id, 'acetaminophen');
  assert.equal(shortlist('food for the cat please', big)[0].id, 'cat-food');
});
test('the pending product is always visible to the model, and a vague wish still gets a few familiar items', () => {
  assert.ok(shortlist('yes please', big, 'glucosamine-usp').some(p => p.id === 'glucosamine-usp'));
  const vague = shortlist('I want to buy something nice', big);
  assert.ok(vague.length >= 4 && vague.length <= SHORTLIST_LIMIT);
  assert.ok(vague.every(p => !p.risk));
  assert.ok(shortlist('I want something to eat', big).every(p => p.category === 'food'));
});
