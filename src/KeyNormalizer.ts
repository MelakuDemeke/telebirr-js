import { createPrivateKey, createPublicKey } from 'node:crypto';

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Normalizes RSA key material into PEM before it reaches Node's OpenSSL.
 *
 * Ethio Telecom issues merchant keys as **bare base64 DER** (no PEM armor, no
 * line breaks). Passing that straight to `node:crypto` fails with the opaque
 * `error:1E08010C:DECODER routines::unsupported (ERR_OSSL_UNSUPPORTED)`.
 * These helpers accept either form — bare base64 or PEM (including PEM whose
 * newlines were flattened to literal `\n` by an env file) — and always return
 * proper PEM, picking the right header (`PRIVATE KEY` PKCS#8 vs
 * `RSA PRIVATE KEY` PKCS#1; `PUBLIC KEY` SPKI vs `RSA PUBLIC KEY` PKCS#1) by
 * test-parsing the candidates.
 */
export class KeyNormalizer {
  /** Normalize a private key (bare base64 DER or PEM) to PEM. */
  static normalizePrivateKey(key: string): string {
    return KeyNormalizer.normalize(key, ['PRIVATE KEY', 'RSA PRIVATE KEY'], (pem) => createPrivateKey(pem));
  }

  /** Normalize a public key (bare base64 DER or PEM) to PEM. */
  static normalizePublicKey(key: string): string {
    return KeyNormalizer.normalize(key, ['PUBLIC KEY', 'RSA PUBLIC KEY'], (pem) => createPublicKey(pem));
  }

  private static normalize(key: string, labels: string[], parse: (pem: string) => unknown): string {
    const trimmed = key.trim();

    // Already PEM — just repair literal `\n` sequences from env files.
    if (trimmed.includes('-----BEGIN')) {
      return trimmed.replace(/\\n/g, '\n');
    }

    const body = trimmed.replace(/\\n/g, '').replace(/\s+/g, '');
    if (body === '' || !BASE64_PATTERN.test(body)) {
      return key; // not base64 — leave untouched so validation reports it
    }

    const wrapped = body.match(/.{1,64}/g)?.join('\n') ?? body;
    const candidates = labels.map((label) => `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`);

    for (const pem of candidates) {
      try {
        parse(pem);
        return pem;
      } catch {
        // wrong header for this DER encoding — try the next label
      }
    }

    // Unparseable either way: return the conventional wrapping so the later
    // crypto error at least shows a well-formed PEM was attempted.
    return candidates[0]!;
  }
}
