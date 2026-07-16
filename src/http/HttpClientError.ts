import { TelebirrError } from '../errors/TelebirrError.js';

/**
 * Thrown when the transport itself fails (connection error, timeout, DNS, TLS
 * handshake) before any HTTP response is received.
 *
 * `code` carries the underlying Node/undici error code when available (e.g.
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `UND_ERR_CONNECT_TIMEOUT`, `ECONNRESET`)
 * so callers — and the library's own retry logic — can branch on the failure
 * kind without string-matching the message.
 */
export class HttpClientError extends TelebirrError {
  readonly code: string | null;

  constructor(message: string, options: { cause?: unknown; code?: string | null } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.code = options.code ?? null;
  }
}
