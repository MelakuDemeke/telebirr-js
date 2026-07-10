/**
 * Minimal structured logger interface — deliberately shaped to be a drop-in
 * fit for `console`, `pino`, `winston`, or any logger with `debug/info/warn/error`
 * methods that accept `(message, meta?)`.
 */
export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/** No-op logger used as the default when none is injected. */
export class NullLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
