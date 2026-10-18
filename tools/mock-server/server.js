// TrustTag 假后端：让老人端（A）和监护人端（C）在真后端（B）就位前能对着开发。
// 事件格式以 .plans/shared-contracts.md 为准。
//
//   cd tools/mock-server && npm install && npm start
//   WebSocket: ws://localhost:8787/ws     REST: http://localhost:8787/api/...
//
// 连上 /ws 以后：
//   发 {"type":"utterance","text":"the purple bottle is almost empty"}  -> 回放第二幕补货
//   发 {"type":"utterance","text":"someone called ... gift card"}       -> 回放第二幕诈骗（手机端收到红卡）
//   发 {"type":"utterance","text":"miracle joint pills"}                -> 回放第三幕
//   POST /debug/clock {"now":"2026-10-22T09:00:00Z"}                    -> 回放第四幕到货和定吃法
//   POST /debug/clock {"now":"2026-10-23T08:00:00Z"}                    -> 回放第四幕提醒
//   POST /debug/reset                                                   -> 回到初始数据
//   或者什么都不发：连上 5 秒后自动跑一遍第二幕，方便只看渲染。

import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8787;
const AUTOPLAY = process.env.AUTOPLAY !== "0";

const PRODUCTS = [
  { id: "calcium-120", name: "Calcium 600mg, 120 tablets", price_cents: 1800, category: "supplement",
    certification: "USP", aliases: ["the purple bottle"], label_dose: "1 tablet daily with food",
    units: 120, units_per_dose: 1, risk: null },
  { id: "glucosamine-usp", name: "Glucosamine 1500mg, 90 tablets", price_cents: 2400, category: "supplement",
    certification: "USP", aliases: [], label_dose: "1 tablet daily", units: 90, units_per_dose: 1, risk: null },
  { id: "miracle-joint", name: "Miracle Joint Pills (as seen on TV)", price_cents: 8900, category: "supplement",
    certification: null, aliases: ["miracle joint pills"], label_dose: null, units: 60, units_per_dose: 2,
    risk: { kind: "fda_fraud", alternative_id: "glucosamine-usp" } },
];

let state;
function reset() {
  state = {
    now: "2026-10-17T18:00:00Z",
    settings: { elder_name: "Grandma", address: "123 Maple St", phone: "555-0100", card_last4: "4242",
      card_owner: "guardian", monthly_baseline_cents: 15000, share_level: "default", wake_name: "Milo", photos: [] },
    orders: [{ id: "ord_00", product_id: "calcium-120", price_cents: 1800, status: "paid", block_reason: null,
      created_at: "2026-09-10T15:00:00Z", deliver_on: "2026-09-14", received: true }],
    memories: [], alerts: [],
  };
}
reset();

// ---------- WebSocket ----------
const elders = new Set(), guardians = new Set(), all = new Set();
function send(set, msg) { const s = JSON.stringify(msg); for (const ws of set) if (ws.readyState === 1) ws.send(s); }
const toElder = (m) => send(elders, m), toGuardian = (m) => send(guardians, m), toAll = (m) => send(all, m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P = (id) => PRODUCTS.find((p) => p.id === id);

async function say(text, extra = {}) {
  toElder({ type: "state", state: "speaking" });
  toElder({ type: "transcript", role: "ai", text });
  toElder({ type: "speak", text, audio_url: null, ...extra });   // 假后端没有 TTS，audio_url 为空，A 用浏览器 speechSynthesis 兜底
  await sleep(2500);
}
function heard(text) { toElder({ type: "state", state: "listening" }); toElder({ type: "transcript", role: "grandma", text }); }

async function sceneRefill() {
  heard("Milo, the purple bottle is almost empty.");
  toElder({ type: "state", state: "thinking" }); await sleep(1200);
  toElder({ type: "card", product: P("calcium-120") });
  await say("That's your calcium, 120 tablets, $18. It'll arrive Thursday. Want me to order it?");
  toElder({ type: "state", state: "listening" }); await sleep(1500);
  heard("Yes.");
  const order = { id: "ord_" + Date.now(), product_id: "calcium-120", price_cents: 1800, status: "simulated_paid",
    block_reason: null, created_at: state.now, deliver_on: "2026-10-22", received: false };
  state.orders.push(order); toGuardian({ type: "order", ...order }); toElder({ type: "order", ...order });
  toElder({ type: "state", state: "happy" });
  await say("Done. I'll let you know when it arrives.");
  toElder({ type: "state", state: "listening" });
}

async function sceneScam() {
  heard("Oh, and someone called. They said I need to buy a $500 gift card today.");
  toElder({ type: "state", state: "thinking" }); await sleep(800);
  toElder({ type: "state", state: "alert" });
  await say("That sounds like a scam. Nobody official asks for gift cards. Please hang up. I'll let your daughter know, okay?");
  const alert = { id: "al_" + Date.now(), level: "red", rule: 7, title: "Check on Mom",
    body: "Someone asked her to buy a $500 gift card today. Milo blocked it.", grandma_note: null,
    created_at: state.now, archived: false };
  state.alerts.push(alert); toGuardian({ type: "alert", ...alert });
  toElder({ type: "state", state: "listening" });
}

async function sceneFake() {
  heard("Buy me two boxes of those miracle joint pills from TV. They cure arthritis in seven days.");
  toElder({ type: "state", state: "thinking" }); await sleep(1200);
  toElder({ type: "state", state: "alert" });
  toElder({ type: "card", product: P("miracle-joint"), alternative: P("glucosamine-usp") });
  await say("I can't find that product anywhere I trust, and nothing cures arthritis in seven days. Here's a USP-verified glucosamine instead. Want to try one bottle?");
  toElder({ type: "state", state: "listening" }); await sleep(1500);
  heard("Okay.");
  const order = { id: "ord_" + Date.now(), product_id: "glucosamine-usp", price_cents: 2400, status: "simulated_paid",
    block_reason: null, created_at: state.now, deliver_on: "2026-10-22", received: false };
  state.orders.push(order); toGuardian({ type: "order", ...order }); toElder({ type: "order", ...order });
  toElder({ type: "state", state: "happy" });
  await say("Ordered. Thursday as well.");
  toElder({ type: "state", state: "listening" });
}

async function sceneDelivery() {
  toElder({ type: "state", state: "speaking" });
  toElder({ type: "ask", kind: "received", text: "Your calcium arrived today. Did you get it?", audio_url: null });
  await sleep(2500); heard("Yes, got it."); await sleep(800);
  toElder({ type: "ask", kind: "dose_confirm", text: "The label says one tablet daily with food. Start today, and I'll remind you every morning at eight. Okay?", audio_url: null });
  await sleep(2500); heard("Okay.");
  const mem = { id: "mem_01", product_id: "calcium-120", dose_text: "1 tablet with breakfast", times: ["08:00"],
    start_date: "2026-10-22", end_date: null, stock_units: 120, units_per_dose: 1, paused: false, log: [] };
  state.memories = [mem]; toGuardian({ type: "memory", ...mem });
  toGuardian({ type: "alert", id: "al_mem", level: "normal", rule: null, title: "Calcium reminder set",
    body: "Every morning at 8:00, starting today.", grandma_note: null, created_at: state.now, archived: false });
  toElder({ type: "state", state: "happy" }); await sleep(1000); toElder({ type: "state", state: "idle" });
}

async function sceneReminder() {
  toElder({ type: "ask", kind: "reminder", text: "Good morning. Time for your calcium, one tablet with breakfast.", audio_url: null });
  await sleep(2500); heard("Took it.");
  if (state.memories[0]) { state.memories[0].stock_units -= 1; state.memories[0].log.push({ at: state.now, answer: "taken" }); toGuardian({ type: "memory", ...state.memories[0] }); }
  await say("Great. That bottle should last about four months. I'll order more before it runs out.");
  toElder({ type: "state", state: "idle" });
}

function route(text) {
  const t = text.toLowerCase();
  if (t.includes("gift card") || t.includes("someone called")) return sceneScam();
  if (t.includes("miracle") || t.includes("joint")) return sceneFake();
  if (t.includes("purple") || t.includes("calcium") || t.includes("empty")) return sceneRefill();
  return say("Sorry, say that again?");
}

const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (ws, req) => {
  const role = new URL(req.url, "http://x").searchParams.get("role") || "elder";   // /ws?role=elder | guardian
  (role === "guardian" ? guardians : elders).add(ws); all.add(ws);
  ws.send(JSON.stringify({ type: "clock", now: state.now }));
  if (role === "elder") ws.send(JSON.stringify({ type: "state", state: "idle" }));
  ws.on("message", (buf) => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m.type === "utterance" && m.text) route(m.text);
  });
  ws.on("close", () => { elders.delete(ws); guardians.delete(ws); all.delete(ws); });
  if (AUTOPLAY && role === "elder" && elders.size === 1) setTimeout(() => sceneRefill(), 5000);
});

// ---------- REST ----------
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }); res.end(JSON.stringify(body)); };
const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(JSON.parse(d || "{}")); } catch { r({}); } }); });
const visibleOrders = () => state.settings.share_level === "open" ? state.orders : [];

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (pathname === "/api/products") return json(res, 200, PRODUCTS);
  if (pathname === "/api/orders") return json(res, 200, { share_level: state.settings.share_level,
    month_total_cents: state.orders.reduce((a, o) => a + o.price_cents, 0), orders: visibleOrders() });
  if (pathname === "/api/memories") return json(res, 200, state.memories);
  if (pathname === "/api/alerts") return json(res, 200, state.alerts);
  if (pathname === "/api/settings" && req.method === "GET") return json(res, 200, state.settings);
  if (pathname === "/api/settings" && req.method === "PUT") { Object.assign(state.settings, await body(req)); return json(res, 200, state.settings); }
  if (pathname === "/api/utterance" && req.method === "POST") { const b = await body(req); route(b.text || ""); return json(res, 200, { ok: true }); }
  if (pathname === "/debug/reset") { reset(); toAll({ type: "clock", now: state.now }); toElder({ type: "state", state: "idle" }); return json(res, 200, { ok: true }); }
  if (pathname === "/debug/clock" && req.method === "POST") {
    const b = await body(req); state.now = b.now || state.now; toAll({ type: "clock", now: state.now });
    if (state.now.startsWith("2026-10-22")) sceneDelivery(); else if (state.now.startsWith("2026-10-23")) sceneReminder();
    return json(res, 200, { now: state.now });
  }
  const m = pathname.match(/^\/api\/alerts\/(.+)\/archive$/);
  if (m) { const a = state.alerts.find((x) => x.id === m[1]); if (a) a.archived = true; return json(res, 200, { ok: true }); }
  json(res, 404, { error: "not found" });
});
server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/ws")) wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  else socket.destroy();
});
server.listen(PORT, () => console.log(`TrustTag mock server on http://localhost:${PORT}  (ws://localhost:${PORT}/ws?role=elder|guardian)`));
