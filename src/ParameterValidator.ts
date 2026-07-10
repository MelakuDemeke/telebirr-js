import { randomInt } from 'node:crypto';
import { InvalidParameterError } from './errors/InvalidParameterError.js';

/** Alphanumeric only — the charset Telebirr accepts for merchant order ids. */
const MERCHANT_ORDER_ID_PATTERN = /^[A-Za-z0-9]+$/;

/** Characters Telebirr's title field rejects. */
const TITLE_INVALID_CHARS_PATTERN = /[~`!#$%^*()\-+=|/<>?;:"[\]{}\\&]/;
const TITLE_INVALID_CHARS_PATTERN_GLOBAL = new RegExp(TITLE_INVALID_CHARS_PATTERN.source, 'g');

const MAX_TITLE_LENGTH = 200;

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Validates and sanitizes parameters before sending them to the Telebirr API.
 *
 * Mirrors `Melaku\Telebirr\ParameterValidator` from telebirr-php field for
 * field, so behavior (including error text) stays predictable across both
 * libraries.
 */
export class ParameterValidator {
  /**
   * Validate a merchant order id.
   *
   * CHARSET RULE (enforced at this API boundary): a merchant order id MUST
   * match `^[A-Za-z0-9]+$` — ASCII letters and digits only, no underscores,
   * hyphens, dots, or any other character. Telebirr strips disallowed
   * characters on its side, so an id like `AFRO-DOC-1` comes back as
   * `AFRODOC1` and your lookup silently misses.
   *
   * - `null`/empty → a fresh valid id is generated and returned.
   * - valid id → returned unchanged.
   * - invalid id → throws by default (`autoSanitize = false`) so the problem
   *   surfaces at integration time. Only pass `true` if you genuinely want
   *   the id rewritten for you — and then you MUST persist the *returned*
   *   value, never the one you passed in.
   */
  static validateMerchantOrderId(merchantOrderId: string | null | undefined, autoSanitize = false): string {
    if (merchantOrderId === null || merchantOrderId === undefined || merchantOrderId === '') {
      return ParameterValidator.generateMerchantOrderId();
    }

    if (MERCHANT_ORDER_ID_PATTERN.test(merchantOrderId)) {
      return merchantOrderId;
    }

    if (autoSanitize) {
      const sanitized = merchantOrderId.replace(/[^A-Za-z0-9]/g, '');
      return sanitized !== '' ? sanitized : ParameterValidator.generateMerchantOrderId();
    }

    const invalidChars = [...new Set([...merchantOrderId].filter((ch) => !/[A-Za-z0-9]/.test(ch)))];
    const invalidCharsList = invalidChars.join("', '");

    const message =
      `Invalid merchant order ID: '${merchantOrderId}'\n` +
      `Reason: Contains invalid character(s): '${invalidCharsList}'\n` +
      `Required format: Alphanumeric only (A-Z, a-z, 0-9)\n` +
      `Example: 'ORDER1234567890' or '176924750778146F8A'\n` +
      `Current value: '${merchantOrderId}'`;

    const suggestion = "Remove all non-alphanumeric characters. For example, 'ORDER_123' should be 'ORDER123'";

    throw new InvalidParameterError('merchantOrderId', merchantOrderId, message, suggestion);
  }

  /**
   * Validate and sanitize a title.
   *
   * Requirements:
   * - Must not contain: `~`!#$%^*()\-+=|/<>?;:"[]{}\&`
   * - Must not be empty after sanitization
   * - Maximum length: 200 characters
   */
  static validateTitle(title: string, autoSanitize = true): string {
    const trimmed = title.trim();

    if (TITLE_INVALID_CHARS_PATTERN.test(trimmed)) {
      if (autoSanitize) {
        const sanitized = ParameterValidator.sanitizeTitle(trimmed);
        if (sanitized !== '') {
          return sanitized;
        }
      } else {
        const invalidChars = [...new Set(trimmed.match(TITLE_INVALID_CHARS_PATTERN_GLOBAL) ?? [])];
        const invalidCharsList = invalidChars.join("', '");

        const message =
          `Invalid title: '${trimmed}'\n` +
          `Reason: Contains invalid character(s): '${invalidCharsList}'\n` +
          `Required format: Must not contain: ~\`!#$%^*()\\-+=|/<>?;:"[]{}\\\\&\n` +
          `Example: 'Test Order' or 'Product Purchase'\n` +
          `Current value: '${trimmed}'`;

        const suggestion = "Remove special characters. For example, 'Order #123' should be 'Order 123'";

        throw new InvalidParameterError('title', trimmed, message, suggestion);
      }
    }

    if (trimmed === '') {
      throw new InvalidParameterError('title', trimmed, 'Title cannot be empty', 'Provide a non-empty title for the order');
    }

    return trimmed.length > MAX_TITLE_LENGTH ? trimmed.slice(0, MAX_TITLE_LENGTH) : trimmed;
  }

  /** Remove characters Telebirr rejects from a title, falling back to `'Order'` if nothing survives. */
  static sanitizeTitle(title: string): string {
    const sanitized = title.trim().replace(TITLE_INVALID_CHARS_PATTERN_GLOBAL, '');
    return sanitized !== '' ? sanitized.slice(0, MAX_TITLE_LENGTH) : 'Order';
  }

  /**
   * Validate and format an amount.
   *
   * Requirements: numeric, positive (> 0). Returned as a string formatted to
   * 2 decimal places (Telebirr's expected wire format).
   */
  static validateAmount(amount: string | number): string {
    let numeric: number;

    if (typeof amount === 'number') {
      numeric = amount;
    } else {
      const trimmed = amount.trim();
      // Plain decimal only — deliberately rejects hex/exponential/Infinity
      // strings that JS's Number() would otherwise happily parse.
      if (trimmed === '' || !/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed)) {
        const message = `Invalid amount: '${amount}'\nReason: Must be numeric, got ${typeof amount}\nExample: '10.00' or 10.00 or 10`;
        throw new InvalidParameterError('amount', amount, message, "Use a numeric value like '10.00' or 10");
      }
      numeric = Number(trimmed);
    }

    if (!Number.isFinite(numeric)) {
      const message = `Invalid amount: '${amount}'\nReason: Must be numeric, got ${typeof amount}\nExample: '10.00' or 10.00 or 10`;
      throw new InvalidParameterError('amount', amount, message, "Use a numeric value like '10.00' or 10");
    }

    if (numeric <= 0) {
      const message = `Invalid amount: '${amount}'\nReason: Amount must be positive (greater than 0)\nExample: '0.10' or '10.00'`;
      throw new InvalidParameterError('amount', amount, message, "Use a positive number like '0.10' or '10.00'");
    }

    return numeric.toFixed(2);
  }

  /** Validate a URL, used for `notifyUrl`/`redirectUrl`. */
  static validateUrl(url: string, type = 'url'): string {
    if (url === '') {
      throw new InvalidParameterError(type, url, `${type} cannot be empty`, "Provide a valid URL (e.g., 'https://example.com/notify.php')");
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('unsupported protocol');
      }
    } catch {
      const message = `Invalid ${type}: '${url}'\nReason: Must be a valid URL format\nExample: 'https://example.com/notify.php'`;
      throw new InvalidParameterError(type, url, message, 'Use a valid URL format starting with http:// or https://');
    }

    return url;
  }

  /**
   * Generate a valid merchant order id.
   *
   * Format: timestamp + random number + random alphanumeric string.
   * Guaranteed to match {@link MERCHANT_ORDER_ID_PATTERN}.
   */
  static generateMerchantOrderId(): string {
    const timestamp = Date.now().toString();
    const randomDigits = randomInt(1000, 10000).toString();
    let suffix = '';
    for (let i = 0; i < 4; i++) {
      suffix += ID_CHARS[randomInt(0, ID_CHARS.length)];
    }
    return timestamp + randomDigits + suffix;
  }

  /** Check whether a merchant order id matches Telebirr's required charset. */
  static isValidMerchantOrderId(merchantOrderId: string): boolean {
    return merchantOrderId !== '' && MERCHANT_ORDER_ID_PATTERN.test(merchantOrderId);
  }
}
