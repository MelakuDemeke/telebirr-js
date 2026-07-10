import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Config } from '../src/Config.js';
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

function makeConfig(overrides: Partial<Parameters<typeof Config.forTest>[0]> = {}) {
  return Config.forTest({
    fabricAppId: 'fabric-app-id',
    appSecret: 'secret',
    merchantAppId: 'merchant-app-id',
    merchantCode: '123456',
    privateKey,
    notifyUrl: 'https://example.com/notify',
    ...overrides,
  });
}

describe('Signer.buildCanonicalString', () => {
  it('sorts fields alphabetically and flattens biz_content, excluding sign/sign_type/biz_content', () => {
    const canonical = Signer.buildCanonicalString({
      timestamp: '1000',
      nonce_str: 'ABC',
      sign: 'should-be-excluded',
      sign_type: 'should-be-excluded',
      biz_content: { merch_code: '123456', appid: 'merchant-app-id' },
    });

    // Expected alpha order: appid, merch_code, nonce_str, timestamp
    expect(canonical).toBe('appid=merchant-app-id&merch_code=123456&nonce_str=ABC&timestamp=1000');
  });
});

describe('Signer + SignatureVerifier round-trip', () => {
  it('signs a request object and verifies it with the matching public key', () => {
    const config = makeConfig({ telebirrPublicKey: publicKey });
    const signer = new Signer(config);

    const req = {
      timestamp: Signer.createTimeStamp(),
      nonce_str: Signer.createNonceStr(),
      method: 'payment.preorder',
      version: '1.0',
      biz_content: { appid: 'merchant-app-id', merch_code: '123456', total_amount: '10.00' },
    };
    const sign = signer.signRequestObject(req);

    const params = { ...req, sign, sign_type: 'SHA256WithRSA' };
    expect(SignatureVerifier.verify(params, config)).toBe(true);
  });

  it('fails verification when the payload is tampered with', () => {
    const config = makeConfig({ telebirrPublicKey: publicKey });
    const signer = new Signer(config);

    const req = { timestamp: '1000', nonce_str: 'ABC', biz_content: { total_amount: '10.00' } };
    const sign = signer.signRequestObject(req);

    const tampered = { ...req, biz_content: { total_amount: '999.00' }, sign, sign_type: 'SHA256WithRSA' };
    expect(SignatureVerifier.verify(tampered, config)).toBe(false);
  });

  it('derives the public key from the private key when telebirrPublicKey is not set', () => {
    const config = makeConfig();
    const signer = new Signer(config);

    const req = { timestamp: '1000', nonce_str: 'ABC' };
    const sign = signer.signRequestObject(req);
    const params = { ...req, sign, sign_type: 'SHA256WithRSA' };

    expect(SignatureVerifier.verify(params, config)).toBe(true);
  });

  it('returns false (not throw) when sign or sign_type is missing', () => {
    const config = makeConfig({ telebirrPublicKey: publicKey });
    expect(SignatureVerifier.verify({ foo: 'bar' }, config)).toBe(false);
  });

  it('extractPublicKeyFromPrivateKey returns a usable PEM public key', () => {
    const extracted = SignatureVerifier.extractPublicKeyFromPrivateKey(privateKey);
    expect(extracted).toContain('BEGIN PUBLIC KEY');

    const req = { timestamp: '1000', nonce_str: 'ABC' };
    const signer = new Signer(makeConfig());
    const sign = signer.signRequestObject(req);

    expect(SignatureVerifier.verify({ ...req, sign, sign_type: 'SHA256WithRSA' }, extracted)).toBe(true);
  });
});

describe('Signer.createNonceStr / createTimeStamp', () => {
  it('creates a 32-char uppercase alphanumeric nonce', () => {
    const nonce = Signer.createNonceStr();
    expect(nonce).toHaveLength(32);
    expect(nonce).toMatch(/^[0-9A-Z]{32}$/);
  });

  it('creates a unix-seconds timestamp string', () => {
    const ts = Signer.createTimeStamp();
    expect(ts).toMatch(/^\d+$/);
    expect(Math.abs(Date.now() / 1000 - Number(ts))).toBeLessThan(5);
  });
});
