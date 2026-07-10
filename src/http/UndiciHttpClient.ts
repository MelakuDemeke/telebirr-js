import { readFileSync } from 'node:fs';
import { Agent, request as undiciRequest } from 'undici';
import type { HttpClient } from './HttpClient.js';
import { HttpClientError } from './HttpClientError.js';
import { HttpResponse } from './HttpResponse.js';

export interface UndiciHttpClientOptions {
  /** Verify the peer's TLS certificate. Default true. */
  verifySsl?: boolean;
  /** Path to a CA bundle (PEM) to verify against, if not using the system store. */
  caBundlePath?: string | null;
  /** Maximum total request time in seconds. Default 30. */
  timeout?: number;
  /** Maximum connection time in seconds. Default 10. */
  connectTimeout?: number;
}

/**
 * Default HTTP client, built on `undici` (the HTTP client Node's own `fetch`
 * is built on).
 *
 * Unlike a bare `fetch()` call, this:
 *  - verifies the server's TLS certificate by default (a payment gateway must
 *    not be talked to over an unverified connection), and
 *  - applies connect and total timeouts so a hung endpoint cannot block the
 *    process indefinitely.
 *
 * TLS verification can be relaxed and a custom CA bundle supplied for
 * unusual environments, but the safe defaults are on unless you opt out
 * explicitly.
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

    this.agent = new Agent({
      connectTimeout: connectTimeoutSeconds * 1000,
      connect: {
        rejectUnauthorized: verifySsl,
        ca: verifySsl && caBundlePath ? readFileSync(caBundlePath) : undefined,
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
      const message = e instanceof Error ? e.message : String(e);
      throw new HttpClientError(`HTTP request to ${url} failed: ${message}`, { cause: e });
    }
  }
}
