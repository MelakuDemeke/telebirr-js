# Changelog

All notable changes to `@melakudemeke/telebirr-js` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

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
