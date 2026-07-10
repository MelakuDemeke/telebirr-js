// Plain Node `http` example — no framework required.
//
//   node examples/checkout-server.js
//
// Then visit http://localhost:3000/checkout to start a payment.
import { createServer } from 'node:http';
import { NotificationHandler, ReturnUrlHandler, Telebirr, TelebirrError } from '../dist/index.js';
import { config } from './config.js';

const client = new Telebirr(config, console);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  try {
    if (url.pathname === '/checkout') {
      const result = await client.createCheckoutUrl('Order 123', '10.00');

      // Persist result.merchOrderId + result.prepayId against your order here.
      console.log('Created order', result.toJSON());

      res.writeHead(302, { Location: result.checkoutUrl });
      res.end();
      return;
    }

    if (url.pathname === '/telebirr/return') {
      const params = Object.fromEntries(url.searchParams);
      const paymentData = ReturnUrlHandler.handle(params, config);

      if (paymentData.isSuccess) {
        // Confirm server-to-server before fulfilling the order — the return
        // URL is spoofable even with a valid signature.
        const tokenInfo = await client.applyFabricToken();
        const status = await client.queryOrder(tokenInfo.token, null, paymentData.merchantOrderId);
        console.log('Confirmed order status', status.biz_content);
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(paymentData.isSuccess ? 'Payment received, thank you!' : 'Payment was not completed.');
      return;
    }

    if (url.pathname === '/telebirr/notify' && req.method === 'POST') {
      const rawBody = await readBody(req);
      const notification = NotificationHandler.parse(rawBody);

      if (!NotificationHandler.verify(notification, config)) {
        NotificationHandler.respondError('Invalid signature').send(res);
        return;
      }

      if (NotificationHandler.isPaymentSuccessful(notification)) {
        const info = NotificationHandler.extractPaymentInfo(notification);
        console.log('Payment notification', info);
        // Update your database / fulfill the order here.
      }

      NotificationHandler.respondSuccess().send(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. Try /checkout');
  } catch (err) {
    if (err instanceof TelebirrError) {
      console.error('Telebirr error:', err.message);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Payment error');
      return;
    }
    throw err;
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

server.listen(3000, () => {
  console.log('Listening on http://localhost:3000 — try /checkout');
});
