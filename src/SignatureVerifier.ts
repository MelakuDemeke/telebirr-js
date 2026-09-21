import { constants as cryptoConstants, createPrivateKey, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { Config } from './Config.js';
import { Signer } from './Signer.js';

/** Typical base64-encoded RSA-2048 PSS signatures are ~344 chars; shorter is suspicious (likely URL truncation). */
const MIN_PLAUSIBLE_SIGNATURE_LENGTH = 200;

/**
 * Fields Telebirr signs under one name and transmits under another, keyed by
 * the name on the wire and valued by the name that went into the hash.
 *
 * Telebirr's integration guide names the transaction id `trans_id`; the JSON
 * their gateway actually POSTs calls it `transId`. They sign the former and
 * send the latter, so a canonical string built from the keys as received can
 * never match theirs, and every notification carrying that field is refused.
 * The rename breaks verification twice over — `transId` sorts *before*
 * `trans_currency` (`I` is 0x49, `_` is 0x5F) while `trans_id` sorts *after*
 * `trans_end_time` — so no reordering of the received keys can rescue it.
 *
 * Confirmed against a live production notification (2026-08-21) that failed
 * every subset and ordering of its received keys and verified on the first
 * attempt once renamed. The return leg carries no transaction id, which is
 * why only the notify leg ever broke.
 */
const SIGNED_FIELD_ALIASES: Readonly<Record<string, string>> = {
  transId: 'trans_id',
};

/** `decodeURIComponent` that returns the input unchanged instead of throwing on a malformed `%` sequence. */
function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

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

    // Every canonical string Telebirr might have hashed, against every
    // reading of the signature bytes.
    return SignatureVerifier.verifyParams(params, signature, publicKey);
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

    return SignatureVerifier.verifyParams(params, params['sign'], publicKey);
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
   *
   * The base64 alphabet contains no space, so a space is always a `+` that URL
   * decoding ate — Telebirr sends the raw `+` unencoded in the return URL's
   * query string. Spaces are replaced unconditionally, including in a
   * partially encoded signature that carries both a literal `+` (from `%2B`)
   * and a mangled space.
   */
  static normalizeSignature(signature: string): string {
    return signature.replace(/ /g, '+');
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

  /** Verify one parameter set against every canonical string Telebirr might have signed. */
  private static verifyParams(params: Record<string, unknown>, signature: string, publicKeyPem: string): boolean {
    return SignatureVerifier.canonicalStringVariants(params).some((canonicalString) =>
      SignatureVerifier.verifySignature(canonicalString, signature, publicKeyPem)
    );
  }

  /**
   * The canonical strings Telebirr might have hashed for this payload.
   *
   * The payload exactly as received comes first, so a gateway that names its
   * fields consistently keeps working unchanged. Only then is the aliased form
   * tried. This widens which *string* is hashed, never *who* may have signed
   * it — every variant is checked against the same public key, so forging any
   * of them still requires Telebirr's private key.
   */
  private static canonicalStringVariants(params: Record<string, unknown>): string[] {
    const variants = [Signer.buildCanonicalString(params)];

    const aliased: Record<string, unknown> = { ...params };
    let renamed = false;

    for (const [sentAs, signedAs] of Object.entries(SIGNED_FIELD_ALIASES)) {
      if (sentAs in aliased && !(signedAs in aliased)) {
        aliased[signedAs] = aliased[sentAs];
        delete aliased[sentAs];
        renamed = true;
      }
    }

    if (renamed) {
      variants.push(Signer.buildCanonicalString(aliased));
    }

    return variants;
  }

  private static verifySignature(data: string, signature: string, publicKeyPem: string): boolean {
    const payload = Buffer.from(data, 'utf8');

    // Every reading is checked against the same key, so trying several widens
    // which bytes we are willing to call the signature, never who is allowed
    // to have produced them.
    return SignatureVerifier.decodeSignatureCandidates(signature).some((candidate) => {
      try {
        return cryptoVerify(
          'sha256',
          payload,
          {
            key: publicKeyPem,
            padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
            saltLength: 32,
          },
          candidate
        );
      } catch {
        return false;
      }
    });
  }

  /**
   * Every plausible reading of a base64 signature, as raw bytes, most likely
   * first. All distinct readings are returned rather than the first that
   * decodes, so a reading that parses but yields the wrong bytes can never
   * shadow the correct one.
   */
  private static decodeSignatureCandidates(signature: string): Buffer[] {
    const urlDecoded = safeDecodeURIComponent(signature);
    const attempts = [signature.replace(/ /g, '+'), signature, urlDecoded.replace(/ /g, '+'), urlDecoded];

    const decoded: Buffer[] = [];

    for (const attempt of attempts) {
      // Padding is sometimes lost in transit; restore it.
      const withPadding = attempt + '='.repeat((4 - (attempt.length % 4)) % 4);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(withPadding)) {
        continue;
      }

      const buf = Buffer.from(withPadding, 'base64');
      if (buf.length > 0 && !decoded.some((existing) => existing.equals(buf))) {
        decoded.push(buf);
      }
    }

    return decoded;
  }
}
