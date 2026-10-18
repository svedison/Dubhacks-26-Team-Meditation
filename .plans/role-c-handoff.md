# Role C handoff

Base: `c8e5a2c` (B backend skeleton). Branch: `codex/role-c-risk-payment`.

## Implemented

- `modules/risk.ts`: repeatable `check(product_id,text)`, configured safe alternatives, bilingual scam detection and `pay(order)` validation. Ordinary “today” no longer triggers a scam; gift-card, transfer, caller and same-day urgency cues do. Unknown products fail closed.
- Payment stays `simulated_paid`. `PaymentResult` supports `paid | simulated_paid` without changing the public Order shape. The adapter rejects mismatched catalog prices, malformed, blocked or already-received drafts and never stores full card data.
- `modules/orders.ts`: `placeOrder(draft, isCurrent?)` is the single successful-order writer. It snapshots/validates the draft, deduplicates concurrent and later same-ID retries, rejects ID reuse for a different intent, writes Order + private payment ref in one SQLite transaction, then publishes. A debug reset cancels a pending simulated write.
- `pipeline.ts`: existing explicit confirmation and last-minute price/risk checks call the order service. No changes to voice providers or frontend code.
- Ledger uses the demo clock's UTC month, including timestamp offsets, and counts `paid`/`simulated_paid` only. REST and WS obey minimum/default/open.
- Existing Settings GET/PUT and D's receipt handler were verified through the real routes. Invalid settings leave persisted values unchanged. Duplicate receipt does not add stock twice; blocked receipt returns 409.
- Three English Visa answers are in `visa-qa.md`. The user chose simulation; no sandbox integration is claimed.

## B integration

Continue calling `risk.check()`/`risk.isScam()` as before. `check()` is deliberately side-effect free: pipeline may call it repeatedly, while its existing `createAlert('red',7,...)` call into D creates one alert per detected scam request and records the next reply as `grandma_note`.

Construct one Order draft only after consent and pass it to `placeOrder(draft, () => generationIsCurrent)`. Reuse the same ID only for a retry of that exact product, price and timestamps. Do not separately write `orders` or `kv/payment:*`, and do not separately publish the successful order.

`pay()` remains the single provider implementation; provider errors must throw. There is no automatic conversion from a failed external payment to simulated success. See the real-payment prerequisites in `visa-qa.md` before adding a provider.

## D and A integration

D continues to own shelf data, `risk.alternative_id`, alert levels, `markReceived()` and Memory creation. C uses the existing three seeded products and does not replace D's data. The received route calls D's transactional helper; existing Memory stock increases by `product.units`, with no invented dose or new Memory before confirmation.

A should render `status: simulated_paid` as **Simulated**. No extra Order fields were added. `GET /api/orders` keeps `{share_level,month_total_cents,orders}`. Use `share_level: open` when demonstrating ordinary order notifications; minimum/default intentionally suppress their detail events. Re-fetch the ledger for the default monthly total; the current contract has no aggregate WS event. Details already seen under open cannot be recalled from a phone by subsequently reducing sharing.

Blocked catalog/scam decisions create no purchase without consent. Scam attempts are represented by D's rule-7 Alert; `blocked` Order rows written by other integrations remain visible in all sharing levels. Alerts are not included in spending totals.

## Validation

From `server/`, with Node >=22.13:

```sh
npm ci
npm run typecheck
npm test
```

38 tests currently pass, including actual ephemeral localhost HTTP/WebSocket transport for Scene 2 and Scene 3, all three sharing levels, one red alert plus grandma note, a database-failure rollback, repeat receipt, same-ID retries, and a fresh-process SQLite persistence check. Only external Claude output is stubbed in the full-flow test; TTS is disabled. No test calls paid APIs. The production `npm start` entrypoint also passed the existing `npm run smoke` script on port 8799 with external keys disabled.

An independent read-only review found one urgency-regex regression involving decimal amounts (`must pay $500.00 today`). A new test reproduced the failure; decimal punctuation is now preserved within the urgency phrase while real sentence boundaries remain separate. No other actionable findings or deferred minor findings were reported for this simulation scope.

This is backend acceptance evidence, not a claim that a physical phone/iPad, real speech recognition, frontend Simulated label, or live provider latency has been checked.

## Existing dependency advisories

`npm ci`/`npm audit` on the unchanged lockfile reports one high (`@fastify/static`) and one moderate (`@anthropic-ai/sdk`) vulnerable dependency. Fixes require versions outside the current declared ranges. These belong to B's static-serving/provider dependencies; no forced upgrades were made in C's change. Coordinate upgrades before deployment. The backend still has B's unauthenticated hackathon API and is not a production payment service.
