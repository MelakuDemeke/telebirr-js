import type { HttpResponse } from './HttpResponse.js';

/**
 * Small HTTP client abstraction the library uses for every Telebirr API call.
 *
 * Injecting an implementation is what makes the library unit-testable: pass
 * a fake that returns canned {@link HttpResponse} objects and no network is
 * touched. The default {@link UndiciHttpClient} performs real requests with
 * TLS verification and timeouts enabled.
 */
export interface HttpClient {
  /**
   * Perform a POST request.
   *
   * @param url Absolute request URL.
   * @param headers Header map, e.g. `{ 'Content-Type': 'application/json' }`.
   * @param body Raw request body.
   * @returns The status code and body. Implementations MUST NOT throw on a
   *          non-2xx status — only on transport failure.
   * @throws HttpClientError on connection/timeout/TLS errors.
   */
  post(url: string, headers: Record<string, string>, body: string): Promise<HttpResponse>;
}
