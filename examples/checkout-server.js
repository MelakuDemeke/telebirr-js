// Plain Node `http` example — no framework required.
//
//   node examples/checkout-server.js
//
// Then visit http://localhost:3000/checkout to start a payment, or point a
// mobile app at POST http://<your-ip>:3000/inapp/create-order.
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

    // In-App SDK flow: a mobile app (Flutter, Android, iOS) POSTs
    // { title, amount } and gets back the receiveCode for the Telebirr SDK.
    if (url.pathname === '/inapp/create-order' && req.method === 'POST') {
      let input;
      try {
        input = JSON.parse(await readBody(req));
      } catch {
        input = null;
      }
      // In a real app, look the order up by id and take the title and amount
      // from YOUR database. Never charge an amount the client sent.
      const title = String(input?.title ?? '').trim();
      const amount = String(input?.amount ?? '').trim();
      if (!title || !amount) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'title and amount are required' }));
        return;
      }

      const result = await client.createInAppPayment(title, amount);

      // Persist result.merchOrderId against your order here, BEFORE answering.
      console.log('Created in-app order', result.merchOrderId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result)); // { receiveCode, merchOrderId, prepayId }
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
      if (url.pathname.startsWith('/inapp/')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Could not create the order' }));
        return;
      }
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
