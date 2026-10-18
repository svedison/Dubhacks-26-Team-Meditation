import { normalize } from './wake.js';
import type { Product } from './contracts.js';

// The whole shelf used to go into every Claude prompt (20 items ≈ 2.6k tokens). With a real catalogue of a few hundred
// items that would slow every turn, so the model only sees the items the sentence could be about, plus the pending one.
// Small shelves are passed whole, so the demo catalogue behaves exactly as before.
export const SHORTLIST_LIMIT = 12;
const PASS_WHOLE_UP_TO = 24;
const STOPWORDS = new Set(['i', 'me', 'my', 'we', 'you', 'it', 'the', 'a', 'an', 'some', 'any', 'of', 'for', 'to', 'and', 'or', 'is',
  'are', 'was', 'be', 'do', 'can', 'could', 'would', 'please', 'want', 'need', 'like', 'get', 'buy', 'order', 'have', 'more',
  'another', 'again', 'that', 'this', 'one', 'with', 'in', 'on', 'at', 'up', 'out', 'so', 'just', 'also', 'yes', 'no', 'ok', 'okay',
  'hey', 'hi', 'hello', 'milo', 'there', 'thing', 'things', 'something', 'anything', 'much', 'very', 'really', 'little', 'bit',
  // Words that store names are full of but that mean nothing on their own in speech ("last night", "a long day").
  'night', 'long', 'white', 'whole', 'fresh', 'large', 'original', 'extra', 'daily', 'plain', 'new', 'big', 'small', 'old', 'fashioned',
  'wild', 'free', 'strength', 'count', 'pack', 'bag', 'box', 'bar', 'bunch', 'brand', 'classic', 'ultra', 'soft', 'maximum', 'relief']);
// Everyday words that point at a category rather than an item.
const CATEGORY_HINTS: Record<string, string[]> = {
  food: ['eat', 'eating', 'food', 'hungry', 'snack', 'snacks', 'breakfast', 'lunch', 'dinner', 'meal', 'grocery', 'groceries', 'drink', 'drinks', 'thirsty', 'cook', 'cooking', 'kitchen'],
  supplement: ['vitamin', 'vitamins', 'pill', 'pills', 'supplement', 'supplements', 'tablet', 'tablets', 'capsule', 'capsules', 'bottle', 'bottles'],
  household: ['clean', 'cleaning', 'house', 'home', 'bathroom', 'laundry', 'paper', 'batteries', 'battery', 'bulb', 'bulbs', 'light'],
  'personal-care': ['teeth', 'tooth', 'hair', 'skin', 'bath', 'shower', 'wash', 'denture', 'dentures'],
  otc: ['medicine', 'medicines', 'pain', 'ache', 'hurts', 'cold', 'cough', 'allergy', 'allergies', 'bandage', 'bandages', 'pharmacy'],
  pet: ['cat', 'dog', 'kitty', 'puppy', 'pet', 'bird', 'birds'],
};
const singular = (word: string): string => word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
const words = (text: string): string[] => normalize(text).split(' ').filter(Boolean);

/** True when the sentence names or nicknames something on the shelf ("TP", "the purple bottle", "some bananas"). A lone name
 *  word ("night", "dog") is not enough: that would turn small talk into shopping talk. */
export function shelfMatches(text: string, products: Product[]): boolean {
  return scores(text, products).some(s => s.score >= 4);
}
function scores(text: string, products: Product[]): { product: Product; index: number; score: number }[] {
  const tokens = [...new Set(words(text).filter(w => !STOPWORDS.has(w)).map(singular))];
  return products.map((product, index) => {
    const name = words(product.name).map(singular);
    const aliases = product.aliases.flatMap(alias => words(alias).map(singular));
    const category = normalize(product.category);
    let score = 0;
    for (const token of tokens) {
      if (aliases.includes(token)) score += 4;
      if (name.includes(token)) score += 3;
      else if (token.length >= 4 && name.some(w => w.startsWith(token) || token.startsWith(w) && w.length >= 4)) score += 2;
      if (CATEGORY_HINTS[category]?.includes(token) || category === token) score += 1;
    }
    // A whole alias said as one phrase ("the purple bottle") outranks scattered word hits.
    if (product.aliases.some(alias => normalize(alias) && normalize(text).includes(normalize(alias)))) score += 6;
    return { product, index, score };
  });
}
export function shortlist(text: string, products: Product[], mustInclude: string | null = null, limit = SHORTLIST_LIMIT): Product[] {
  if (products.length <= PASS_WHOLE_UP_TO) return products;
  const scored = scores(text, products);
  const picked = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(s => s.product);
  if (mustInclude && !picked.some(p => p.id === mustInclude)) {
    const pending = products.find(p => p.id === mustInclude);
    if (pending) picked.unshift(pending);
  }
  // Nothing matched (small talk, a new wish): give the model one familiar item per category so it can still suggest.
  if (picked.length < 4) {
    const seen = new Set(picked.map(p => p.category));
    for (const product of products) {
      if (picked.length >= Math.min(limit, 8)) break;
      if (!picked.includes(product) && !product.risk && !seen.has(product.category)) { picked.push(product); seen.add(product.category); }
    }
  }
  return picked.slice(0, Math.max(limit, picked.length));
}
