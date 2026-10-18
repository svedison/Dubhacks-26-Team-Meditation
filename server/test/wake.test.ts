import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractWakeName, levenshtein, matchesWakeName } from '../src/wake.js';

test('wake names tolerate case, punctuation, spelling and phonetic STT variants', () => {
  for (const phrase of ['Lily!', 'Hey LILY, the bottle is empty.', 'Lilly help me', 'Lili please', 'Lilee', 'Li ly, hello', 'Lilyy']) {
    assert.equal(matchesWakeName(phrase, 'Lily'), true, phrase);
  }
  for (const phrase of ['Milo!', 'Hey MILO, the purple bottle is empty.', 'Mylo help me', 'Me-lo please', 'Milow', 'Mi lo, hello']) {
    assert.equal(matchesWakeName(phrase, 'Milo'), true, phrase);
  }
  assert.equal(matchesWakeName('MaryJane, help', 'Mary Jane'), true);
  assert.equal(matchesWakeName('Sofie hello', 'Sophie'), true);
});
test('ordinary speech does not wake a named assistant; empty name accepts speech', () => {
  assert.equal(matchesWakeName('the purple bottle is empty', 'Lily'), false);
  assert.equal(matchesWakeName('hello there', ''), true);
  assert.equal(matchesWakeName('... ', ''), false);
  assert.equal(matchesWakeName('', 'Lily'), false);
});
test('distance and first-conversation name extraction', () => {
  assert.equal(levenshtein('lilly', 'lily'), 1);
  assert.equal(levenshtein('', 'lily'), 4);
  assert.equal(extractWakeName('You can call yourself Lily.'), 'Lily');
  assert.equal(extractWakeName("Let's call you Daisy!"), 'Daisy');
  assert.equal(extractWakeName('I want to buy the purple bottle'), null);
});
