# Role C implementation plan

> For agentic workers: use superpowers:executing-plans to implement this plan task by task.

**Goal:** Complete the risk/payment/order/settings backend against the supplied role C specification.

**Architecture:** Keep B's Fastify routes, SQLite store, conversation queue and public contracts. Keep `check()` repeatable, and route rule-7 creation through D's existing `createAlert()` integration. Add a single order service for atomic persistence and retry handling; retain `risk.ts` exports for B compatibility.

**Tech stack:** TypeScript ESM, Fastify, Zod, node:sqlite, Node test runner.

**Spec:** `.plans/role-c-risk-payment-visa-spec.md`, `.plans/shared-contracts.md`.

## Global constraints

- Backend role C only; preserve frontend, voice providers and D's module ownership.
- `check(product_id, text) -> {ok, reason, alternative?}`; `pay(order) -> {status, ref}`.
- Default payment status is `simulated_paid`; no live payment or claimed Visa integration.
- All business dates use `clock.now()`; payment references stay in private KV storage.
- Preserve the existing ledger envelope and all Order fields.
- A Visa sandbox attempt is conditional on the Scene 2 gate, the scheduled time and available developer access; otherwise retain the explicitly supported simulation fallback.

## Review focus

1. Ordinary requests containing “today” must not become scam alerts; urgency and gift-card requests must.
2. Forged amounts, blocked/received drafts and changed catalog risk must never reach payment.
3. A retry must not create a second order or replace its payment reference; failed persistence must roll back both records.
4. Minimum/default sharing must not leak ordinary order details through REST or WebSocket; month totals must respect UTC offsets and the demo clock.
5. Receipt retries and invalid settings must preserve inventory/settings; reset must invalidate an in-flight order.

## Task 1: Risk and payment validation

Files: `server/src/modules/risk.ts`, `server/test/risk-payment.test.ts`, `server/test/backend.test.ts`.

Interfaces: preserve `check()`, `isScam()`, `pay()`; export `PaymentResult` with `status: 'paid' | 'simulated_paid'` and `ref: string`.

- [x] Write tests for the three demo products, risk kinds, missing/unsafe alternatives, scam precedence, ordinary “today”, malformed/payment-ineligible drafts and catalog-price mismatch.
- [x] Run `node --import tsx --test test/risk-payment.test.ts`; observe failures for ordinary “today” and unsafe drafts.
- [x] Implement narrowly matched bilingual scam triggers and strict payment validation; keep simulated success explicit.
- [x] Run `npm test` and `npm run typecheck`; commit the verified task.

## Task 2: Order persistence and ledger

Files: create `server/src/modules/orders.ts`; modify `server/src/pipeline.ts`, `server/src/modules/risk.ts`; create `server/test/orders.test.ts`.

Interfaces: `placeOrder(draft: Order, isCurrent?: () => boolean): Promise<Order | null>` consumes `pay()` and atomically stores Order + payment ref before publishing. Pipeline remains responsible for explicit consent, draft construction and generation invalidation.

- [x] Test same-ID retry, changed-ID-payload conflict, rollback on SQLite failure, stale generation and real guardian events after confirmation.
- [x] Test default/minimum/open filtering, blocked-order exclusion from monthly totals and offset timestamps at month boundaries.
- [x] Run the tests and observe failures; implement the service and wire the one existing confirmation path to it.
- [x] Run the full suite and typecheck; commit the verified task.

## Task 3: Acceptance, handoff and Visa Q&A

Files: create `server/test/role-c-api.test.ts`, `.plans/role-c-handoff.md`, `.plans/visa-qa.md`; update `server/README.md` and clarify existing response semantics in `.plans/shared-contracts.md`.

- [x] Exercise REST settings validation and all three share levels, duplicate receipt and blocked receipt; verify Scene 2 order + rule-7 alert and Scene 3 alternative via actual WS transports with only external AI/TTS replaced.
- [x] Verify persisted orders/payment refs survive a fresh process, plus actual localhost HTTP/WS smoke.
- [x] Check official Visa documentation and write three honest English Q&A answers distinguishing implemented app checks, simulated payment and proposed Visa capabilities.
- [x] Run full suite, typecheck and `git diff --check`; request an independent code review, address important findings, and export a reviewable patch and handoff.

## Decisions and progress

- The user's supplied specs and explicit development request authorize implementation; no replacement design or repeated approval gate is needed.
- Work is isolated in this chat's fresh clone on `codex/role-c-risk-payment`, based on `c8e5a2c`.
- Baseline: 20/20 tests passed on Node 24.21.0. Dependency install reports one moderate and one high advisory; inspect before final handoff.
- Preserve B's pure risk checker and existing D alert call site to avoid duplicate alerts. Blocked checks remain decisions/alerts rather than inventing purchase records without consent.

- Task 1 complete: targeted tests failed on hyphenated gift-card, ordinary today and forged amounts, then full suite 26/26 + typecheck passed.
- Task 2 complete: rollback/retry and UTC boundary tests failed, then full suite 32/32 + typecheck passed.
- Task 3 complete: settings, receipts, HTTP/WS scenes and restart persistence passed; production entrypoint smoke passed.
- User confirmed no Visa project and requested simulation only.
- Final review: independent reviewer found one P2 (decimal amounts split urgency phrases). Added a failing regression, fixed normalization, and verified full suite 38/38 + typecheck. No deferred minor findings.
- Ruling: leave existing provider/static dependency upgrades, authentication, physical-device/voice/D expansion and real-payment cross-process reconciliation outside this simulation delivery; they require coordinated team work and remain documented limitations.
