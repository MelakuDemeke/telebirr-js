// Shared config used by the other examples in this folder.
// Run examples with real credentials via environment variables, e.g.:
//   FABRIC_APP_ID=... APP_SECRET=... MERCHANT_APP_ID=... MERCHANT_CODE=... \
//   PRIVATE_KEY_PATH=./key.pem node examples/checkout-server.js
import { readFileSync } from 'node:fs';
import { Config } from '../dist/index.js';

export const config = Config.fromEnvironment({
  fabricAppId: process.env.FABRIC_APP_ID ?? 'YOUR_FABRIC_APP_ID',
  appSecret: process.env.APP_SECRET ?? 'YOUR_APP_SECRET',
  merchantAppId: process.env.MERCHANT_APP_ID ?? 'YOUR_MERCHANT_APP_ID',
  merchantCode: process.env.MERCHANT_CODE ?? 'YOUR_MERCHANT_CODE',
  privateKey: process.env.PRIVATE_KEY_PATH ? readFileSync(process.env.PRIVATE_KEY_PATH, 'utf8') : 'YOUR_PRIVATE_KEY_PEM',
  notifyUrl: process.env.NOTIFY_URL ?? 'http://localhost:3000/telebirr/notify',
  redirectUrl: process.env.REDIRECT_URL ?? 'http://localhost:3000/telebirr/return',
});
