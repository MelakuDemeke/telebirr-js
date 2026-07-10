import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Config } from '../src/Config.js';
import { TelebirrError } from '../src/errors/TelebirrError.js';
import { NotificationHandler } from '../src/NotificationHandler.js';
import { PaymentStatus } from '../src/PaymentStatus.js';
import { ReturnUrlHandler } from '../src/ReturnUrlHandler.js';
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
