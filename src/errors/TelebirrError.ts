/**
 * Base error for every runtime failure this library throws (API failures,
 * transport errors, signature failures). Catch this to handle any Telebirr
 * error in one place, regardless of the concrete subclass:
 *
 * ```ts
 * try {
 *   await telebirr.createCheckoutUrl('Order 123', '100.00');
 * } catch (err) {
 *   if (err instanceof TelebirrError) {
 *     // any error originating from the Telebirr library
 *   }
 * }
 * ```
 *
 * `InvalidParameterError` and `ConfigurationError` also extend this class, so
 * a single `catch (err instanceof TelebirrError)` covers argument/config
 * problems too — mirroring how the PHP library's `TelebirrExceptionInterface`
 * is implemented by every exception it throws.
 */
export class TelebirrError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
