import { TelebirrError } from './TelebirrError.js';

/**
 * Thrown when a parameter fails validation (e.g. an invalid merch_order_id
 * charset, a non-numeric amount, a malformed URL).
 */
export class InvalidParameterError extends TelebirrError {
  readonly parameterName: string;
  readonly parameterValue: unknown;
  readonly suggestion: string | null;

  constructor(
    parameterName: string,
    parameterValue: unknown,
    message: string,
    suggestion: string | null = null
  ) {
    super(message);
    this.parameterName = parameterName;
    this.parameterValue = parameterValue;
    this.suggestion = suggestion;
  }
}
