# Changelog

All notable changes to `@melakudemeke/telebirr-js` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [3.2.0] — 2026-09-21

Brings the library level with telebirr-php 2.3.0 and 2.4.0: the notify leg and
queryOrder, corrected against live production payloads. Fully backward
compatible with 3.1.0 — new methods, new fields, and verification that accepts
strictly more genuine payloads while refusing everything it refused before.

The theme: **a correct integration, a correct key, a genuinely paid payment, and
the library reporting otherwise with no error to notice.** Telebirr's three legs
(notify, return URL, queryOrder) do not share a vocabulary, and every difference
failed silently.

### Fixed
- **`trade_status: Completed` now reads as a successful payment.** The notify leg
  reports `Completed` where the return URL and queryOrder report `PAY_SUCCESS`, so
  `isPaymentSuccessful()` returned `false` for a verified, genuinely paid
  notification.
- **`NotificationHandler.parse()` unwraps a `data` envelope.** Left wrapped,
  `merch_order_id` and `sign` are invisible, so the callback read as unsigned
  *and* unmatched. Only unwrapped when the inner object carries
  `merch_order_id`, so a flat body with an unrelated `data` key is untouched.
- **Telebirr signs the transaction id as `trans_id` and sends it as `transId`.**
  The canonical string is built from the keys as received, so it could never
  match the one they hashed, and **every notification carrying a transaction id
  was refused**. The rename changes both the name and the sort position
  (`transId` sorts before `trans_currency`; `trans_id` after `trans_end_time`),
  so no reordering of the received keys rescues it. `SignatureVerifier` now
  tries the payload exactly as received first, then the aliased spelling.
- **Every distinct decoding of the signature is tried against the key,** not
  just the first that parses, so a reading that decodes to the wrong bytes can
  no longer shadow the correct one.
- **`normalizeSignature()` now repairs spaces unconditionally.** It previously
  gave up when the signature also contained a literal `+` — exactly the
  partially encoded case that needs it. A space is never valid base64.
- **A malformed `%` sequence in a signature no longer throws** out of
  `SignatureVerifier.verify()`; it simply fails verification.
- **`getOrderStatus()` now reads `order_status`.** queryOrder answers with
  `order_status`, not `trade_status`, so `tradeStatus` came back empty and
  **`paid` was `false` for a genuinely paid order** — on the leg integrations
  lean on when a callback is late.
- **`getOrderStatus()` now reads `trans_time`,** queryOrder's name for the
  timestamp, so `transEndTime` is no longer always `null` there.

### Added
- **`NotificationHandler.handle(rawJson, config)`** — parse, unwrap, verify and
  extract in one call, mirroring `ReturnUrlHandler.handle()`. Fails closed with a
  `TelebirrError` on a missing or invalid signature. Returns `PaymentInfo` plus
  `isSuccess` (exported as `NotificationPaymentData`).
- **`NotificationHandler.unwrap()`** — the envelope logic on its own.
- **`NotificationHandler.toUnixSeconds()`** — the notify leg sends epoch
  **milliseconds**, the return URL sends `Y-m-d H:i:s`. Non-numeric values yield
  `null` rather than a guessed timezone.
- **`PaymentInfo` gains `transId`, `merchCode`, `appId`, `notifyUrl`,
  `timestampUnix`, `notifyTimeUnix` and `raw`.** `transId` is the id on the
  customer's SMS receipt — previously parsed and discarded.
- **`OrderStatus.transId`** (queryOrder sends `trans_id`; `transId` also accepted).
- **`ReturnUrlPaymentData` now has the same shape as `NotificationHandler.handle()`'s
  result**, so settlement code no longer has to care which leg delivered the
  payment. `transId` is empty on this leg, which carries none.

### The three legs, side by side

| Concept | notify | return URL | queryOrder |
|---|---|---|---|
| status field | `trade_status` | `trade_status` | **`order_status`** |
| success value | `Completed` | `PAY_SUCCESS` | `PAY_SUCCESS` |
| transaction id | `transId` (signed as `trans_id`) | *absent* | `trans_id` |
| timestamp field | `trans_end_time` | `trans_end_time` | **`trans_time`** |
| timestamp format | epoch milliseconds | `Y-m-d H:i:s` | `Y-m-d H:i:s` |

### Notes
- `verifyFromRawQueryString()` shares the same verification path, so it gets
  every signature fix too.

## [3.1.0] — 2026-07-16

Driven by field notes from a real Next.js integration. Fully backward compatible with 3.0.0.

### Added
- **Key auto-normalization**: `privateKey`/`telebirrPublicKey` now accept bare base64 DER
  (the format Ethio Telecom actually issues) as well as PEM — including PEM with literal
  `\n` from env files. The right header (PKCS#8/PKCS#1, SPKI) is detected automatically.
  No more `ERR_OSSL_UNSUPPORTED` on first run. (`KeyNormalizer` is exported for direct use.)
- **Bundled Telebirr CA**: the test gateway serves an incomplete TLS chain; the missing
  GlobalSign intermediate is now bundled and trusted *in addition to* the system store, so
  TLS verification works out of the box — `verifySsl: false` should never be needed.
  TLS verification failures now explain themselves and point at the fix.
- **Structured gateway errors**: `ApiError` now exposes `telebirrCode`, `telebirrMessage`,
  and `telebirrSolution` parsed from Telebirr's error envelope, and `errorCode` is populated
  from the body when present. `ApiError.isTransient()` identifies retryable failures.
- **Opt-in retry with backoff**: `new Telebirr(config, logger, http, { retry: { retries: 2 } })`
  retries transient failures (Telebirr infra codes such as `49401024991`, HTTP 502/503/504,
  transport timeouts) with exponential backoff. Off by default.
- **`getOrderStatus(merchOrderId, prepayId?)`**: high-level, typed, server-to-server order
  verification — the settlement counterpart to `createCheckoutUrl`. Returns
  `{ paid, failed, cancelled, tradeStatus, amount, currency, paymentOrderId, merchOrderId, transEndTime, raw }`.
- **Typed responses**: `createOrder` returns `CreateOrderResponse` (guaranteed
  `biz_content.prepay_id`); `queryOrder` returns `QueryOrderResponse` with a typed
  `biz_content` — no more guessing key casings.
- **Fabric token caching**: tokens are cached until `expirationDate` (minus a 60s margin)
  and reused by the high-level helpers, halving round-trips; a 401 invalidates the cache.
  Opt out with `{ cacheFabricToken: false }`.
- **`ping()`**: never-throwing gateway health probe (`{ ok, latencyMs, error }`).
- **Construction-time warnings**: unreachable `notifyUrl` (localhost/private/http), and
  `verifySsl: false` (warn on test, error-level on production).
- **`Config.fromEnvironment()` zero-config**: now reads `TELEBIRR_FABRIC_APP_ID`,
  `TELEBIRR_APP_SECRET`, `TELEBIRR_MERCHANT_APP_ID`, `TELEBIRR_MERCHANT_CODE`,
  `TELEBIRR_PRIVATE_KEY`, `TELEBIRR_NOTIFY_URL`, `TELEBIRR_REDIRECT_URL`,
  `TELEBIRR_PUBLIC_KEY` (explicit options still win).
- **`HttpClientError.code`**: the underlying Node/undici error code, for programmatic branching.

### Docs
- Node-runtime requirement (no Edge/Workers; Next.js `runtime = 'nodejs'`).
- Exact return-URL parameters and the notify acknowledgement/retry contract.
- Reference idempotent settlement pattern (return ↔ notify race, compare-and-set grant).
- Sandbox-instability note (`49401024991` is gateway-side — retry, don't debug).
- Amount rounding / minor-units guidance; full fake-HttpClient create → settle test example.

## [3.0.0]

- Modern TypeScript rewrite: dual ESM/CJS, full types, injectable `HttpClient`/`Logger`,
  `Config` named constructors, fail-closed `ReturnUrlHandler`/`NotificationHandler`,
  `CheckoutResult` exposing the exact `merchOrderId`, TLS verification and timeouts by default.
