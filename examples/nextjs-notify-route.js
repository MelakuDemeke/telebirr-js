// Example Next.js (App Router) route handler — app/telebirr/notify/route.js
//
// Demonstrates `toWebResponse()`, for runtimes that speak the standard
// `Request`/`Response` objects (Next.js, Remix, Bun, Deno, Cloudflare Workers).
import { NotificationHandler } from '../dist/index.js';
import { config } from './config.js';

export async function POST(request) {
  const rawBody = await request.text();
  const notification = NotificationHandler.parse(rawBody);

  if (!NotificationHandler.verify(notification, config)) {
    return NotificationHandler.respondError('Invalid signature').toWebResponse();
  }

  if (NotificationHandler.isPaymentSuccessful(notification)) {
    const info = NotificationHandler.extractPaymentInfo(notification);
    // Update your database / fulfill the order here.
    console.log('Payment notification', info);
  }

  return NotificationHandler.respondSuccess().toWebResponse();
}
