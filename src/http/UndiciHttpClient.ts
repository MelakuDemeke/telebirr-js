import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { Agent, request as undiciRequest } from 'undici';
import type { HttpClient } from './HttpClient.js';
import { HttpClientError } from './HttpClientError.js';
import { HttpResponse } from './HttpResponse.js';
import { TELEBIRR_CA_CERTIFICATES } from './telebirr-ca.js';

export interface UndiciHttpClientOptions {
  /** Verify the peer's TLS certificate. Default true. */
  verifySsl?: boolean;
  /** Path to an ADDITIONAL CA bundle (PEM) to trust, on top of the system store and the bundled Telebirr CA. */
  caBundlePath?: string | null;
  /** Maximum total request time in seconds. Default 30. */
  timeout?: number;
  /** Maximum connection time in seconds. Default 10. */
  connectTimeout?: number;
}

/** TLS certificate-verification failure codes worth explaining to the integrator. */
const TLS_VERIFY_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const TLS_FAILURE_GUIDANCE =
  "\n\nTelebirr's TLS certificate chain failed to verify. The test gateway is known to serve an " +
  'incomplete chain; this library bundles the missing CA, so if you are seeing this the gateway ' +
  'certificate may have been rotated. Options:\n' +
  "  1. Update to the latest version of this library (refreshed CA bundle).\n" +
  "  2. Pass caBundlePath with the gateway's current CA/intermediate PEM.\n" +
  '  3. As a LAST RESORT against the TEST gateway only, set verifySsl: false — never in production.';

/**
 * Default HTTP client, built on `undici` (the HTTP client Node's own `fetch`
 * is built on).
 *
 * Unlike a bare `fetch()` call, this:
 *  - verifies the server's TLS certificate by default (a payment gateway must
 *    not be talked to over an unverified connection),
 *  - trusts Node's default root store PLUS the bundled Telebirr intermediate
 *    CA (the test gateway serves an incomplete chain — see `telebirr-ca.ts`),
 *    so verification works out of the box without `verifySsl: false`, and
 *  - applies connect and total timeouts so a hung endpoint cannot block the
 *    process indefinitely.
 *
 * A `caBundlePath` adds further certificates to the trust set; it never
 * replaces the system store.
 */
export class UndiciHttpClient implements HttpClient {
  private readonly agent: Agent;
  private readonly timeoutMs: number;

  constructor(options: UndiciHttpClientOptions = {}) {
    const verifySsl = options.verifySsl ?? true;
    const caBundlePath = options.caBundlePath ?? null;
    const timeoutSeconds = options.timeout ?? 30;
    const connectTimeoutSeconds = options.connectTimeout ?? 10;

    this.timeoutMs = timeoutSeconds * 1000;

    // Additive trust: system roots + bundled Telebirr CA + optional user bundle.
    const ca = verifySsl
      ? [...rootCertificates, ...TELEBIRR_CA_CERTIFICATES, ...(caBundlePath ? [readFileSync(caBundlePath, 'utf8')] : [])]
      : undefined;

    this.agent = new Agent({
      connectTimeout: connectTimeoutSeconds * 1000,
      connect: {
        rejectUnauthorized: verifySsl,
        ca,
      },
    });
  }

  async post(url: string, headers: Record<string, string>, body: string): Promise<HttpResponse> {
    try {
      const { statusCode, body: responseBody } = await undiciRequest(url, {
        method: 'POST',
        headers,
        body,
        dispatcher: this.agent,
        headersTimeout: this.timeoutMs,
        bodyTimeout: this.timeoutMs,
      });

      const text = await responseBody.text();
      return new HttpResponse(statusCode, text);
    } catch (e) {
      const code = UndiciHttpClient.extractErrorCode(e);
      let message = `HTTP request to ${url} failed: ${e instanceof Error ? e.message : String(e)}`;
      if (code && TLS_VERIFY_ERROR_CODES.has(code)) {
        message += TLS_FAILURE_GUIDANCE;
      }
      throw new HttpClientError(message, { cause: e, code });
    }
  }

  /** Walk the error and its cause chain for a Node/undici error code. */
  private static extractErrorCode(e: unknown): string | null {
    let current: unknown = e;
    for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string' && code !== '') {
        return code;
      }
      current = (current as { cause?: unknown }).cause;
    }
    return null;
  }
}
