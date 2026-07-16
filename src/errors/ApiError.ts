import { HttpClientError } from '../http/HttpClientError.js';
import { TelebirrError } from './TelebirrError.js';

/**
 * Telebirr gateway error codes that indicate a TRANSIENT, gateway-side
 * failure — the request was fine, the platform hiccuped, and a retry is the
 * documented remedy (Telebirr's own `errorSolution` text advises retrying).
 *
 * `49401024991` — "southbound business service unavailable": the sandbox
 * throws this frequently; it is not an integration bug.
 *
 * Exposed so integrators can extend it if Telebirr introduces new codes.
 */
export const TRANSIENT_TELEBIRR_ERROR_CODES = new Set(['49401024991']);

/** Transport-level failure codes that are safe to retry (nothing reached the gateway, or the connection dropped). */
const TRANSIENT_TRANSPORT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
]);

const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

/**
 * Thrown when a Telebirr API call fails: transport error, non-2xx HTTP
 * status, a non-JSON body, an API-level error code, or a missing expected
 * field.
 *
 * Carries the HTTP status, the raw response body, AND the parsed fields of
 * Telebirr's error envelope (`{errorCode, errorMsg, errorSolution}`) as
 * {@link telebirrCode} / {@link telebirrMessage} / {@link telebirrSolution},
 * so callers can branch on gateway errors programmatically instead of
 * `JSON.parse`-ing {@link responseBody} themselves.
 */
export class ApiError extends TelebirrError {
  readonly httpStatus: number | null;
  readonly errorCode: string | null;
  readonly responseBody: string | null;
  /** Telebirr's `errorCode` (or `code`) from the error envelope in the response body, when present. */
  readonly telebirrCode: string | null;
  /** Telebirr's `errorMsg`/`message`/`msg` from the error envelope, when present. */
  readonly telebirrMessage: string | null;
  /** Telebirr's `errorSolution` remediation text from the error envelope, when present. */
  readonly telebirrSolution: string | null;

  constructor(
    message: string,
    options: {
      httpStatus?: number | null;
      errorCode?: string | null;
      responseBody?: string | null;
      cause?: unknown;
    } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.httpStatus = options.httpStatus ?? null;
    this.responseBody = options.responseBody ?? null;

    const envelope = ApiError.parseErrorEnvelope(this.responseBody);
    this.telebirrCode = envelope.code;
    this.telebirrMessage = envelope.message;
    this.telebirrSolution = envelope.solution;
    // Surface the envelope's code on errorCode too, so it is never null when
    // Telebirr did return one buried in the body.
    this.errorCode = options.errorCode ?? envelope.code;
  }

  /**
   * Whether this failure is known-transient and worth retrying: a Telebirr
   * infra error code (see {@link TRANSIENT_TELEBIRR_ERROR_CODES}), an HTTP
   * 502/503/504, or a transport timeout/reset before any response arrived.
   */
  isTransient(): boolean {
    if (this.telebirrCode && TRANSIENT_TELEBIRR_ERROR_CODES.has(this.telebirrCode)) {
      return true;
    }
    if (this.httpStatus !== null && TRANSIENT_HTTP_STATUSES.has(this.httpStatus)) {
      return true;
    }
    if (this.cause instanceof HttpClientError && this.cause.code && TRANSIENT_TRANSPORT_CODES.has(this.cause.code)) {
      return true;
    }
    return false;
  }

  private static parseErrorEnvelope(responseBody: string | null): { code: string | null; message: string | null; solution: string | null } {
    const empty = { code: null, message: null, solution: null };
    if (!responseBody) {
      return empty;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(responseBody);
    } catch {
      return empty;
    }
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      return empty;
    }

    const data = decoded as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null);

    let code = str(data['errorCode'] ?? data['code']);
    // '00000'/'0' are Telebirr's SUCCESS codes — a body carrying one is not an error envelope.
    if (code === '00000' || code === '0') {
      code = null;
    }

    return {
      code,
      message: str(data['errorMsg'] ?? data['message'] ?? data['msg']),
      solution: str(data['errorSolution']),
    };
  }
}
