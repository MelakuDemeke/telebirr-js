import type { Config } from './Config.js';
import { NotificationResponse } from './NotificationResponse.js';
import { PaymentStatus } from './PaymentStatus.js';
import { SignatureVerifier } from './SignatureVerifier.js';

export interface PaymentInfo {
  tradeStatus: string;
  paymentOrderId: string;
  merchantOrderId: string;
  amount: string;
  currency: string;
  timestamp: string;
  notifyTime: string;
}

/**
 * Helper for handling Telebirr server-to-server payment notifications:
 * parses JSON, verifies signatures, and builds acknowledgement responses.
 */
export class NotificationHandler {
  /** Parse a notification from the raw JSON request body. @throws SyntaxError if the JSON is invalid. */
  static parse(rawJson: string): Record<string, unknown> {
    const data: unknown = JSON.parse(rawJson);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new SyntaxError('Notification data must be a JSON object');
    }
    return data as Record<string, unknown>;
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
    const str = (value: unknown): string => (typeof value === 'string' ? value : value !== undefined && value !== null ? String(value) : '');

    return {
      tradeStatus: str(notification['trade_status']),
      paymentOrderId: str(notification['payment_order_id'] ?? notification['prepay_id']),
      merchantOrderId: str(notification['merch_order_id']),
      amount: str(notification['total_amount'] ?? notification['amount']),
      currency: typeof notification['trans_currency'] === 'string' ? (notification['trans_currency'] as string) : 'ETB',
      timestamp: str(notification['trans_end_time']),
      notifyTime: str(notification['notify_time']),
    };
  }
}
