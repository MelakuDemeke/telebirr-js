import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Config } from '../src/Config.js';
import { TelebirrError } from '../src/errors/TelebirrError.js';
import { NotificationHandler } from '../src/NotificationHandler.js';
import { PaymentStatus } from '../src/PaymentStatus.js';
import { ReturnUrlHandler } from '../src/ReturnUrlHandler.js';
import { SignatureVerifier } from '../src/SignatureVerifier.js';
import { Signer } from '../src/Signer.js';

let privateKey: string;
let publicKey: string;

beforeAll(() => {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = keys.privateKey;
  publicKey = keys.publicKey;
});

function makeConfig() {
  return Config.forTest({
    fabricAppId: 'fabric-app-id',
    appSecret: 'secret',
    merchantAppId: 'merchant-app-id',
    merchantCode: '123456',
    privateKey,
    telebirrPublicKey: publicKey,
    notifyUrl: 'https://example.com/notify',
  });
}

function signedParams(fields: Record<string, unknown>, config: Config) {
  const signer = new Signer(config);
  const sign = signer.signRequestObject(fields);
  return { ...fields, sign, sign_type: 'SHA256WithRSA' };
}

describe('PaymentStatus', () => {
  it('classifies success/failure/cancelled statuses case-insensitively', () => {
    expect(PaymentStatus.isSuccess('pay_success')).toBe(true);
    expect(PaymentStatus.isSuccess('SUCCESS')).toBe(true);
    expect(PaymentStatus.isFailure('PAY_FAILED')).toBe(true);
    expect(PaymentStatus.isCancelled(' pay_cancel ')).toBe(true);
    expect(PaymentStatus.isSuccess('PENDING')).toBe(false);
  });
});

describe('NotificationHandler', () => {
  it('parses valid JSON and rejects non-object JSON', () => {
    expect(NotificationHandler.parse('{"a":1}')).toEqual({ a: 1 });
    expect(() => NotificationHandler.parse('[1,2,3]')).toThrow(SyntaxError);
    expect(() => NotificationHandler.parse('not json')).toThrow();
  });

  it('verifies a correctly signed notification', () => {
    const config = makeConfig();
    const notification = signedParams({ trade_status: 'PAY_SUCCESS', merch_order_id: 'ORDER123' }, config);
    expect(NotificationHandler.verify(notification, config)).toBe(true);
  });

  it('fails verification when sign is absent', () => {
    const config = makeConfig();
    expect(NotificationHandler.verify({ trade_status: 'PAY_SUCCESS' }, config)).toBe(false);
  });

  it('builds success/error acknowledgement responses', () => {
    const success = NotificationHandler.respondSuccess('ok');
    expect(success.statusCode).toBe(200);
    expect(JSON.parse(success.body)).toEqual({ success: true, message: 'ok' });

    const error = NotificationHandler.respondError('bad signature');
    expect(error.statusCode).toBe(500);
    expect(JSON.parse(error.body)).toEqual({ success: false, message: 'bad signature' });
  });

  it('detects payment success and extracts payment info', () => {
    const notification = { trade_status: 'PAY_SUCCESS', merch_order_id: 'ORDER123', total_amount: '10.00' };
    expect(NotificationHandler.isPaymentSuccessful(notification)).toBe(true);

    const info = NotificationHandler.extractPaymentInfo(notification);
    expect(info.merchantOrderId).toBe('ORDER123');
    expect(info.amount).toBe('10.00');
    expect(info.currency).toBe('ETB');
  });
});

describe('ReturnUrlHandler', () => {
  it('throws when the signature is missing', () => {
    const config = makeConfig();
    expect(() => ReturnUrlHandler.handle({ merch_order_id: 'ORDER123' }, config)).toThrow(TelebirrError);
  });

  it('throws when the signature is invalid', () => {
    const config = makeConfig();
    expect(() => ReturnUrlHandler.handle({ merch_order_id: 'ORDER123', sign: 'bogus', sign_type: 'SHA256WithRSA' }, config)).toThrow(TelebirrError);
  });

  it('parses and returns payment data for a validly signed success', () => {
    const config = makeConfig();
    const params = signedParams({ trade_status: 'PAY_SUCCESS', merch_order_id: 'ORDER123', total_amount: '10.00' }, config);

    const data = ReturnUrlHandler.handle(params, config);
    expect(data.isSuccess).toBe(true);
    expect(data.merchantOrderId).toBe('ORDER123');
    expect(data.raw).toEqual(params);
  });

  it('fails closed: no explicit status means not successful, even with a valid signature', () => {
    const config = makeConfig();
    const params = signedParams({ merch_order_id: 'ORDER123' }, config);

    const data = ReturnUrlHandler.handle(params, config);
    expect(data.isSuccess).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The notify leg's own dialect
// ---------------------------------------------------------------------------

const notifyBody = {
  merch_order_id: 'ORDER123',
  merch_code: '123456',
  sign_type: 'SHA256WithRSA',
  payment_order_id: 'TB123',
  notify_url: 'https://example.com/notify',
  appid: 'merchant-app-id',
  notify_time: '1784756474676',
  total_amount: '1.00',
  trans_currency: 'ETB',
  trade_status: 'Completed',
  trans_end_time: '1784756474000',
  transId: 'DGN80QBV5A',
};

function signBody(fields: Record<string, unknown>, config: Config): string {
  return new Signer(config).signString(SignatureVerifier.getCanonicalString(fields));
}

describe('PaymentStatus notify dialect', () => {
  it('reads the notify leg "Completed" as success, without loosening anything else', () => {
    expect(PaymentStatus.isSuccess('Completed')).toBe(true);
    expect(PaymentStatus.isSuccess('COMPLETED')).toBe(true);
    expect(PaymentStatus.isSuccess('PAY_SUCCESS')).toBe(true);
    expect(PaymentStatus.isSuccess('PAY_FAILED')).toBe(false);
    expect(PaymentStatus.isSuccess('')).toBe(false);
  });
});

describe('NotificationHandler.unwrap', () => {
  const flat = { merch_order_id: 'ORDER123', trade_status: 'Completed', sign: 'abc' };

  it('passes a flat payload through untouched', () => {
    expect(NotificationHandler.unwrap(flat)).toBe(flat);
  });

  it('unwraps a data envelope', () => {
    expect(NotificationHandler.unwrap({ data: flat })).toBe(flat);
  });

  it('does not mistake an unrelated "data" key for an envelope', () => {
    const unrelated = { merch_order_id: 'ORDER123', data: { something: 'else' } };
    expect(NotificationHandler.unwrap(unrelated)).toBe(unrelated);
  });

  it('is applied by parse(), so verify/extract see a flat payload', () => {
    expect(NotificationHandler.parse(JSON.stringify({ data: flat }))).toEqual(flat);
  });
});

describe('NotificationHandler.toUnixSeconds', () => {
  it('normalizes epochs and refuses to guess at anything else', () => {
    expect(NotificationHandler.toUnixSeconds('1784756474676')).toBe(1784756474);
    expect(NotificationHandler.toUnixSeconds('1784756474')).toBe(1784756474);
    expect(NotificationHandler.toUnixSeconds(1784756474676)).toBe(1784756474);
    expect(NotificationHandler.toUnixSeconds('2026-08-07 10:41:13')).toBeNull();
    expect(NotificationHandler.toUnixSeconds('')).toBeNull();
    expect(NotificationHandler.toUnixSeconds(null)).toBeNull();
    expect(NotificationHandler.toUnixSeconds(undefined)).toBeNull();
  });
});

describe('NotificationHandler.extractPaymentInfo (notify dialect)', () => {
  it('extracts every field of a real notify body', () => {
    const info = NotificationHandler.extractPaymentInfo(notifyBody);
    expect(info.merchantOrderId).toBe('ORDER123');
    expect(info.transId).toBe('DGN80QBV5A');
    expect(info.merchCode).toBe('123456');
    expect(info.appId).toBe('merchant-app-id');
    expect(info.notifyUrl).toBe('https://example.com/notify');
    expect(info.timestamp).toBe('1784756474000');
    expect(info.timestampUnix).toBe(1784756474);
    expect(info.notifyTimeUnix).toBe(1784756474);
    expect(info.raw).toBe(notifyBody);
    expect(NotificationHandler.isPaymentSuccessful(notifyBody)).toBe(true);
  });
});

describe('NotificationHandler.handle', () => {
  it('handles a valid Completed notification, flat or enveloped', () => {
    const config = makeConfig();
    const signed = { ...notifyBody, sign: signBody(notifyBody, config) };

    const handled = NotificationHandler.handle(JSON.stringify(signed), config);
    expect(handled.isSuccess).toBe(true);
    expect(handled.transId).toBe('DGN80QBV5A');

    expect(NotificationHandler.handle(JSON.stringify({ data: signed }), config).isSuccess).toBe(true);
  });

  it('fails closed on a tampered or unsigned notification', () => {
    const config = makeConfig();
    const signed = { ...notifyBody, sign: signBody(notifyBody, config) };

    expect(() => NotificationHandler.handle(JSON.stringify({ ...signed, total_amount: '9999.00' }), config)).toThrow(TelebirrError);
    expect(() => NotificationHandler.handle(JSON.stringify(notifyBody), config)).toThrow(TelebirrError);
  });
});

// ---------------------------------------------------------------------------
// The transId / trans_id signing mismatch, and URL-mangled signatures
// ---------------------------------------------------------------------------

describe('SignatureVerifier field aliasing (transId signed as trans_id)', () => {
  // Telebirr hashes the transaction id as `trans_id` and puts it on the wire
  // as `transId`. Reproduce exactly that: sign one spelling, send the other.
  const { transId, ...rest } = notifyBody;
  const signedShape = { ...rest, trans_id: transId };

  it('verifies a notification signed as trans_id but sent as transId', () => {
    const config = makeConfig();
    const onTheWire = { ...notifyBody, sign: signBody(signedShape, config) };

    expect(SignatureVerifier.verify(onTheWire, publicKey)).toBe(true);
    expect(NotificationHandler.handle(JSON.stringify(onTheWire), config).isSuccess).toBe(true);
  });

  it('still verifies when the gateway names the field consistently, either way round', () => {
    const config = makeConfig();
    expect(SignatureVerifier.verify({ ...notifyBody, sign: signBody(notifyBody, config) }, publicKey)).toBe(true);
    expect(SignatureVerifier.verify({ ...signedShape, sign: signBody(signedShape, config) }, publicKey)).toBe(true);
  });

  it('never becomes a way in', () => {
    const config = makeConfig();
    const onTheWire = { ...notifyBody, sign: signBody(signedShape, config) };

    expect(SignatureVerifier.verify({ ...onTheWire, total_amount: '9999.00' }, publicKey)).toBe(false);
    expect(SignatureVerifier.verify({ ...onTheWire, transId: 'FORGEDXXXX' }, publicKey)).toBe(false);
    expect(SignatureVerifier.verify({ ...onTheWire, sign: randomBytes(256).toString('base64') }, publicKey)).toBe(false);
  });
});

describe('SignatureVerifier signature decoding (URL-mangled base64)', () => {
  // Not every signature contains a `+`; sign until one has at least two, so
  // the mangling tests actually exercise something.
  function signedWithPlus(config: Config) {
    for (let i = 0; ; i++) {
      const fields = { ...notifyBody, merch_order_id: `ORDER${i}` };
      const sign = signBody(fields, config);
      if (sign.split('+').length > 2) {
        return { ...fields, sign };
      }
    }
  }

  it('verifies a signature whose + became spaces', () => {
    const config = makeConfig();
    const aligned = signedWithPlus(config);
    expect(SignatureVerifier.verify({ ...aligned, sign: aligned.sign.replace(/\+/g, ' ') }, publicKey)).toBe(true);
  });

  it('verifies a partially mangled signature (literal + and spaces)', () => {
    const config = makeConfig();
    const aligned = signedWithPlus(config);
    const plusAt = aligned.sign.indexOf('+');
    const mixed = aligned.sign.slice(0, plusAt + 1) + aligned.sign.slice(plusAt + 1).replace(/\+/g, ' ');

    expect(mixed).toContain('+');
    expect(mixed).toContain(' ');
    expect(SignatureVerifier.verify({ ...aligned, sign: mixed }, publicKey)).toBe(true);
  });

  it('does not let repairing the encoding excuse a tampered payload', () => {
    const config = makeConfig();
    const aligned = signedWithPlus(config);
    const mangled = { ...aligned, sign: aligned.sign.replace(/\+/g, ' '), merch_order_id: 'ORDER-FORGED' };
    expect(SignatureVerifier.verify(mangled, publicKey)).toBe(false);
  });

  it('does not throw on a malformed percent sequence', () => {
    expect(SignatureVerifier.verify({ ...notifyBody, sign: '%E0%A4%A' + 'A'.repeat(300) }, publicKey)).toBe(false);
  });

  it('normalizeSignature repairs spaces unconditionally', () => {
    expect(SignatureVerifier.normalizeSignature('ab+c d')).toBe('ab+c+d');
  });
});

describe('ReturnUrlHandler shape parity with the notify leg', () => {
  it('returns every key the notify leg does', () => {
    const config = makeConfig();
    // Real return-leg parameters: no transaction id, datetime timestamps.
    const returnParams = {
      trans_end_time: '2026-08-21 17:10:26',
      notify_time: '2026-08-21 17:10:26',
      trans_currency: 'ETB',
      total_amount: '1.00',
      merch_order_id: 'AFROTESTF62S9L5EJBDUAR',
      appid: '974630308911301',
      trade_status: 'PAY_SUCCESS',
      merch_code: '500289',
      notify_url: 'https://example.com/notify',
      payment_order_id: '108N11088L17102600001002',
      sign_type: 'SHA256WithRSA',
    };
    const returned = ReturnUrlHandler.handle({ ...returnParams, sign: signBody(returnParams, config) }, config);

    const notifyKeys = Object.keys(NotificationHandler.extractPaymentInfo(notifyBody));
    expect(notifyKeys.filter((key) => !(key in returned))).toEqual([]);
    expect(returned.isSuccess).toBe(true);
    expect(returned.transId).toBe('');
    expect(returned.merchCode).toBe('500289');
    expect(returned.appId).toBe('974630308911301');
    expect(returned.timestamp).toBe('2026-08-21 17:10:26');
    expect(returned.timestampUnix).toBeNull();
  });
});
