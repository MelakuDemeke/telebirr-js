<a href="https://aimeos.org/">
    <img src="img/telebirrlogo.png" alt="Telebirr" title="Aimeos" align="right" height="60" />
</a>

# Telebirr JS/TS Library (Web Checkout)
![](img/telebanner.png)

![GitHub branch checks state](https://img.shields.io/github/checks-status/MelakuDemeke/telebirr-js/main)
![GitHub repo size](https://img.shields.io/github/repo-size/MelakuDemeke/telebirr-js)
![GitHub issues](https://img.shields.io/github/issues/MelakuDemeke/telebirr-js)
![npm](https://img.shields.io/npm/dt/@melakudemeke/telebirr-js?color=green&logo=npm&logoColor=white)
![npm bundle size](https://img.shields.io/bundlephobia/minzip/@melakudemeke/telebirr-js)
![GitHub](https://img.shields.io/github/license/MelakuDemeke/telebirr-js?style=flat)
![GitHub Repo stars](https://img.shields.io/github/stars/MelakuDemeke/telebirr-js?logo=github&style=flat)
![GitHub forks](https://img.shields.io/github/forks/MelakuDemeke/telebirr-js?logo=github&style=falt)
![GitHub commit activity](https://img.shields.io/github/commit-activity/m/MelakuDemeke/telebirr-js?logo=github)
![GitHub last commit](https://img.shields.io/github/last-commit/MelakuDemeke/telebirr-js)

A modern TypeScript/Node.js library for integrating **Telebirr Web Checkout (C2B)** payments. Telebirr is a mobile money service developed by Huawei and owned by Ethio telecom.

This library provides a simple, `async`/`await`-based API for handling Telebirr payments, fully compliant with the [Telebirr H5 C2B Web Payment Integration Guide](https://developer.ethiotelecom.et/docs/H5%20C2B%20Web%20Payment%20Integration%20Quick%20Guide/requestCreateOrder). It ships as native ESM + CommonJS with full TypeScript types, and has a single runtime dependency ([`undici`](https://github.com/nodejs/undici), the HTTP client Node's own `fetch` is built on) — everything else (signing, verification) runs on Node's built-in `crypto`.

## 🚀 Quick Start

### Installation

```bash
npm install @melakudemeke/telebirr-js
```

### Basic Usage

```ts
import { Config, Telebirr } from '@melakudemeke/telebirr-js';

// Configure (test environment)
const config = Config.forTest({
  fabricAppId: 'YOUR_FABRIC_APP_ID',
  appSecret: 'YOUR_APP_SECRET',
  merchantAppId: 'YOUR_MERCHANT_APP_ID',
  merchantCode: 'YOUR_MERCHANT_CODE',
  privateKey: 'YOUR_RSA_PRIVATE_KEY_PEM',
  notifyUrl: 'https://your-domain.com/telebirr/notify',
  redirectUrl: 'https://your-domain.com/telebirr/return',
});

const client = new Telebirr(config);

// Create checkout URL (one call!). Returns a CheckoutResult.
const result = await client.createCheckoutUrl('Order 123', '100.00');

// IMPORTANT: persist the EXACT merch_order_id the library used — Telebirr
// echoes this value back in notifications and on the return URL. Storing a
// different value (e.g. one you thought you passed) can cause lookup misses.
await saveOrder(result.merchOrderId, result.prepayId); // your code

// Redirect the customer to Telebirr
res.redirect(result.checkoutUrl);
```

That's it! The library handles token management, order creation, and checkout URL generation automatically.

> **Merchant order id charset:** a `merch_order_id` must match `^[A-Za-z0-9]+$`
> (ASCII letters and digits only — no `-`, `_`, `.` or spaces). Invalid ids
> throw an `InvalidParameterError` instead of being silently rewritten. Pass
> `null`/omit it to have a valid id generated for you, and read it back from
> the result.

### In-App SDK Payment

If your mobile app's Telebirr SDK initiates the payment instead of a browser
redirect, use `createInAppOrder()`. There's no checkout URL for this flow —
the response's `receiveCode` must be passed to the mobile SDK to continue the
payment.

```ts
const tokenInfo = await client.applyFabricToken();
const order = await client.createInAppOrder(tokenInfo.token, 'Order 123', '100.00');
const receiveCode = (order.biz_content as Record<string, unknown>)['receiveCode'];

// Send the receiveCode to your mobile app for the SDK to complete the payment.
res.json({ receiveCode });
```

## 📋 Configuration

### Required Credentials

You'll receive these from Telebirr:
- `fabricAppId` - Your Fabric App ID (UUID)
- `appSecret` - Your App Secret
- `merchantAppId` - Your Merchant App ID
- `merchantCode` - Your Merchant Code (6-digit)
- `privateKey` - Your RSA Private Key
- `notifyUrl` - Server-to-server notification URL (required)
- `redirectUrl` - User return URL after payment (optional)

### Key formats — bare base64 is fine

Ethio Telecom issues merchant keys as **bare base64 DER** (a single long
`MIIEvgIBADANBgk…` line, no `-----BEGIN…-----` armor). Pass it exactly as
issued — the library normalizes it to PEM automatically, picking the right
header (PKCS#8 vs PKCS#1) for you. Proper PEM works too, including PEM whose
newlines were flattened to literal `\n` by a `.env` file. You will never see
`ERR_OSSL_UNSUPPORTED` because of key formatting.

### Environment Setup

The library automatically uses the correct URLs based on environment:

```ts
// Test/Development
const config = Config.forTest({ ... });

// Production
const config = Config.forProduction({ ... });

// Zero-config: read everything from environment variables
const config = Config.fromEnvironment();
```

`Config.fromEnvironment()` reads (any explicit option overrides its variable):

| Variable | Maps to |
|---|---|
| `TELEBIRR_ENVIRONMENT` (then `APP_ENV`/`NODE_ENV`) | `environment` |
| `TELEBIRR_FABRIC_APP_ID` | `fabricAppId` |
| `TELEBIRR_APP_SECRET` | `appSecret` |
| `TELEBIRR_MERCHANT_APP_ID` | `merchantAppId` |
| `TELEBIRR_MERCHANT_CODE` | `merchantCode` |
| `TELEBIRR_PRIVATE_KEY` | `privateKey` (PEM or bare base64) |
| `TELEBIRR_NOTIFY_URL` | `notifyUrl` |
| `TELEBIRR_REDIRECT_URL` | `redirectUrl` |
| `TELEBIRR_PUBLIC_KEY` | `telebirrPublicKey` |

Default endpoints used by the library:

- Test API: https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway
- Production API: https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway
- Test Web Checkout Redirect: https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?
- Production Web Checkout Redirect: https://superapp.ethiomobilemoney.et:38443/payment/web/paygate?

## 💡 Key Features

- ✅ **Simple API** - One-call checkout (`createCheckoutUrl`) and one-call verification (`getOrderStatus`), fully `async`/`await`
- ✅ **Automatic Token Management** - Fabric tokens are fetched, cached until expiry, and refreshed for you
- ✅ **Key normalization** - Bare base64 keys (as Ethio Telecom issues them) or PEM, both just work
- ✅ **TLS that just works** - Bundles the CA the test gateway forgets to serve; no `verifySsl: false` needed
- ✅ **Structured errors + opt-in retry** - Branch on `err.telebirrCode`; retry transient sandbox errors with backoff
- ✅ **Signature Verification** - Built-in helpers for return URLs and notifications
- ✅ **Helper Classes** - `ReturnUrlHandler`, `NotificationHandler`, `PaymentStatus`
- ✅ **Environment Support** - Automatic test/production URL handling
- ✅ **Framework-agnostic** - Works with Express, Next.js (Node runtime), Fastify, plain Node `http`
- ✅ **Dual ESM/CJS + full TypeScript types** - `import` or `require`, either way
- ✅ **Full Compliance** - Follows the Telebirr H5 C2B Web Payment Integration spec

## 📖 Common Use Cases

### Verify a payment (`getOrderStatus`)

The one-call, server-to-server way to confirm what actually happened to an
order — the verification counterpart to `createCheckoutUrl`. Token handling
and response mapping are done for you, and the result is fully typed:

```ts
const status = await client.getOrderStatus('YOUR_MERCH_ORDER_ID');

status.paid;           // boolean — true ONLY on an explicit success status (fails closed)
status.tradeStatus;    // e.g. 'PAY_SUCCESS'
status.amount;         // e.g. '100.00' — VERIFY this against your own order amount
status.currency;       // 'ETB'
status.paymentOrderId; // Telebirr's transaction reference (or null)
status.raw;            // the full queryOrder response if you need more
```

### Handle Payment Return

```ts
import { ReturnUrlHandler, TelebirrError } from '@melakudemeke/telebirr-js';

app.get('/telebirr/return', async (req, res) => {
  try {
    // Fails closed: throws if the signature is missing or invalid.
    const paymentData = ReturnUrlHandler.handle(req.query, config);

    if (paymentData.isSuccess) {
      // The return URL comes through the user's browser and is spoofable even
      // when signed. For anything that fulfils an order, confirm the real
      // status server-to-server before acting on it:
      const status = await client.getOrderStatus(paymentData.merchantOrderId);
      if (status.paid && status.amount === expectedAmountFor(paymentData.merchantOrderId)) {
        // Update your database / fulfill the order — idempotently (see below).
      }
    }

    res.redirect('/order/thank-you');
  } catch (err) {
    if (err instanceof TelebirrError) {
      res.status(400).send('Invalid payment data');
      return;
    }
    throw err;
  }
});
```

#### Return-URL parameters (the raw contract)

Telebirr redirects the user's browser to your `redirectUrl` with these query
parameters appended (snake_case):

| Parameter | Meaning |
|---|---|
| `merch_order_id` | Your merchant order id, echoed back verbatim |
| `payment_order_id` | Telebirr's transaction reference |
| `trade_status` | e.g. `PAY_SUCCESS`, `PAY_FAILED`, `PAY_CANCEL` |
| `total_amount` | Order amount |
| `trans_currency` | Currency (`ETB`) |
| `trans_end_time` | Transaction end time |
| `sign`, `sign_type` | RSA-PSS signature over the other params |

`ReturnUrlHandler.handle()` verifies the signature and maps these for you —
the table is here for when you're debugging the raw redirect.

### Handle Payment Notifications

```ts
import { NotificationHandler } from '@melakudemeke/telebirr-js';

app.post('/telebirr/notify', express.text({ type: '*/*' }), (req, res) => {
  const notification = NotificationHandler.parse(req.body);

  if (!NotificationHandler.verify(notification, config)) {
    // respond* return a NotificationResponse (framework-agnostic — no
    // implicit header()/echo). `.send(res)` works with Express/Node's
    // http.ServerResponse; use `.toWebResponse()` for Next.js/Remix/etc.
    NotificationHandler.respondError('Invalid signature').send(res);
    return;
  }

  if (NotificationHandler.isPaymentSuccessful(notification)) {
    const paymentInfo = NotificationHandler.extractPaymentInfo(notification);
    // Update database, fulfill order, etc.
    NotificationHandler.respondSuccess('Payment processed').send(res);
    return;
  }

  NotificationHandler.respondSuccess().send(res);
});
```

> **Next.js / Remix:** use
> `NotificationHandler.respondSuccess(...).toWebResponse()` to get a standard
> `Response` object instead of calling `.send(res)` — and remember the route
> must run on the **Node runtime** (see Requirements below).

#### Notification acknowledgement contract

- Telebirr POSTs the notification as a JSON body to your `notifyUrl`.
- Acknowledge success with **HTTP 200** and a JSON body — this is what
  `NotificationHandler.respondSuccess()` emits: `{"success": true}`.
- Any non-2xx status (what `respondError()` emits) tells Telebirr the
  delivery failed; it will **retry the notification** later. So: respond 200
  once you have durably recorded the event — even if your own fulfillment
  work continues asynchronously — and reserve error responses for "I could
  not record this, please retry".
- Your `notifyUrl` must be publicly reachable — `localhost` or a private
  address will never receive anything (the library warns about this at
  construction time). In development use a tunnel (ngrok, cloudflared).

### The idempotent settlement pattern (recommended)

The browser return and the server notification **race** — either can arrive
first, both can arrive, and neither should be trusted on its own. The
production-correct shape:

1. On checkout, store a row keyed by `merchOrderId` with `status='pending'`
   and the expected `amount`.
2. On **both** the return handler and the notify handler, call
   `client.getOrderStatus(merchOrderId)` — never trust the callback params.
3. Verify `status.paid === true` **and** `status.amount` matches your stored
   amount.
4. Grant idempotently with a compare-and-set, so the racing paths can't
   double-fulfill:

```ts
async function settle(merchOrderId: string) {
  const status = await client.getOrderStatus(merchOrderId);
  if (!status.paid) return;

  // Atomic claim: only one caller flips pending → success.
  // SQL: UPDATE orders SET status='success'
  //      WHERE merch_order_id=$1 AND status='pending' AND amount=$2
  const claimed = await db.claimPendingOrder(merchOrderId, status.amount);
  if (claimed) {
    await fulfillOrder(merchOrderId); // runs exactly once
  }
}
```

### Query Order Status (low level)

Prefer `getOrderStatus()` above; the raw call remains available when you need
the untouched response:

```ts
const tokenInfo = await client.applyFabricToken();
const orderStatus = await client.queryOrder(tokenInfo.token, null, 'YOUR_ORDER_ID');
// orderStatus.biz_content is typed (QueryOrderBizContent): trade_status,
// total_amount, payment_order_id, trans_currency, trans_end_time, ...
```

### Check gateway health

The sandbox can be flaky; probe it before a user-facing checkout if you want
to degrade gracefully:

```ts
const health = await client.ping(); // never throws
if (!health.ok) {
  // show "payment temporarily unavailable" instead of a broken checkout
}
```

### Process Refund

```ts
const tokenInfo = await client.applyFabricToken();
const refundResult = await client.refundOrder(
  tokenInfo.token,
  '50.00',              // Refund amount
  null,                  // paymentOrderId, or null
  'MERCHANT_ORDER_ID',   // merchOrderId, or null
  'Refund reason'        // Optional
);
```

## 🔧 Requirements

- Node.js >= 18 (native `fetch`/`Response`, and `crypto.sign`/`crypto.verify` with RSA-PSS)
- **undici** (^7) — the only runtime dependency; it's the HTTP client Node's own global `fetch` is built on, used here so TLS verification, a custom CA bundle, and connect/total timeouts can be configured per-client.
- Signing/verification use Node's built-in `crypto` module — RSA-PSS, SHA256, MGF1-SHA256, salt length 32 — no extra crypto dependency required.

> **⚠️ Node runtime only — no Edge / Cloudflare Workers.** The library uses
> `undici` and `node:crypto` (RSA-PSS), which are not available on edge
> runtimes. In **Next.js**, add `export const runtime = 'nodejs'` to any route
> handler that touches this library, or the route will fail to build/run on
> the Edge runtime with confusing errors:
>
> ```ts
> // app/api/telebirr/notify/route.ts
> export const runtime = 'nodejs';
> ```

## ⚙️ Advanced Configuration

### TLS & timeouts

The default HTTP client verifies the gateway's TLS certificate and applies
timeouts (a payment gateway must not be called over an unverified or
unbounded connection).

**The Telebirr test gateway serves an incomplete certificate chain** (leaf
only, missing intermediate), which used to fail Node's verification with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE` and push people toward `verifySsl: false`.
The library now **bundles the missing intermediate CA** and trusts it *in
addition to* Node's default root store, so verification works out of the box
— you should never need `verifySsl: false`. If the gateway rotates to a CA
the bundle doesn't cover, the error message will say so and explain the
options; `caBundlePath` adds further certificates without replacing the
system store.

```ts
const config = Config.forProduction({
  // ... credentials ...
  verifySsl: true,        // default true — leave on; the library warns (test) or
                           // logs an error (production) if you turn it off
  caBundlePath: undefined, // optional path to an ADDITIONAL CA bundle (PEM)
  timeout: 30,             // total request timeout (seconds)
  connectTimeout: 10,      // connection timeout (seconds)
});
```

### Token caching

`createCheckoutUrl()` and `getOrderStatus()` cache the fabric token until its
`expirationDate` (minus a 60s safety margin) and reuse it, halving gateway
round-trips on the hot paths. A rejected token (HTTP 401) drops the cache
automatically. Opt out for stateless behavior:

```ts
const client = new Telebirr(config, null, null, { cacheFabricToken: false });
```

`applyFabricToken()` always performs a real network call (and refreshes the
cache), so existing manual flows are unaffected.

### Retrying transient gateway errors

The test gateway regularly throws transient infra errors (see the sandbox
note below). Retry is **opt-in** with exponential backoff:

```ts
const client = new Telebirr(config, console, null, {
  retry: { retries: 2, delayMs: 500, maxDelayMs: 5000 },
});
```

Only failures where `ApiError.isTransient()` is true are retried: known
Telebirr infra codes (`49401024991` "southbound service unavailable"),
HTTP 502/503/504, and transport timeouts/resets. Parameter or auth errors
fail immediately. The set of codes is exported as
`TRANSIENT_TELEBIRR_ERROR_CODES` if you need to extend it.

### Logging

Pass any logger matching the `Logger` interface (`debug`/`info`/`warn`/`error`,
each `(message, meta?) => void`) — `console`, `pino`, `winston`, or a small
wrapper around any of them all work directly:

```ts
import { Telebirr } from '@melakudemeke/telebirr-js';

const client = new Telebirr(config, console); // request/response logging (secrets & PII redacted)
```

### Injecting a custom HTTP client (testing)

The third constructor argument accepts any `HttpClient`
(`post(url, headers, body): Promise<HttpResponse>`), so you can unit-test
without hitting the network. A complete create → settle flow:

```ts
import { Telebirr, HttpResponse, type HttpClient } from '@melakudemeke/telebirr-js';

// Returns canned responses in order: token, createOrder, token (cached ⇒ skipped), queryOrder.
function fakeGateway(responses: HttpResponse[]): HttpClient {
  return {
    async post(url, headers, body) {
      const next = responses.shift();
      if (!next) throw new Error(`unexpected call to ${url}`);
      return next;
    },
  };
}

const fake = fakeGateway([
  new HttpResponse(200, JSON.stringify({ token: 'Bearer TEST', expirationDate: String(Date.now() + 3_600_000) })),
  new HttpResponse(200, JSON.stringify({ code: '00000', biz_content: { prepay_id: 'PID123' } })),
  new HttpResponse(200, JSON.stringify({
    code: '00000',
    biz_content: { trade_status: 'PAY_SUCCESS', total_amount: '100.00', trans_currency: 'ETB', payment_order_id: 'TB1', merch_order_id: 'ORDER123' },
  })),
]);

const client = new Telebirr(config, null, fake);

const checkout = await client.createCheckoutUrl('Order 123', '100.00', 'ORDER123'); // uses responses 1–2
const status = await client.getOrderStatus(checkout.merchOrderId);                  // token is cached ⇒ uses response 3
// status.paid === true, status.amount === '100.00'
```

### Catching errors

Every error the library throws extends `TelebirrError`, so you can catch
them all in one place. API failures throw `ApiError`, which now carries
Telebirr's parsed error envelope — no more `JSON.parse(err.responseBody)`:

```ts
import { TelebirrError, ApiError, InvalidParameterError } from '@melakudemeke/telebirr-js';

try {
  await client.createCheckoutUrl('Order 123', '100.00');
} catch (err) {
  if (err instanceof ApiError) {
    err.httpStatus;        // e.g. 400
    err.telebirrCode;      // e.g. '49401024991' — parsed from the body
    err.telebirrMessage;   // Telebirr's errorMsg
    err.telebirrSolution;  // Telebirr's errorSolution remediation text
    err.isTransient();     // true for retryable gateway-side failures
    err.responseBody;      // raw body, if you need it
  } else if (err instanceof InvalidParameterError) {
    console.error(err.parameterName, err.parameterValue, err.suggestion);
  } else if (err instanceof TelebirrError) {
    console.error('Telebirr error:', err.message);
  }
}
```

### Amounts & rounding

`amount` accepts `string | number` and is formatted to exactly 2 decimals —
Telebirr's wire format for ETB. If you store amounts in minor units (cents),
divide before passing (`amount: cents / 100` → `'100.50'`). Prefer passing a
**string** (`'100.50'`) when the value came from user input or a DB decimal
column, sidestepping any binary floating-point surprises; values that would
lose precision at 2 decimals (e.g. `10.005`) are rounded by `toFixed(2)`.

### ⚠️ Sandbox instability

The **test gateway is frequently unstable** and returns transient infra
errors that look exactly like integration bugs — most commonly:

```
errorCode 49401024991: "southbound business service is unavailable"
```

If your request worked before and suddenly throws a `4940…` code with an
`errorSolution` suggesting a retry, **it's the gateway, not your code**.
Wait and retry (or enable the `retry` option above). Don't spend an hour
debugging a correct integration.

## 🛠️ Helper Classes

The library provides several helper classes to simplify common tasks:

- **`ReturnUrlHandler`** - Parse and verify return URL parameters
- **`NotificationHandler`** - Parse and verify payment notifications
- **`PaymentStatus`** - Check payment status values
- **`SignatureVerifier`** - Verify signatures from Telebirr
- **`ParameterValidator`** - Validate/sanitize titles, amounts, merchant order ids, and URLs

## 🔒 Security Notes

- Always verify signatures before processing payments
- Use HTTPS for all payment endpoints
- Store credentials in environment variables, not in code
- Implement idempotency checks for notifications
- Never trust return URL parameters alone - verify with server-to-server notifications

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for per-version changes and migration notes.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.

## 🔗 Links

- [Telebirr Developer Portal](https://developer.ethiotelecom.et/)
- [Telebirr H5 C2B Integration Guide](https://developer.ethiotelecom.et/docs/H5%20C2B%20Web%20Payment%20Integration%20Quick%20Guide/requestCreateOrder)
- [npm package](https://www.npmjs.com/package/@melakudemeke/telebirr-js)
- [GitHub Repository](https://github.com/MelakuDemeke/telebirr-js)
- Looking for a PHP integration? See [telebirr-php](https://github.com/MelakuDemeke/telebirr-php)

---

**Need help?** Open an issue on GitHub.
