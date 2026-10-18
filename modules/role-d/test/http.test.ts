import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createServer } from '../src/server.ts';
import { SqliteStore } from '../src/store.ts';
const now = Date.parse('2026-10-17T18:00:00Z');
async function harness() {
  const store = new SqliteStore(':memory:');
  const instance = createServer({store, wallNow: () => now, scheduler: false});
  instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening');
  const address = instance.server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const post = async (path: string, body?: unknown) => fetch(url + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const sockets: WebSocket[] = [];
  async function connect(role: string) {
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws?role=' + role);
    sockets.push(ws); const events: any[] = [];
    ws.on('message', data => events.push(JSON.parse(data.toString())));
    await once(ws, 'open'); return {ws, events};
  }
  const close = async () => { for (const ws of sockets) ws.terminate(); await instance.close(); store.close(); };
  return {url, post, connect, close, instance};
}
async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Expected event did not arrive');
}
test('real HTTP + two WebSocket clients complete Scene 4 and replay after reset', async () => {
  const h = await harness();
  try {
    const elder = await h.connect('elder'), guardian = await h.connect('guardian');
    for (let round = 0; round < 2; round++) {
      await h.post('/debug/reset');
      const r = await h.post('/debug/orders', {product_id: 'glucosamine-usp', deliver_on: '2026-10-22'}); assert.equal(r.status, 201);
      await h.post('/debug/clock', {now: '2026-10-22T09:00:00Z'});
      await waitFor(() => elder.events.filter(e => e.kind === 'received').length === round + 1);
      await h.post('/api/utterance', {text: 'Yes, got it.', source: 'keyboard'});
      await h.post('/api/utterance', {text: 'Okay.', source: 'keyboard'});
      await h.post('/debug/clock', {now: '2026-10-23T08:00:00Z'});
      elder.ws.send(JSON.stringify({type: 'utterance', text: 'Took it.', source: 'keyboard'}));
      await waitFor(() => guardian.events.filter(e => e.type === 'memory' && e.stock_units === 89).length === round + 1);
      const memories = await (await fetch(h.url + '/api/memories')).json();
      assert.equal(memories[0].product_id, 'glucosamine-usp');
      assert.equal(memories[0].start_date, '2026-10-23');
      assert.equal(memories[0].stock_units, 89);
      assert.equal(memories[0].log[0].answer, 'taken');
    }
    assert.ok(guardian.events.some(e => e.type === 'clock'));
    assert.ok(!guardian.events.some(e => e.type === 'ask'));
  } finally { await h.close(); }
});
test('Scene 2 emits red immediately and updates original grandma_note after reply', async () => {
  const h = await harness();
  try {
    const guardian = await h.connect('guardian');
    const result = await h.post('/api/utterance', {text: 'Someone called and asked me to buy a gift card today.', source: 'voice'});
    assert.equal(result.status, 200);
    const payload = await result.json(); assert.equal(payload.state, 'alert'); assert.ok(payload.reply_text);
    await waitFor(() => guardian.events.some(e => e.type === 'alert'));
    const first = guardian.events.find(e => e.type === 'alert');
    assert.equal(first.rule, 7); assert.equal(first.level, 'red');
    await h.post('/api/utterance', {text: 'He said he was from the bank.', source: 'voice'});
    await waitFor(() => guardian.events.filter(e => e.type === 'alert').length === 2);
    assert.equal(guardian.events.at(-1).id, first.id);
    assert.equal(guardian.events.at(-1).grandma_note, 'He said he was from the bank.');
  } finally { await h.close(); }
});
test('invalid clock, JSON, WS role writes and asset traversal are rejected without corrupting state', async () => {
  const h = await harness();
  try {
    const before = h.instance.app.snapshot();
    assert.equal((await h.post('/debug/clock', {now: 'invalid'})).status, 400);
    assert.equal((await fetch(h.url + '/debug/clock', {method:'POST', body:'{'})).status, 400);
    assert.equal((await h.post('/api/utterance', {text: 99, source:'keyboard'})).status, 400);
    assert.equal((await fetch(h.url + '/debug/reset')).status, 405);
    assert.equal((await fetch(h.url + '/assets/%2e%2e%2fpackage.json')).status, 404);
    assert.deepEqual(h.instance.app.snapshot(), before);
    const guardian = await h.connect('guardian'); guardian.ws.send(JSON.stringify({type:'utterance', text:'gift card', source:'voice'}));
    await waitFor(() => guardian.events.some(e => e.type === 'error'));
    assert.equal(h.instance.app.snapshot().alerts.length, 0);
    const elder = await h.connect('elder'); elder.ws.send('null');
    await waitFor(() => elder.events.some(e => e.type === 'error'));
  } finally { await h.close(); }
});
