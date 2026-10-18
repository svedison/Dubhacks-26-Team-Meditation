# Visa judge Q&A — simulation build

Verified against official public material on 2026-10-17. The user confirmed that no Visa Developer project is open and requested simulated payment for this delivery.

## 1. Which Visa capabilities are you using?

“This build simulates payment and labels each new purchase Simulated. Our working backend checks the trusted shelf, blocks suspicious requests, records orders and shares them according to the elder's settings. We have not integrated a Visa API yet. Visa Token Service and Intelligent Commerce are possible integration paths; Merchant Search and Transaction Controls are future options.”

Tokenization replaces card credentials; successfully obtaining a token would not, by itself, prove that a purchase was authorized or settled. [Visa Token Service](https://www.visa.com/en-us/products/visa-token-service)

## 2. How do you prevent an accidental payment?

“The demo asks for confirmation and rechecks the product, risk flag and price before placing the simulated order. Repeated processing of the same order ID preserves one order and one reference. A misheard ‘yes’ remains a known demo limitation. For production, we would require clearer product-and-price confirmation, authenticated user intent and payment credentials constrained to the approved purchase.”

Visa's Intelligent Commerce documentation describes consumer purchase instructions and transaction authentication. Amount and merchant restrictions are integration goals here, not controls enabled in this demo. [Visa Acceptance: Intelligent Commerce](https://developer.visaacceptance.com/docs/vas/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/home.html)

## 3. Can you turn off gift-card purchases on the card?

“TrustTag currently blocks gift-card requests in the application and creates a red alert. Visa Transaction Controls offers issuer-configured spending, funds-transfer and merchant-category controls. We have not enabled those controls. A merchant-category block is not a universal gift-card item block: a supermarket can sell both groceries and gift cards. We would need issuer support and evidence that the chosen rule covers the intended transactions.”

Visa documents controls based on a merchant's MCC; the supermarket example is an inference about the limitation of merchant-level categorization, not a claimed Visa item-level feature. [Visa Transaction Controls](https://developer.visa.com/docs/vctc)

## Later sandbox handoff

After the team opens a project, confirm the API actually available to that project and its required credentials. Use only test data. A connectivity or token-provisioning response is not sufficient to mark an Order `paid`. Prove the intended sandbox purchase flow and its failure/retry semantics before replacing `pay()`; keep the UI explicit about **Visa Sandbox**, since sandbox transactions are not real payments. [Visa testing guide](https://developer.visa.com/resources/environment-switching-and-testing), [Visa API reference](https://developer.visa.com/api-reference)

The current service provides in-process retry deduplication and atomic local persistence for simulation. A real payment adapter must also provide provider-side idempotency using `order.id`, reconcile a successful charge after a process crash/database failure, and handle a reset during an in-flight payment. Do not switch to live money by changing a status string.
