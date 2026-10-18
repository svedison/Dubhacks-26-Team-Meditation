import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractWakeName, isOnlyWakeName, levenshtein, matchesWakeName } from '../src/wake.js';

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
test('common STT shapes of a short name wake it; unrelated words do not', () => {
  for (const heard of ['Milo', 'Mylo', 'my low', 'Me low, I want tea', 'mellow', 'Milow', 'Nilo', 'MILO!']) assert.equal(matchesWakeName(heard, 'Milo'), true, heard);
  // Known benign false wakes, accepted for a short name: "milk", "mile", "mail", "mild", "meal", "melon" (one letter or one consonant off).
  for (const heard of ['hello there', 'the TV is loud', 'my love', 'mine', 'me too', 'mom called', 'my little one', 'family', 'smile']) assert.equal(matchesWakeName(heard, 'Milo'), false, heard);
});
test('only the name (with a filler at most) opens the window silently; a greeting or a mishearing in two words gets an answer', () => {
  for (const heard of ['Milo', 'Milo.', 'hey Milo', 'Okay, Milo!', 'Mylo', 'Milo?']) assert.equal(isOnlyWakeName(heard, 'Milo'), true, heard);
  for (const heard of ['Milo hello', 'my low', 'Milo, the purple bottle', 'hello', '']) assert.equal(isOnlyWakeName(heard, 'Milo'), false, heard);
  assert.equal(isOnlyWakeName('Mary Jane', 'Mary Jane'), true);
  assert.equal(isOnlyWakeName('Milo', ''), false);
});
