# Visa sandbox integration plan

Goal: prove an authenticated Visa Sandbox request and integrate the available Payment Account Validation (PAV) API into the existing backend without representing account validation as payment.

Spec: role-c-risk-payment-visa-spec.md and shared-contracts.md, plus the user's request to create a project, test available APIs and integrate them.

## Global constraints

- Sandbox only. The user approved generating and storing test credentials locally. Secrets stay outside the repository and exports.
- PAV is enabled; Intelligent Commerce was shown with a lock. PAV verifies a sandbox account, not a purchase. Every order remains simulated_paid.
- Use only a configured Visa test fixture. Never accept a real card from HTTP input or infer a card from Settings.card_last4.
- Mutual TLS, Basic authentication and mandatory MLE remain enabled. Bound network duration and response size. Reject errors, malformed responses and unencrypted successful PAV responses.
- Existing risk, explicit confirmation, order deduplication, privacy, frontend and voice flows stay intact.

## Task 1: Sandbox client and diagnostic command

- Add failing tests for JWE headers and encrypted payload roundtrip, tampering, missing/redacted credentials, rejected/malformed PAV results and fixed sandbox targeting.
- Implement a narrow HTTPS client and MLE helpers using jose, plus a diagnostic CLI for Hello World and PAV. Use the real clock for cryptographic timestamps.
- Run targeted tests and typecheck. Run Hello World and PAV using local secrets and the portal's test data; record only sanitized evidence.

## Task 2: Optional account validation before simulated checkout

- Add failing tests proving enabled validation failures prevent order persistence, success remains simulated, duplicate order retries do not repeat validation, and disabled mode preserves existing behavior.
- Wire an opt-in sandbox validation gate into pay(). Keep sanitized live-test evidence outside the order schema; do not persist card data or raw responses. No payment endpoint or arbitrary PAN input.
- Run the full backend suite and typecheck.

## Task 3: Verify and hand off

- Verify the real backend path with external AI/voice disabled, document exact API results and the still-simulated payment boundary.
- Update README and Visa Q&A; inspect the diff for secrets and request a final independent review.
- Export a reviewable change and report completed versus blocked live checks precisely.

## Review focus

- No credential, raw payload, test card or provider body leaks in errors, logs or order events.
- No success from HTTP 200 alone, a declined action code, a malformed or plaintext PAV response, or a connectivity-only response.
- Credentials cannot target production or an arbitrary host. Timeouts cover the entire request.
- No false paid status; pending reset and same-ID concurrency semantics remain correct.

## Decisions and progress

- Fresh feature branch codex/visa-sandbox in this chat's isolated clone, based on origin/main c435aa8. Remote main was rewritten after the previous delivery; old local main is preserved.
- Baseline 39/39 tests passed before changes.
- Sandbox project created with PAV approved. Mutual TLS and MLE certificates downloaded and private-key pairs verified.
- Initial 401/9124 was caused by tool password redaction. After the user saved the API password locally, Hello World returned HTTP 200 and PAV returned encrypted HTTP 200/actionCode 00 with approval code. The implemented CLI repeated both successfully at 2026-10-18T08:12:36Z.
- Ruling: proceed with the available PAV test API under the user's request to inspect usable APIs. Do not claim it implements the originally proposed Intelligent Commerce payment path.

- Implementation: fixed sandbox host, mTLS/Basic/MLE, strict response checks, bounded network call, sanitized diagnostic CLI, opt-in pay() preflight. PaymentResult and Order contracts remain unchanged. Validation evidence stays in sanitized CLI/live-check output; no extra database writes during the preflight, so reset/atomic-order semantics remain intact.
- Verification: 55/55 backend tests and TypeScript passed. Live invalid-account fixture was rejected. Live PAV in the real confirmation/placeOrder/SQLite path produced simulated_paid, one guardian WS event and a visible ledger entry; model classification and TTS were stubbed offline. Sanitized evidence: outputs/visa-backend-result.json outside the repo.
- Independent review complete: clarified checkout failure and retry guidance; isolated credential-validation tests. Both findings resolved. Final typecheck and git diff --check passed; changed-file secret scan found no credential values or private keys. Local ignored .env enables the sandbox preflight; committed example keeps it disabled.
