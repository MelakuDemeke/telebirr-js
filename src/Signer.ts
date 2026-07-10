import { constants as cryptoConstants, randomInt, sign as cryptoSign } from 'node:crypto';
import type { Config } from './Config.js';

/**
 * Fields excluded from the signature canonical string.
 *
 * `biz_content` itself is excluded, but every field *inside* it is flattened
 * into the top-level field list and IS included in the signature.
 */
const EXCLUDED_FIELDS = new Set(['sign', 'sign_type', 'header', 'refund_info', 'openType', 'raw_request', 'biz_content']);

const NONCE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A JSON-serializable request body, optionally carrying a `biz_content` object. */
export type SignableRequest = Record<string, unknown> & { biz_content?: Record<string, unknown> };

/**
 * Request Signature Handler — Telebirr H5 C2B Request Signature Process.
 *
 * @see https://developer.ethiotelecom.et/docs/H5%20C2B%20Web%20Payment%20Integration%20Quick%20Guide/Request_signature_Process
 *
 * Signature process:
 * 1. Collect all fields from the request object (excluding excluded fields).
 * 2. Flatten fields from `biz_content` into the main field list.
 * 3. Sort all fields alphabetically (ASCII order).
 * 4. Build the canonical string: `"key1=value1&key2=value2&..."`.
 * 5. Sign the canonical string using RSA-PSS SHA256 (MGF1-SHA256, salt length 32).
 * 6. Return the base64-encoded signature.
 *
 * Uses Node's built-in `node:crypto` (backed by OpenSSL) — no third-party
 * crypto dependency, and it works identically on every platform Node
 * supports.
 */
export class Signer {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /** Build the canonical string for a request object and sign it. Returns the base64 signature. */
  signRequestObject(requestObject: SignableRequest): string {
    return this.signString(Signer.buildCanonicalString(requestObject));
  }

  /**
   * Sign a string using RSA-PSS SHA256 (SHA256withRSAandMGF1).
   *
   * Padding: PSS, hash: SHA256, MGF: MGF1-SHA256, salt length: 32 bytes.
   */
  signString(text: string): string {
    const signature = cryptoSign('sha256', Buffer.from(text, 'utf8'), {
      key: this.config.privateKey,
      padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    });
    return signature.toString('base64');
  }

  /**
   * Collect + flatten + sort the fields of a request object into Telebirr's
   * canonical `"key1=value1&key2=value2"` signing string. Shared by
   * {@link Signer} (signing) and `SignatureVerifier` (verification).
   */
  static buildCanonicalString(fields: Record<string, unknown>): string {
    const fieldMap = new Map<string, unknown>();

    for (const [key, value] of Object.entries(fields)) {
      if (EXCLUDED_FIELDS.has(key)) continue;
      fieldMap.set(key, value);
    }

    const bizContent = fields['biz_content'];
    if (bizContent && typeof bizContent === 'object' && !Array.isArray(bizContent)) {
      for (const [key, value] of Object.entries(bizContent as Record<string, unknown>)) {
        if (EXCLUDED_FIELDS.has(key)) continue;
        fieldMap.set(key, value);
      }
    }

    const sortedKeys = [...fieldMap.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    return sortedKeys.map((key) => `${key}=${String(fieldMap.get(key))}`).join('&');
  }

  static createTimeStamp(): string {
    return Math.floor(Date.now() / 1000).toString();
  }

  static createNonceStr(): string {
    let str = '';
    for (let i = 0; i < 32; i++) {
      str += NONCE_CHARS[randomInt(0, NONCE_CHARS.length)];
    }
    return str;
  }
}
