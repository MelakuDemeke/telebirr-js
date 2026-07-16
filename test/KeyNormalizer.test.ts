import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Config } from '../src/Config.js';
import { KeyNormalizer } from '../src/KeyNormalizer.js';

let pkcs8Pem: string;
let pkcs8BareBase64: string;
let pkcs1BareBase64: string;
let spkiBareBase64: string;
let pkcs1PublicBareBase64: string;

beforeAll(() => {
  const pem = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  pkcs8Pem = pem.privateKey;

  const der = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  pkcs8BareBase64 = der.privateKey.toString('base64');
  spkiBareBase64 = der.publicKey.toString('base64');

  const pkcs1 = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'der' },
    privateKeyEncoding: { type: 'pkcs1', format: 'der' },
  });
  pkcs1BareBase64 = pkcs1.privateKey.toString('base64');
  pkcs1PublicBareBase64 = pkcs1.publicKey.toString('base64');
});

describe('KeyNormalizer.normalizePrivateKey', () => {
  it('wraps bare base64 PKCS#8 DER (the format Ethio Telecom issues) into parseable PEM', () => {
    const pem = KeyNormalizer.normalizePrivateKey(pkcs8BareBase64);
    expect(pem).toContain('-----BEGIN PRIVATE KEY-----');
    expect(() => createPrivateKey(pem)).not.toThrow();
  });

  it('wraps bare base64 PKCS#1 DER with the RSA PRIVATE KEY header', () => {
    const pem = KeyNormalizer.normalizePrivateKey(pkcs1BareBase64);
    expect(pem).toContain('-----BEGIN RSA PRIVATE KEY-----');
    expect(() => createPrivateKey(pem)).not.toThrow();
  });

  it('passes existing PEM through unchanged', () => {
    expect(KeyNormalizer.normalizePrivateKey(pkcs8Pem)).toBe(pkcs8Pem.trim());
  });

  it('repairs PEM whose newlines were flattened to literal \\n by an env file', () => {
    const flattened = pkcs8Pem.trim().replace(/\n/g, '\\n');
    const pem = KeyNormalizer.normalizePrivateKey(flattened);
    expect(() => createPrivateKey(pem)).not.toThrow();
  });

  it('tolerates whitespace/line breaks inside bare base64', () => {
    const withBreaks = pkcs8BareBase64.match(/.{1,60}/g)!.join('\n');
    const pem = KeyNormalizer.normalizePrivateKey(withBreaks);
    expect(() => createPrivateKey(pem)).not.toThrow();
  });

  it('leaves non-base64 garbage untouched for validation to report', () => {
    expect(KeyNormalizer.normalizePrivateKey('not a key!!')).toBe('not a key!!');
  });
});

describe('KeyNormalizer.normalizePublicKey', () => {
  it('wraps bare base64 SPKI DER into parseable PEM', () => {
    const pem = KeyNormalizer.normalizePublicKey(spkiBareBase64);
    expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
    expect(() => createPublicKey(pem)).not.toThrow();
  });

  it('wraps bare base64 PKCS#1 DER with the RSA PUBLIC KEY header', () => {
    const pem = KeyNormalizer.normalizePublicKey(pkcs1PublicBareBase64);
    expect(pem).toContain('-----BEGIN RSA PUBLIC KEY-----');
    expect(() => createPublicKey(pem)).not.toThrow();
  });
});

describe('Config key normalization', () => {
  function options(privateKey: string, telebirrPublicKey?: string) {
    return {
      fabricAppId: 'fabric-app-id',
      appSecret: 'secret',
      merchantAppId: 'merchant-app-id',
      merchantCode: '123456',
      privateKey,
      telebirrPublicKey,
      notifyUrl: 'https://example.com/notify',
    };
  }

  it('accepts a bare base64 private key and validates it as PEM', () => {
    const config = Config.forTest(options(pkcs8BareBase64));
    expect(config.privateKey).toContain('-----BEGIN PRIVATE KEY-----');
    expect(config.validate()).toBe(true);
    expect(() => createPrivateKey(config.privateKey)).not.toThrow();
  });

  it('accepts a bare base64 PKCS#1 private key (RSA PRIVATE KEY header) in validate()', () => {
    const config = Config.forTest(options(pkcs1BareBase64));
    expect(config.privateKey).toContain('-----BEGIN RSA PRIVATE KEY-----');
    expect(config.validate()).toBe(true);
  });

  it('normalizes a bare base64 telebirrPublicKey', () => {
    const config = Config.forTest(options(pkcs8BareBase64, spkiBareBase64));
    expect(config.telebirrPublicKey).toContain('-----BEGIN PUBLIC KEY-----');
    expect(() => createPublicKey(config.telebirrPublicKey!)).not.toThrow();
  });
});
