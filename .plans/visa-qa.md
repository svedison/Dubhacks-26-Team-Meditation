# Visa judge Q&A — sandbox account validation, simulated payment

Updated 2026-10-18. The user authorized creating a Visa Sandbox project and using local test credentials. Live Hello World returned HTTP 200. Payment Account Validation returned an encrypted HTTP 200 response with actionCode 00 and an approval code. This validates a Visa test account; it does not purchase anything.

## 1. Which Visa capabilities are you using?

“We integrated Visa Payment Account Validation in the sandbox using mutual TLS and message-level encryption. An optional backend check validates a fixed Visa test account before simulated checkout. It does not validate the elder's actual card or authorize a purchase. Orders remain Simulated. Our backend also checks the trusted shelf, blocks suspicious requests, records orders and shares them according to the elder's settings.”

Payment Account Validation was approved for the project; Intelligent Commerce displayed an access lock and was not enabled. No Token Service, Merchant Search or Transaction Controls integration is claimed. [Payment Account Validation](https://developer.visa.com/docs/pav), [Message-level encryption](https://developer.visa.com/docs/message-level-encryption)

Tokenization replaces card credentials; successfully obtaining a token would not, by itself, prove that a purchase was authorized or settled. [Visa Token Service](https://www.visa.com/en-us/products/visa-token-service)

## 2. How do you prevent an accidental payment?

“The demo asks for confirmation and rechecks the product, risk flag and price before placing the simulated order. Repeated processing of the same order ID preserves one order and one reference. A misheard ‘yes’ remains a known demo limitation. For production, we would require clearer product-and-price confirmation, authenticated user intent and payment credentials constrained to the approved purchase.”

Visa's Intelligent Commerce documentation describes consumer purchase instructions and transaction authentication. Amount and merchant restrictions are integration goals here, not controls enabled in this demo. [Visa Acceptance: Intelligent Commerce](https://developer.visaacceptance.com/docs/vas/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/home.html)

## 3. Can you turn off gift-card purchases on the card?

“TrustTag currently blocks gift-card requests in the application and creates a red alert. Visa Transaction Controls offers issuer-configured spending, funds-transfer and merchant-category controls. We have not enabled those controls. A merchant-category block is not a universal gift-card item block: a supermarket can sell both groceries and gift cards. We would need issuer support and evidence that the chosen rule covers the intended transactions.”

Visa documents controls based on a merchant's MCC; the supermarket example is an inference about the limitation of merchant-level categorization, not a claimed Visa item-level feature. [Visa Transaction Controls](https://developer.visa.com/docs/vctc)

## Current sandbox handoff and remaining payment work

Use `npm run visa:check` with `VISA_SANDBOX_DIR` set to a private local credential directory. `VISA_SANDBOX_PREFLIGHT=1` enables the test-account check inside `pay()`; default 0 keeps the demo offline. An enabled check fails closed on configuration, network, encryption or validation errors. Success remains `simulated_paid`, with a private `sim_` reference. No card data comes from Settings or an HTTP request. See `server/README.md` for setup.

The remaining step is access to an appropriate purchase API and proof of the intended sandbox purchase flow, including failure/retry semantics. A successful account check or token provisioning response cannot justify marking an Order `paid`. [Visa testing guide](https://developer.visa.com/resources/environment-switching-and-testing), [Visa API reference](https://developer.visa.com/api-reference)

The current service provides in-process retry deduplication and atomic local persistence for simulation. A real payment adapter must also provide provider-side idempotency using `order.id`, reconcile a successful charge after a process crash/database failure, and handle a reset during an in-flight payment. Do not switch to live money by changing a status string.
