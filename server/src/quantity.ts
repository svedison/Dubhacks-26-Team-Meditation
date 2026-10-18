import { normalize } from './wake.js';

// "three boxes of tissues", "2 packs", "a dozen eggs", "a couple of bananas" -> how many packs she wants.
// Sizes are not quantities: "2% milk", "600 mg", "100 tablets", "16 oz" never count. Claude extracts the number first;
// this is the local backstop and the parser for her answer to "how many?".
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20 };
const PACK = '(?:packs?|packets?|bottles?|boxes|box|bags?|cans?|jars?|loaves|loaf|rolls?|bunche?s?|cartons?|tubes?|tubs?|pairs?|sticks?|bars?|cases?|sets?|more|of)';
const NUMBER = `(\\d{1,2}|${Object.keys(WORDS).join('|')})`;
export function parseQuantity(text: string): number | null {
  const t = ` ${normalize(text)} `;
  // "a dozen eggs" is one carton (a size); only "a dozen boxes/packs of ..." is a count.
  const dozen = t.match(new RegExp(`\\b(half a |a |one |two |three )?dozen ${PACK}\\b`));
  if (dozen) {
    const lead = (dozen[1] ?? 'a ').trim();
    return lead === 'half a' ? 6 : (WORDS[lead] ?? 1) * 12;
  }
  const vague = t.match(/\ba (couple|few|several) (?:more )?(?:of\b|[a-z]+s\b)/);
  if (vague) return vague[1] === 'couple' ? 2 : 3;
  const counted = t.match(new RegExp(`\\b${NUMBER}\\s+(?:more\\s+)?${PACK}\\b`));
  if (!counted) return null;
  const raw = counted[1];
  const n = WORDS[raw] ?? Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
}
/** "three" for small numbers, digits above twelve: what Milo says aloud. */
export function quantityWords(n: number): string {
  const names = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  return names[n] ?? String(n);
}
/** How many packs are ordinary (ask above this) and the most Milo orders at once, by shelf category. */
export function quantityLimits(category: string): { ask: number; max: number } {
  return category === 'supplement' || category === 'otc' ? { ask: 2, max: 3 } : { ask: 6, max: 12 };
}
