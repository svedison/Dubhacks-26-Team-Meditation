# Ledger refresh and four-scene verification

Goal: keep the guardian ledger current under the existing sharing contract, then exercise all four demo scenes and repair concrete failures.

Architecture: retain server-side privacy filtering and WS contracts. Add bounded, visible-page ledger refresh in the React provider; test real provider state with HTTP/WS boundary fakes. Verify the real backend pipeline separately, then use the deployed model/TTS with demo inputs.

Tech: React, TypeScript, Vitest/jsdom, Node test runner, Fastify, SQLite, browser UI.

Spec: shared-contracts.md, trusttag-hackathon-spec.md; user explicitly authorizes frontend fixes and live demo orders/reminders. Payments remain simulated. Never reset shared online data or print credentials.

Review focus: stale HTTP responses after privacy changes, request/timer cleanup, delivery queue, dose confirmation, reminder stock updates, actual vs simulated provider evidence.

- [x] Add failing provider regressions for silent purchases, visibility/reconnect, stale privacy responses.
- [x] Implement bounded ledger refresh, run tests and frontend build/lint.
- [x] Exercise all four scenes through real HTTP/WS/pipeline with isolated storage; repair failures with regression tests.
- [ ] Hosted scenes 1–3 passed after B deployed recovery; scene 4 requires the demo clock token and is deferred at the user's request while A/B debug. Local browser run completed all four.
- [x] Fresh review and final suites completed; commit/push status is recorded on the existing PR. Hosted deployment remains separate.

## Execution record

- Baseline: d8254ec; branch codex/visa-sandbox. Existing default-share reproduction: GET total increased from 0 to 1800 while WS ordinary order count stayed zero, so the mounted UI never refreshed.
- User chose live hosted verification in addition to local isolated tests. Local model/voice credentials are absent; hosted inputs are synthetic demo content.
- Implementation uses the writing-plans and executing-plans workflow in this existing isolated branch; user already authorized execution without another plan approval.
- Additional bugs reproduced and fixed: rejected full-Memory PUT with false optimistic UI, success stamp before purchase consent, overlapping sharing saves temporarily revealing older details.
- Decision: add an explicit elder `order` event to the shared contract rather than infer success from emotion or English reply text. Frontend/backend must deploy together for the success stamp; older clients ignore the extra event.
- Final review: frontend 11/11 and backend 55/55 independently passed; no blocking findings remain. Minor deferred: direct timeout-recovery test coverage.
- Integrated main d124f83 without dropping Visa failure handling or the new elder order event. Backend 64/64 and typecheck passed after conflict resolution; pushed merge 4c46447.
- Hosted retry passed scenes 1–3 and MP3 asset checks. User requested avoiding duplicate A/B debugging; further clock/STT checks are deferred. Temporary wake name restored; simulated test orders retained.
