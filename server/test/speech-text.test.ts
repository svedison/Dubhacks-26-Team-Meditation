// The voice reads "911" as "nine one one" (MiniMax said "one hundred eleven"); other numbers are left to the voice.
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.MINIMAX_API_KEY = '';
process.env.OPENAI_API_KEY = '';
const { speechText } = await import('../src/tts.js');

test('911 is spoken digit by digit in every emergency line', () => {
  assert.equal(speechText("That sounds serious. I'm calling 911 in five seconds. Say 'stop' if you don't want me to."),
    "That sounds serious. I'm calling nine one one in five seconds. Say 'stop' if you don't want me to.");
  assert.equal(speechText('Calling 911 now. Help is on the way; stay with me.'), 'Calling nine one one now. Help is on the way; stay with me.');
  assert.equal(speechText("Okay, I won't call 911. I'm letting your daughter know right now."), "Okay, I won't call nine one one. I'm letting your daughter know right now.");
});

test('prices, times and other numbers are untouched', () => {
  assert.equal(speechText('Calcium is $18 and arrives Thursday at 9:11 AM; 1911 tablets, item 9110.'), 'Calcium is $18 and arrives Thursday at 9:11 AM; 1911 tablets, item 9110.');
});
