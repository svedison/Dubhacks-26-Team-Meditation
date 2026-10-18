export function normalize(text: string): string {
  return text.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
export function levenshtein(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
function phonetic(text: string): string {
  return text.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c/g, 'k').replace(/y/g, 'i')
    .replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
}
export function matchesWakeName(text: string, wakeName: string): boolean {
  const spoken = normalize(text);
  if (!spoken) return false;
  const name = normalize(wakeName).replace(/ /g, '');
  if (!name) return true;
  const words = spoken.split(' ');
  const count = normalize(wakeName).split(' ').length;
  for (let start = 0; start < words.length; start++) {
    for (let size = 1; size <= count + 1 && start + size <= words.length; size++) {
      const candidate = words.slice(start, start + size).join('');
      const tolerance = name.length <= 3 ? 0 : Math.max(1, Math.floor(name.length / 4));
      if (levenshtein(candidate, name) <= tolerance) return true;
      if (Math.abs(candidate.length - name.length) <= 2 && phonetic(name) && phonetic(candidate) === phonetic(name)) return true;
    }
  }
  return false;
}
export function extractWakeName(text: string): string | null {
  const name = text.trim().replace(/^(?:(?:you can |i(?:'ll| will) )?call (?:you|yourself)|your name is|let(?:'s| us) call you)\s+/i, '')
    .replace(/[.!?,]+$/g, '').trim();
  return /^[\p{L}][\p{L}' -]{0,39}$/u.test(name) && name.split(/\s+/).length <= 3 ? name : null;
}
