import type { Config } from './Config.js';
import { TelebirrError } from './errors/TelebirrError.js';
import { NotificationResponse } from './NotificationResponse.js';
import { PaymentStatus } from './PaymentStatus.js';
import { SignatureVerifier } from './SignatureVerifier.js';

export interface PaymentInfo {
  /** Payment status — `Completed` on the notify leg, `PAY_SUCCESS` on the return leg. */
  tradeStatus: string;
  /** Telebirr's payment order id. */
  paymentOrderId: string;
  /** Your merchant order id. */
  merchantOrderId: string;
  /**
   * Telebirr's short transaction id — the one the customer sees in their SMS
   * receipt, and the one they will quote to your support desk. Empty on the
   * return leg, which carries none.
   */
  transId: string;
  /** The merchant code the payment was made against. */
  merchCode: string;
  /** The app id the payment was made against. */
  appId: string;
  /** The callback URL Telebirr echoes back — worth logging when diagnosing notifications that never arrive. */
  notifyUrl: string;
  amount: string;
  currency: string;
  /** Transaction end time, verbatim. */
  timestamp: string;
  /** Notification time, verbatim. */
  notifyTime: string;
  /** Transaction end time as Unix seconds, or null when the value is not an epoch. */
  timestampUnix: number | null;
  /** Notification time as Unix seconds, or null when the value is not an epoch. */
  notifyTimeUnix: number | null;
  /** The full payload. */
  raw: Record<string, unknown>;
}

/** {@link PaymentInfo} plus the success verdict, as returned by {@link NotificationHandler.handle}. */
export interface NotificationPaymentData extends PaymentInfo {
  isSuccess: boolean;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : value !== undefined && value !== null ? String(value) : '');

/**
 * Helper for handling Telebirr server-to-server payment notifications:
 * parses JSON, verifies signatures, and builds acknowledgement responses.
 *
 * The notify leg does not speak quite the same dialect as the return URL or
 * queryOrder, and every difference fails the same silent way — as a payload
 * that verifies but never fulfils. The three that bite:
 *
 *  - `trade_status` is `Completed`, not `PAY_SUCCESS` (see {@link PaymentStatus}).
 *  - the body is sometimes wrapped in a `data` envelope, which hides both the
 *    order id and the signature from every helper here (see {@link NotificationHandler.unwrap}).
 *  - `notify_time` / `trans_end_time` are epoch **milliseconds**, where the
 *    return URL sends `Y-m-d H:i:s` strings (see {@link NotificationHandler.toUnixSeconds}).
 */
export class NotificationHandler {
  /**
   * Parse a notification from the raw JSON request body.
   *
   * The `data` envelope is unwrapped here, so everything downstream —
   * {@link verify}, {@link isPaymentSuccessful}, {@link extractPaymentInfo} —
   * sees the flat payload it expects.
   *
   * @throws SyntaxError if the JSON is invalid.
   */
  static parse(rawJson: string): Record<string, unknown> {
    const data: unknown = JSON.parse(rawJson);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new SyntaxError('Notification data must be a JSON object');
    }
    return NotificationHandler.unwrap(data as Record<string, unknown>);
  }

  /**
   * Unwrap the `data` envelope, if there is one.
   *
   * Both shapes are tolerated rather than the wrapper being assumed: flat
   * bodies are documented and observed in the field, so anything already flat
   * passes through untouched. Left wrapped, `merch_order_id` and `sign` are
   * both invisible — the signature check refuses the callback and the
   * reference matches no order.
   */
  static unwrap(notification: Record<string, unknown>): Record<string, unknown> {
    const inner = notification['data'];

    // `merch_order_id` is the marker for a genuine envelope. Unwrapping on the
    // mere presence of a `data` key would mangle a flat payload that happened
    // to carry an unrelated one.
    if (inner && typeof inner === 'object' && !Array.isArray(inner) && 'merch_order_id' in inner) {
      return inner as Record<string, unknown>;
    }

    return notification;
  }

  /**
   * Parse, verify and extract a notification in one call — the safe default.
   *
   * Fails closed: an unsigned or badly signed body throws rather than
   * returning something that looks usable. Mirrors {@link ReturnUrlHandler.handle}.
   *
   * As with the return leg, a valid signature proves the payload was not
   * tampered with in transit — not that the payment succeeded. For anything
   * that fulfils an order, confirm with {@link Telebirr.getOrderStatus}.
   *
   * @throws SyntaxError if the body is not valid JSON.
   * @throws TelebirrError if the signature is missing or invalid.
   */
  static handle(rawJson: string, config: Config): NotificationPaymentData {
    const notification = NotificationHandler.parse(rawJson);

    if (!NotificationHandler.verify(notification, config)) {
      throw new TelebirrError(
        'Invalid notification signature - refusing to trust the payload. Confirm the order server-to-server via Telebirr.getOrderStatus().'
      );
    }

    return {
      ...NotificationHandler.extractPaymentInfo(notification),
      isSuccess: NotificationHandler.isPaymentSuccessful(notification),
    };
  }

  /** Verify a notification's signature. */
  static verify(notification: Record<string, unknown>, config: Config): boolean {
    if (!notification['sign']) {
      return false;
    }
    return SignatureVerifier.verify(notification, config);
  }

  /**
   * Build the success acknowledgement for Telebirr.
   *
   * Returns a {@link NotificationResponse} value object — it does not write
   * to any response itself. Call `.send(res)` for a Node/Express response,
   * or `.toWebResponse()` for a standard `Response` (Next.js/Remix/etc.).
   */
  static respondSuccess(message?: string): NotificationResponse {
    const response: Record<string, unknown> = { success: true };
    if (message !== undefined) {
      response['message'] = message;
    }
    return new NotificationResponse(200, JSON.stringify(response));
  }

  /**
   * Build an error acknowledgement for Telebirr. Telebirr may retry the
   * notification when it receives an error status.
   */
  static respondError(message: string, httpCode = 500): NotificationResponse {
    return new NotificationResponse(httpCode, JSON.stringify({ success: false, message }));
  }

  /** Whether the notification indicates a successful payment. */
  static isPaymentSuccessful(notification: Record<string, unknown>): boolean {
    const tradeStatus = notification['trade_status'];
    if (typeof tradeStatus === 'string' && tradeStatus !== '') {
      return PaymentStatus.isSuccess(tradeStatus);
    }

    const status = notification['status'];
    if (typeof status === 'string' && status !== '') {
      return PaymentStatus.isSuccess(status);
    }

    return false;
  }

  /** Extract normalized payment information from a notification payload. */
  static extractPaymentInfo(notification: Record<string, unknown>): PaymentInfo {
    return {
      tradeStatus: str(notification['trade_status']),
      paymentOrderId: str(notification['payment_order_id'] ?? notification['prepay_id']),
      merchantOrderId: str(notification['merch_order_id']),
      transId: str(notification['transId'] ?? notification['trans_id']),
      merchCode: str(notification['merch_code']),
      appId: str(notification['appid']),
      notifyUrl: str(notification['notify_url']),
      amount: str(notification['total_amount'] ?? notification['amount']),
      currency: typeof notification['trans_currency'] === 'string' ? (notification['trans_currency'] as string) : 'ETB',
      timestamp: str(notification['trans_end_time']),
      notifyTime: str(notification['notify_time']),
      timestampUnix: NotificationHandler.toUnixSeconds(notification['trans_end_time']),
      notifyTimeUnix: NotificationHandler.toUnixSeconds(notification['notify_time']),
      raw: notification,
    };
  }

  /**
   * Normalize a Telebirr time field to Unix seconds.
   *
   * The notify leg sends epoch milliseconds (`1784756474676`); the return URL
   * sends a formatted `Y-m-d H:i:s` string instead. Anything non-numeric
   * therefore yields null rather than a guess — the formatted strings carry no
   * timezone, and assuming one here would quietly shift every timestamp.
   */
  static toUnixSeconds(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return null;
    }

    const trimmed = String(value).trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }

    const number = Number(trimmed);

    // 99999999999 seconds is the year 5138, so anything larger is milliseconds.
    return number > 99_999_999_999 ? Math.floor(number / 1000) : number;
  }
}
