// Example Next.js (App Router) route handler — app/telebirr/notify/route.js
//
// Demonstrates `toWebResponse()`, for runtimes that speak the standard
// `Request`/`Response` objects (Next.js, Remix, Bun, Deno, Cloudflare Workers).
import { NotificationHandler, TelebirrError } from '../dist/index.js';
import { config } from './config.js';

export async function POST(request) {
  let payment;
  try {
    // Parses, unwraps a `data` envelope, verifies and extracts in one call.
    // Fails closed: throws on a missing or invalid signature.
    payment = NotificationHandler.handle(await request.text(), config);
  } catch (err) {
    if (err instanceof TelebirrError || err instanceof SyntaxError) {
      return NotificationHandler.respondError('Invalid notification', 401).toWebResponse();
    }
    throw err;
  }

  if (payment.isSuccess) {
    // Confirm with client.getOrderStatus(payment.merchantOrderId), then update
    // your database / fulfill the order here — idempotently.
    console.log('Payment notification', payment.merchantOrderId, payment.transId);
  }

  return NotificationHandler.respondSuccess().toWebResponse();
}
