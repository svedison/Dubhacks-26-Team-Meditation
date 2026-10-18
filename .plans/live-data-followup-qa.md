# Real API follow-up — 2026-10-18

## Real services checked

- The hosted `/api/health` reported commit `f9b62a6`, idle, with an elder microphone session connected. The guardian Home and Money pages loaded against the hosted backend. GET settings, orders, memories, alerts, and products returned HTTP 200. At inspection the monthly total was zero, with no visible orders, memories, or alerts; the catalog contained the 20 demo shelf products. No shared settings, clock, records, or conversation were changed during this follow-up.
- Visa Hello World and encrypted Payment Account Validation were called with the already-authorized local credentials and fixed sandbox fixture. Validation returned action code `00`. This is a real sandbox response, not a real-card charge or live merchant catalog.
- The actual `placeOrder()` path then performed another real Visa sandbox check against an isolated in-memory SQLite database. Concurrent duplicate submissions and a later retry produced one validation call, one simulated order, and a monthly-total increase of 1800 cents. Default sharing withheld the ordinary order. The saved evidence contains only sanitized approval metadata; credentials, PAN, CVV, and raw provider responses remain outside reports/Git.

## Archive bug reproduced and repaired

The guardian's bodyless archive POST was sent with `Content-Type: application/json`. Real Fastify returned HTTP 400 before reaching the archive handler. Meanwhile the frontend optimistically marked the alert archived, so a failed request falsely appeared handled until reload.

- Bodyless requests now omit the JSON content type. Requests with a JSON body retain it.
- A warning remains active until the server accepts archive. The button shows Saving while pending; failure leaves the warning visible with a retry message.
- Browser verification used the real local HTTP/WS backend and isolated demo data. A local-only proxy injected one HTTP 503: the warning remained visible, the error appeared, and SQLite still reported `archived: false`. The real HTTP 400 was reproduced separately, then corrected. Retrying the corrected request archived successfully; reloading retained the Seen history entry, which expanded to the original warning and elder note.

## Validation and integration

- Frontend: 14/14 tests and production build passed. Lint completed with existing warnings.
- New regression coverage: pending/failed archive, retry, bodyless request format, and preservation of A's idle-transcript behavior while keeping explicit order confirmation.
- Main through `f9b62a6` is incorporated into this branch. The reducer conflict was resolved by retaining A's deferred idle transcript and the explicit successful-order event; happy emotion alone still cannot mark an item ordered.
- No backend implementation changed in this follow-up; the prior 64-test backend result remains recorded in `four-scenes-qa.md`.
- PR changes are not deployed. Hosted fourth-scene clock testing and physical microphone/speaker validation remain deferred; this follow-up did not take over A/B's active elder session.
