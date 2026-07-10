import { TelebirrError } from './TelebirrError.js';

/**
 * Thrown when a Telebirr API call fails: transport error, non-2xx HTTP
 * status, a non-JSON body, an API-level error code, or a missing expected
 * field.
 *
 * Carries the HTTP status code, the Telebirr error code, and the raw
 * response body (when available) so callers can branch on them
 * programmatically instead of parsing the message string.
 */
export class ApiError extends TelebirrError {
  readonly httpStatus: number | null;
  readonly errorCode: string | null;
  readonly responseBody: string | null;

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
    this.errorCode = options.errorCode ?? null;
    this.responseBody = options.responseBody ?? null;
  }
}
