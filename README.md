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
- `privateKey` - Your RSA Private Key (PEM format)
- `notifyUrl` - Server-to-server notification URL (required)
- `redirectUrl` - User return URL after payment (optional)

### Environment Setup

The library automatically uses the correct URLs based on environment:

```ts
// Test/Development
const config = Config.forTest({ ... });

// Production
const config = Config.forProduction({ ... });

// Auto-detect from environment variable
const config = Config.fromEnvironment({ ... });
// Set: TELEBIRR_ENVIRONMENT=production
```

Default endpoints used by the library:

- Test API: https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway
- Production API: https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway
- Test Web Checkout Redirect: https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?
- Production Web Checkout Redirect: https://superapp.ethiomobilemoney.et:38443/payment/web/paygate?

## 💡 Key Features

- ✅ **Simple API** - One-call checkout URL generation, fully `async`/`await`
- ✅ **Automatic Token Management** - No need to handle tokens manually
- ✅ **Signature Verification** - Built-in helpers for return URLs and notifications
- ✅ **Helper Classes** - `ReturnUrlHandler`, `NotificationHandler`, `PaymentStatus`
- ✅ **Environment Support** - Automatic test/production URL handling
- ✅ **Framework-agnostic** - Works with Express, Next.js, Fastify, plain Node `http`, or any runtime with `fetch`/`Response`
- ✅ **Dual ESM/CJS + full TypeScript types** - `import` or `require`, either way
- ✅ **Full Compliance** - Follows the Telebirr H5 C2B Web Payment Integration spec

## 📖 Common Use Cases

### Handle Payment Return

```ts
import { ReturnUrlHandler, TelebirrError } from '@melakudemeke/telebirr-js';

app.get('/telebirr/return', async (req, res) => {
  try {
    // Fails closed: throws if the signature is missing or invalid.
    const paymentData = ReturnUrlHandler.handle(req.query, config);

    if (paymentData.isSuccess) {
      const orderId = paymentData.merchantOrderId;

      // The return URL comes through the user's browser and is spoofable even
      // when signed. For anything that fulfils an order, confirm the real
      // status server-to-server before acting on it:
      const tokenInfo = await client.applyFabricToken();
      const status = await client.queryOrder(tokenInfo.token, null, orderId);
      const confirmed = (status.biz_content as Record<string, unknown> | undefined)?.['trade_status'];

      // Update your database / fulfill the order only after this confirmation.
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

> **Next.js / Remix / Bun / Deno / Cloudflare Workers:** use
> `NotificationHandler.respondSuccess(...).toWebResponse()` to get a standard
> `Response` object instead of calling `.send(res)`.

### Query Order Status

```ts
const tokenInfo = await client.applyFabricToken();
const orderStatus = await client.queryOrder(tokenInfo.token, null, 'YOUR_ORDER_ID');

const tradeStatus = (orderStatus.biz_content as Record<string, unknown> | undefined)?.['trade_status'] as string | undefined;
if (tradeStatus?.toUpperCase() === 'PAY_SUCCESS') {
  // Payment successful
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

## ⚙️ Advanced Configuration

### TLS & timeouts

The default HTTP client verifies the gateway's TLS certificate and applies
timeouts (a payment gateway must not be called over an unverified or
unbounded connection). Override only if you must:

```ts
const config = Config.forProduction({
  // ... credentials ...
  verifySsl: true,        // default true — leave on in production
  caBundlePath: undefined, // optional path to a custom CA bundle (PEM)
  timeout: 30,             // total request timeout (seconds)
  connectTimeout: 10,      // connection timeout (seconds)
});
```

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
without hitting the network:

```ts
import { Telebirr, HttpResponse, type HttpClient } from '@melakudemeke/telebirr-js';

const fake: HttpClient = {
  async post(url, headers, body) {
    return new HttpResponse(200, JSON.stringify({ token: 'Bearer TEST' }));
  },
};

const client = new Telebirr(config, null, fake);
```

### Catching errors

Every error the library throws extends `TelebirrError`, so you can catch
them all in one place. API failures throw `ApiError`, which exposes
`httpStatus`, `errorCode`, and `responseBody`.

```ts
import { TelebirrError, ApiError, InvalidParameterError } from '@melakudemeke/telebirr-js';

try {
  await client.createCheckoutUrl('Order 123', '100.00');
} catch (err) {
  if (err instanceof ApiError) {
    console.error(err.httpStatus, err.errorCode, err.responseBody);
  } else if (err instanceof InvalidParameterError) {
    console.error(err.parameterName, err.parameterValue, err.suggestion);
  } else if (err instanceof TelebirrError) {
    console.error('Telebirr error:', err.message);
  }
}
```

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
