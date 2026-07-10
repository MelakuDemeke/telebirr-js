import { constants as cryptoConstants, createPrivateKey, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { Config } from './Config.js';
import { Signer } from './Signer.js';

/** Typical base64-encoded RSA-2048 PSS signatures are ~344 chars; shorter is suspicious (likely URL truncation). */
const MIN_PLAUSIBLE_SIGNATURE_LENGTH = 200;

/**
 * Verifies signatures from Telebirr's return URLs and server-to-server
 * notifications.
 *
 * You need a PUBLIC KEY to verify signatures:
 * - If Telebirr signs using *your* private key, extract your public key from
 *   it with {@link SignatureVerifier.extractPublicKeyFromPrivateKey}.
 * - If Telebirr uses its own key pair, you need Telebirr's public key
 *   (obtained from Telebirr support) — pass it as `config.telebirrPublicKey`.
 *
 * @see https://developer.ethiotelecom.et/docs/H5%20C2B%20Web%20Payment%20Integration%20Quick%20Guide/Request_signature_Process
 */
export class SignatureVerifier {
  /**
   * Verify a signature from a return URL or notification payload.
   *
   * @param params All parameters, including `sign` and `sign_type`.
   * @param configOrPublicKey A {@link Config} instance, or Telebirr's public key (PEM).
   * @throws Error if no public key is available.
   */
  static verify(params: Record<string, unknown>, configOrPublicKey: Config | string): boolean {
    const publicKey = SignatureVerifier.resolvePublicKey(configOrPublicKey);
    if (!publicKey) {
      throw new Error('No public key available for verification. Provide telebirrPublicKey in config or pass it directly.');
    }

    const signature = typeof params['sign'] === 'string' ? params['sign'] : '';
    const signType = typeof params['sign_type'] === 'string' ? params['sign_type'] : '';

    if (!signature || !signType) {
      return false;
    }

    if (SignatureVerifier.detectTruncation(signature)) {
      console.error(
        `SignatureVerifier: Signature appears truncated. Length: ${signature.length}, expected >= ${MIN_PLAUSIBLE_SIGNATURE_LENGTH} characters. The URL might be too long.`
      );
    }

    const canonicalString = Signer.buildCanonicalString(params);
    const normalizedSignature = SignatureVerifier.normalizeSignature(signature);

    if (SignatureVerifier.verifySignature(canonicalString, normalizedSignature, publicKey)) {
      return true;
    }

    const urlDecoded = decodeURIComponent(signature);
    if (urlDecoded !== normalizedSignature && SignatureVerifier.verifySignature(canonicalString, urlDecoded, publicKey)) {
      return true;
    }

    return false;
  }

  /**
   * Verify using a raw query string (e.g. `req.url`'s query part), in case
   * the framework's parsed params were mangled (`+` decoded to space, etc.).
   */
  static verifyFromRawQueryString(rawQueryString: string, configOrPublicKey: Config | string): boolean {
    const publicKey = SignatureVerifier.resolvePublicKey(configOrPublicKey);
    if (!publicKey) {
      return false;
    }

    const params = Object.fromEntries(new URLSearchParams(rawQueryString));
    if (!params['sign'] || !params['sign_type']) {
      return false;
    }

    const canonicalString = Signer.buildCanonicalString(params);
    return SignatureVerifier.verifySignature(canonicalString, params['sign'], publicKey);
  }

  /** The canonical string that would be signed/verified for `params` — exposed for debugging. */
  static getCanonicalString(params: Record<string, unknown>): string {
    return Signer.buildCanonicalString(params);
  }

  /**
   * Typical base64-encoded RSA-PSS signatures run long; a signature shorter
   * than {@link MIN_PLAUSIBLE_SIGNATURE_LENGTH} is likely truncated (e.g. by
   * an overlong redirect URL getting cut off).
   */
  static detectTruncation(signature: string): boolean {
    return signature.length < MIN_PLAUSIBLE_SIGNATURE_LENGTH;
  }

  /**
   * Normalize a signature that may have passed through query-string decoding,
   * where a literal `+` in base64 becomes a space.
   */
  static normalizeSignature(signature: string): string {
    if (signature.includes(' ') && !signature.includes('+')) {
      return signature.replace(/ /g, '+');
    }
    return signature;
  }

  /**
   * Extract the public key from a private key (PEM), for the common case
   * where Telebirr signs using your own key pair.
   *
   * @returns The public key in PEM format (SPKI).
   */
  static extractPublicKeyFromPrivateKey(privateKeyPem: string): string {
    try {
      const privateKey = createPrivateKey(privateKeyPem);
      const publicKey = createPublicKey(privateKey);
      return publicKey.export({ type: 'spki', format: 'pem' }).toString();
    } catch (e) {
      throw new Error(`Invalid private key or failed to extract public key: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }

  private static resolvePublicKey(configOrPublicKey: Config | string): string | null {
    if (typeof configOrPublicKey === 'string') {
      return configOrPublicKey;
    }

    if (configOrPublicKey instanceof Config) {
      if (configOrPublicKey.telebirrPublicKey) {
        return configOrPublicKey.telebirrPublicKey;
      }
      if (configOrPublicKey.privateKey) {
        try {
          return SignatureVerifier.extractPublicKeyFromPrivateKey(configOrPublicKey.privateKey);
        } catch {
          return null;
        }
      }
    }

    return null;
  }

  private static verifySignature(data: string, signature: string, publicKeyPem: string): boolean {
    const decoded = SignatureVerifier.decodeSignature(signature);
    if (!decoded) {
      return false;
    }

    try {
      return cryptoVerify(
        'sha256',
        Buffer.from(data, 'utf8'),
        {
          key: publicKeyPem,
          padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        },
        decoded
      );
    } catch {
      return false;
    }
  }

  /** Try a handful of base64 decoding strategies to cope with URL-transport mangling. */
  private static decodeSignature(signature: string): Buffer | null {
    const candidates = [signature, signature.replace(/ /g, '+'), decodeURIComponent(signature).replace(/ /g, '+'), decodeURIComponent(signature)];

    for (const candidate of candidates) {
      const withPadding = candidate + '='.repeat((4 - (candidate.length % 4)) % 4);
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(withPadding)) {
        try {
          const buf = Buffer.from(withPadding, 'base64');
          if (buf.length > 0) {
            return buf;
          }
        } catch {
          // try next candidate
        }
      }
    }

    return null;
  }
}
