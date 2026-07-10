import { TelebirrError } from './TelebirrError.js';

/** Thrown when {@link Config.validate} finds the configuration incomplete or malformed. */
export class ConfigurationError extends TelebirrError {
  readonly errors: readonly string[];

  constructor(errors: readonly string[], message?: string) {
    super(message && message.length > 0 ? message : `Configuration validation failed:\n${errors.join('\n')}`);
    this.errors = errors;
  }
}
