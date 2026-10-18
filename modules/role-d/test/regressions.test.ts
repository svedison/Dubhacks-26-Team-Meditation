import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createRoleD, SqliteStore } from '../src/index.ts';
import { createServer } from '../src/server.ts';
const wall = Date.parse('2026-10-17T18:00:00Z');
function fixture() {
  const events: any[] = [], store = new SqliteStore(':memory:');
  const app = createRoleD({store,wallNow:()=>wall,emit:(_,e)=>events.push(e)});
  function order(id: string, product_id='calcium-120') {
    app.addOrder({id,product_id,price_cents:1800,status:'simulated_paid',block_reason:null,created_at:app.now(),deliver_on:'2026-10-22',received:false});
  }
  function memory() { order('calcium');app.setClock('2026-10-22T09:00:00Z');app.handleAnswer('yes');app.handleAnswer('okay');return app.snapshot().memories[0]; }
  return {app,events,store,order,memory};
}
test('unanswered red explanation expires and releases next-day reminders without inventing a note', () => {
  const {app,store,events,memory}=fixture();memory();
  const alert=app.recordAnomaly({rule:7,level:'red',title:'Check on Mom',body:'Possible scam'},'one');
  app.setClock('2026-10-23T08:00:00Z');
  assert.equal(events.at(-1).kind,'reminder');
  assert.equal(app.snapshot().alerts[0].grandma_note,null);
  app.answerAlert(alert.id,'It was a phone call.');
  assert.equal(app.snapshot().alerts[0].grandma_note,'It was a phone call.');
  store.close();
});
test('late explicitly named receipt updates calcium, never the newly active tea delivery', () => {
  const {app,store,order}=fixture();order('calcium');order('tea','tea');
  app.setClock('2026-10-22T09:00:00Z');app.setClock('2026-10-22T09:01:00Z');
  app.handleAnswer('Yes, got the calcium.');
  assert.equal(app.snapshot().orders.find(o=>o.id==='calcium')!.received,true);
  assert.equal(app.snapshot().orders.find(o=>o.id==='tea')!.received,false);
  store.close();
});
test('ambiguous yes after question rollover does not credit the next order', () => {
  const {app,store,order}=fixture();order('calcium');order('tea','tea');
  app.setClock('2026-10-22T09:00:00Z');app.setClock('2026-10-22T09:01:00Z');
  app.handleAnswer('Yes, got it.');
  assert.equal(app.snapshot().orders.find(o=>o.id==='tea')!.received,false);
  app.handleAnswer('Yes, got the tea.');
  assert.equal(app.snapshot().orders.find(o=>o.id==='tea')!.received,true);
  store.close();
});
test('late named reminder answer corrects calcium without consuming glucosamine reminder', () => {
  const {app,store,order,memory}=fixture();const calcium=memory();order('joint','glucosamine-usp');app.receiveOrder('joint');app.handleAnswer('okay');
  const joint=app.snapshot().memories.find(m=>m.product_id==='glucosamine-usp')!;
  app.updateMemory(joint.id,{times:['08:01']});
  app.setClock('2026-10-23T08:00:00Z');app.setClock('2026-10-23T08:01:00Z');
  app.handleAnswer('I took the calcium.');
  assert.equal(app.snapshot().memories.find(m=>m.id===calcium.id)!.log[0].answer,'taken');
  assert.equal(app.snapshot().memories.find(m=>m.id===joint.id)!.log.length,0);
  store.close();
});
test('zero-stock timeout correction does not debit a subsequently delivered pack', () => {
  const {app,store,order,memory}=fixture();const m=memory();app.updateMemory(m.id,{stock_units:0});
  app.setClock('2026-10-23T08:00:00Z');app.setClock('2026-10-23T08:01:00Z');order('refill');app.receiveOrder('refill');
  app.answerReminder(m.id,'2026-10-23T08:00:00Z','taken');
  assert.equal(app.snapshot().memories[0].stock_units,120);store.close();
});
test('stock-only edits invalidate snoozes just like schedule edits', () => {
  const {app,store,events,memory}=fixture();const m=memory();
  app.setClock('2026-10-23T08:00:00Z');app.handleAnswer('later');app.updateMemory(m.id,{stock_units:20});
  app.setClock('2026-10-23T08:15:00Z');assert.equal(events.filter(e=>e.kind==='reminder').length,1);store.close();
});
test('invalid source arrays on HTTP and WebSocket do not create alerts', async () => {
  const store=new SqliteStore(':memory:'), h=createServer({store,scheduler:false});h.server.listen(0,'127.0.0.1');await once(h.server,'listening');
  const port=(h.server.address() as net.AddressInfo).port;const ws=new WebSocket(`ws://127.0.0.1:${port}/ws?role=elder`);
  try {
    await once(ws,'open');
    const response=await fetch(`http://127.0.0.1:${port}/api/utterance`,{method:'POST',body:JSON.stringify({text:'gift card',source:['voice']})});
    assert.equal(response.status,400);
    const messages:any[]=[];ws.on('message',data=>messages.push(JSON.parse(data.toString())));
    ws.send(JSON.stringify({type:'utterance',text:'gift card',source:['voice']}));
    await new Promise(r=>setTimeout(r,25));assert.ok(messages.some(e=>e.type==='error'));assert.equal(h.app.snapshot().alerts.length,0);
  } finally {ws.terminate();await h.close();store.close();}
});
test('malformed WebSocket upgrade target closes only that socket, server remains healthy', async () => {
  const store=new SqliteStore(':memory:'), h=createServer({store,scheduler:false});h.server.listen(0,'127.0.0.1');await once(h.server,'listening');
  const port=(h.server.address() as net.AddressInfo).port;
  const socket=net.connect(port,'127.0.0.1');socket.on('error',()=>{});
  try {
    await once(socket,'connect');socket.write('GET //[/ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
    await new Promise(r=>setTimeout(r,50));
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);
  } finally {socket.destroy();await h.close();store.close();}
});
