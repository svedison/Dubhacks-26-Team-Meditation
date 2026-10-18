# TrustTag Role D — Memory, anomaly rules and demo data

Implements `.plans/role-d-memory-anomaly-data-spec.md` against `.plans/shared-contracts.md`. The repository currently contains the scripted `tools/mock-server`, not B's production backend. This package is an independently runnable TypeScript module with a persistent local integration harness. No frontend, payment, STT or LLM code is changed.

## Run

Requires **Node 24+** (native TypeScript and `node:sqlite`). From this directory:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm start
```

The harness listens on `http://127.0.0.1:8787`, with WebSockets at `/ws?role=elder` and `/ws?role=guardian`. SQLite state defaults to `runtime/role-d.sqlite`. `PORT`, `HOST`, `ROLE_D_DB`, `CORS_ORIGINS` (comma-separated exact frontend origins) are configurable. Once this module's dependencies are installed, `npm run start:role-d` from `tools/mock-server` starts the same harness; the original `npm start` still runs the scripted mock. Stop one before starting the other on port 8787.

This is a local synthetic-data harness. Its order/settings reads are fixtures, without C's sharing filter, authentication or payment. Do not put this harness on a public URL or use it for real accounts. B should mount the module behind its existing access controls and C's sharing filter. TTS is delegated to B; `audio_url: null` uses A's browser speech fallback.

## Scene 4: real answers and real scheduling

```sh
curl -X POST localhost:8787/debug/reset
curl -X POST localhost:8787/debug/orders -H 'Content-Type: application/json' \
  -d '{"product_id":"calcium-120","deliver_on":"2026-10-22"}'
curl -X POST localhost:8787/debug/clock -H 'Content-Type: application/json' \
  -d '{"now":"2026-10-22T09:00:00Z"}'
curl -X POST localhost:8787/api/utterance -H 'Content-Type: application/json' \
  -d '{"text":"Yes, got it.","source":"keyboard"}'
curl -X POST localhost:8787/api/utterance -H 'Content-Type: application/json' \
  -d '{"text":"Okay.","source":"keyboard"}'
curl -X POST localhost:8787/debug/clock -H 'Content-Type: application/json' \
  -d '{"now":"2026-10-23T08:00:00Z"}'
curl -X POST localhost:8787/api/utterance -H 'Content-Type: application/json' \
  -d '{"text":"Took it.","source":"keyboard"}'
curl localhost:8787/api/memories
```

Expected: `ask/received`, `ask/dose_confirm`, Memory with 120 units, `ask/reminder`, updated Memory with 119 units and a `taken` log. The next spoken response estimates **119 days**. The two Memory events render ordinary cards using the existing contract. Repeated receipts, ticks, backward clock jumps and process restarts do not repeat stock movements. Reset restores one historical calcium order (product alias `the purple bottle`), no memories/alerts, the demo clock and all five placeholder photo URLs.

`later` snoozes the same occurrence for 15 minutes, without changing `times` or deducting stock. `skipped` does not deduct. After 60 seconds without an answer the log says `unconfirmed`, and inventory conservatively deducts once. `answerReminder(memoryId, scheduledAt, 'skipped')` can correct a previous unconfirmed dose and refund exactly the amount that was deducted, even near zero inventory. Pausing/changing/deleting a Memory invalidates its outstanding prompts and snoozes.

Remaining days = stock / (units per dose × daily times). Below 3 days, one ordinary refill note is emitted and `takeRefillSuggestion()` offers a conversational question once. This does not place an order. Receipt replenishes stock and resets refill suppression. Existing Memory schedules are not recreated on replenishment.

## Scene 2: immediate red card, then explanation

Send `Someone called and asked me to buy a gift card today.` to `/api/utterance`. The harness uses a deterministic scam fixture; C's production classifier should instead call `recordAnomaly` directly.

As explicitly selected by the user, the service emits `speak` with **“I'll let your daughter know, okay?”** before emitting the red `alert` immediately. The first card has `grandma_note: null`; the next answer updates that **same alert ID** with the exact original text. No fabricated consent is stored. The local socket test verifies delivery, but a 2-second end-to-end guarantee still requires B's live TTS, network and both actual devices.

## Integrating into B and C

```ts
import { createRoleD, SqliteStore } from './modules/role-d/src/index.ts';

const roleD = createRoleD({
  store: new SqliteStore('/your/server/data/role-d.sqlite'),
  emit: (audience, event) => {
    // Forward through B's event bus. Apply C's sharing policy to guardian events.
    // Intercept speak/ask for B's TTS; preserve type and kind from the contract.
  },
});
const now = () => roleD.now(); // B and C must use this for every business timestamp.
const scheduler = setInterval(() => roleD.tick(), 1000);

// C calls after recording a new paid/simulated_paid order, before receipt:
roleD.addOrder(order);
// C's /api/orders/:id/received handler (idempotent):
roleD.receiveOrder(order.id);

// Before sending an utterance to normal shopping/AI routing:
if (!roleD.handleAnswer(text)) {
  // Continue B/C conversation; optionally include roleD.takeRefillSuggestion().
}

// C's check() found a scam; pass a stable conversation/action ID for retries:
roleD.recordAnomaly({rule: 7, level: 'red', title: 'Check on Mom',
  body: 'A request suggests possible pressure or a scam. Please check in.'}, actionId);

// On actual order attempts / structured cognitive observations:
roleD.evaluateAnomalies({candidate: order, coldStart: true}, actionId);
```

`Store` is the tiny `{load(): State|null; save(state): void}` interface. B may implement it on its own SQLite connection; the supplied adapter saves one atomic snapshot including pending prompts, logs, receipts, occurrence keys and notification deduplication. It is a **single-process** adapter, not a multi-worker database design. External state changes must go through service methods. Shutdown should clear B's interval and close its store.

`evaluateRules(context)` is also exported as a pure function. C/B supply ordered observations for `blockedAttempts` and `cognition`; timestamps use the same `now()`. The engine supports all eight product-plan rules. Cold start defaults to fewer than ten paid orders or less than thirty days of history, and enables **only 1, 4, 7, 8**, as required by D's spec. Rule 4 needs at least one historical price; it never invents a median. Rule 2 uses three complete previous UTC calendar months and the recent rolling thirty days; rules 3/5 can be suppressed with `holidayWithin14Days`; confirmed intentional stockpiling exempts rule 1's first two checks but not ninety-day stock. The caller must provide these structured flags from confirmed conversation context, not raw guesses. Baseline-dependent rules require `coldStart: false` in small test fixtures.

Single yellow alerts remain in history without a socket push. Two unpublished yellows within seven days trigger one notification for the latest card. Stable `(eventId, rule)` keys prevent duplicate alerts. Rule 8 reports only a pattern, never a transcript. Grandma's own explanation is kept separately in `grandma_note` as required.

## Contract coverage and local-only additions

Implemented contract routes: GET products/orders/memories/alerts/settings, PUT memory, POST received/archive/utterance/debug clock/debug reset. WebSocket payloads are flattened (`{type:'memory', ...memory}`), matching the existing mock. The same `tick()` handles one-second wall-clock progression and explicit demo-clock jumps. Clock input requires an ISO timestamp with an explicit timezone. Schedules are **UTC**, matching the contract's `08:00Z` examples; B must agree on household timezone semantics before using local household schedules. The demo clock continues advancing after a jump and survives restart.

Local-only endpoints are `/health`, `/debug/orders` (safe simulated-order fixture), and `DELETE /api/memories/:id`. The shared contract lists deletion without specifying a payload/event; this package does not silently change B's contract document. DELETE returns `{ok:true}` and the caller should refetch the Memory list. The typed `deleteMemory` method is ready for B's chosen wire contract. Settings mutations, audio ingestion, payment and sharing remain owned by B/C.

## Data and assets

- `data/products.json`: 20 **synthetic demo** products, brand/merchant/ingredients/price/certification-source metadata, and 3 fictional risky products with matching demo alternatives. `miracle-joint` aliases `miracle joint pills` and pairs to `glucosamine-usp`.
- **Certification labels, label doses, FDA/recall risk kinds and alternative marketing themes are fixtures, not verified real certifications, medical recommendations, real regulatory findings or equivalent efficacy claims.** Every record carries `demo_only: true` and a source-status explanation. Replace with verified real product records before real shopping.
- `data/orders.json`: one received historical calcium order; its product has `the purple bottle` alias. Historical stock is deliberately not inferred into a new Memory.
- `assets/sounds/*.wav`: seven original royalty-free short cues named for contract states.
- `assets/photos/family-{1..5}.svg`: five illustrated placeholders, clearly labeled; replace with family-approved photographs.
- `assets/LICENSE.md`: CC0 provenance. Regenerate with `python3 scripts/generate-assets.py`.

The harness serves these allowlisted files at `/assets/...`; it cannot resolve arbitrary request paths. The module contains no secrets and makes no external medical, payment, AI or audio API requests.
