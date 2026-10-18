# Four-scene verification — 2026-10-18

Follow-up: `live-data-followup-qa.md` records the additional real Visa calls, hosted data inspection, archive-request fix, and updated frontend result (14 tests).

## Fixes verified

- Guardian monthly total refreshes every five seconds while visible and connected, on focus, and after reconnect. Default sharing still shows no ordinary order details; minimum still hides the total.
- Stale ledger responses cannot restore older, more permissive details. Settings writes are serialized in click order, with the ledger hidden until sharing changes settle.
- Reminder Pause/Resume submits only the changed field, uses the saved server response, and reports failure instead of pretending to save. Existing stock and dose logs are not overwritten.
- An elder product card is marked ordered only by a matching successful `order` event. A happy face during an offer does not mean the purchase succeeded. Simulated orders explicitly say **Simulated order**. Both real backend and development mock emit the confirmation; the contract is documented in shared-contracts.md.

## Local runtime and browser run

Real Fastify, HTTP, WebSocket, SQLite, risk, order, and Role D scheduler implementations were exercised with isolated in-memory data. The external Anthropic response was scripted at its HTTP boundary; provider TTS and STT were disabled. The browser used its speech synthesis fallback. This run does not certify Claude, MiniMax, Deepgram, or physical iPad audio.

| Scene | Input and observed result |
| --- | --- |
| 1 — introduction | `Hello?` asks for the AI helper's name; `Let's call you Lily.` saves Lily as the wake name, retaining Grandma as the elder name. Browser keyboard fallback was used. |
| 2 — refill and scam | Purple bottle offers calcium at $18 without a success stamp. Explicit yes produces one simulated order. The already-mounted default ledger updates $0 → $18 without exposing details. A caller's $500 gift-card request raises a red card; `Please call me.` appears as the elder's note. No scam purchase order is created. |
| 3 — alternative | Miracle Joint Pills is shown as risky, with Glucosamine at $24. Explicit okay buys only the alternative, labels it simulated, and the default ledger updates to $42. |
| 4 — delivery and reminder | Clock → Oct 22 09:00 UTC. Calcium and then glucosamine receipt questions appear. Both are confirmed received. Glucosamine's label dose is read and requires okay before creating a Memory. Clock → Oct 23 08:00:05 UTC. Reminder appears; `Took it.` records taken and reduces stock 90 → 89. Guardian displays 89 days and Taken. Pause persists through browser reload; Resume restores the active reminder. |

Automated validation: frontend 11 tests; backend 64 tests after integrating main's `d124f83` recovery update (including all four scenes through real HTTP/WS and the proactive queue); frontend production build; backend typecheck; mock server syntax check. Frontend lint exits successfully with existing warnings; no claim of a warning-free tree. Independent review found a concurrent sharing-save race, reproduced and fixed with a regression test; final review found no blocking issues. Nonblocking coverage gap: stalled-request recovery after the ten-second timeout is bounded in code but not directly exercised by its own test.

## Hosted verification — three scenes passed, fourth deferred

Target: `https://trusttag.onrender.com` (Render service name `milo`). At approximately 2026-10-18 01:28–01:31 PDT, GET settings/orders/memories/alerts returned normally. The elder WebSocket's initial state was already `thinking`. `POST /api/utterance` with `Hello?` did not return within the client's 45-second deadline, and no subsequent conversation events arrived during observation.

B then deployed `d124f83`; `/api/health` reported that commit and an idle conversation. This branch incorporates the update, resolving the pipeline conflict by keeping B's live-job cancellation check together with the Visa failure response and elder order event. All 64 backend tests and typecheck passed after the merge.

The subsequent hosted run passed scenes 1–3 with real provider responses: naming Lily, calcium offer and explicit simulated purchase, gift-card scam alert and elder note, glucosamine alternative and explicit simulated purchase. Response times in this small run were approximately 0.1–4.9 seconds. Six generated/cached MP3 URLs returned HTTP 200 with nonempty audio/mpeg bodies; the introduction file parsed as 32 kHz mono MP3, 4.068 seconds. This verifies generated audio assets, not physical speaker/microphone behavior.

Scene 4's clock endpoint returned HTTP 401 because the local environment lacks the hosted DEBUG_TOKEN. The user asked us not to duplicate A/B's ongoing debugging, so further hosted clock/STT work was deferred. No shared reset or deployment was performed. The second run started at default sharing; it remains default, and the temporary Lily name was restored to Milo. The two authorized simulated test orders and scam alert/note remain. The **local four-scene run passed; the hosted four-scene run is not complete**.

## Reproduction / next hosted run

1. Deploy the frontend and backend from the same revision: the new elder success stamp consumes the documented `order` event.
2. A/B can continue their own debugging; B's hosted recovery revision is already responding. Use the authorized demo clock token when resuming scene 4.
3. Complete the hosted delivery/reminder row with real providers. Verify actual audio playback, microphone transcription, and iPad behavior separately from HTTP/WS acceptance.
4. Keep default sharing selected during purchases to verify the silent-order ledger refresh; inspect simulated status before claiming a payment integration.
