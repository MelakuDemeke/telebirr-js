import type { Config } from './Config.js';
import { TelebirrError } from './errors/TelebirrError.js';
import { PaymentStatus } from './PaymentStatus.js';
import { SignatureVerifier } from './SignatureVerifier.js';

export interface ReturnUrlPaymentData {
  tradeStatus: string;
  paymentOrderId: string;
  merchantOrderId: string;
  amount: string;
  currency: string;
  isSuccess: boolean;
  timestamp: string;
  /** All original parameters, unmodified. */
  raw: Record<string, unknown>;
}

/**
 * Helper for handling Telebirr return-URL parameters: verifies signatures
 * and extracts payment information.
 */
export class ReturnUrlHandler {
  /**
   * Parse and verify return URL parameters.
   *
   * SECURITY: return URL parameters arrive through the user's browser and
   * are trivially spoofable. This method therefore FAILS CLOSED — a missing
   * or invalid signature throws. Even with a valid signature, treat the
   * result as a hint only: for anything that moves money or fulfils an
   * order, confirm the real status server-to-server with
   * {@link Telebirr.queryOrder} rather than trusting the redirect. The
   * signature proves the params were not tampered with in transit; it does
   * not prove the payment actually succeeded.
   *
   * @param params Query parameters from the return URL.
   * @param config Library config (must have a public key available).
   * @throws TelebirrError if the signature is missing or invalid.
   */
  static handle(params: Record<string, unknown>, config: Config): ReturnUrlPaymentData {
    if (!params['sign']) {
      throw new TelebirrError(
        'Missing signature on return URL - refusing to trust unsigned payment data. Confirm the order server-to-server via Telebirr.queryOrder().'
      );
    }

    if (!SignatureVerifier.verify(params, config)) {
      throw new TelebirrError('Invalid signature - payment data may be tampered with');
    }

    const str = (value: unknown): string => (typeof value === 'string' ? value : value !== undefined && value !== null ? String(value) : '');

    return {
      tradeStatus: str(params['trade_status']),
      paymentOrderId: str(params['payment_order_id']),
      merchantOrderId: str(params['merch_order_id']),
      amount: str(params['total_amount']),
      currency: typeof params['trans_currency'] === 'string' ? (params['trans_currency'] as string) : 'ETB',
      isSuccess: ReturnUrlHandler.isPaymentSuccessful(params),
      timestamp: str(params['trans_end_time']),
      raw: params,
    };
  }

  /**
   * Whether the return URL parameters indicate a successful payment.
   *
   * Fails closed: success is returned ONLY when an explicit success status
   * is present. The absence of an error code is NOT treated as success — a
   * crafted return URL carrying only a `merch_order_id` must never read as
   * paid.
   */
  static isPaymentSuccessful(params: Record<string, unknown>): boolean {
    const tradeStatus = params['trade_status'];
    if (typeof tradeStatus === 'string' && tradeStatus !== '') {
      return PaymentStatus.isSuccess(tradeStatus);
    }

    const status = params['status'];
    if (typeof status === 'string' && status !== '') {
      return PaymentStatus.isSuccess(status);
    }

    return false;
  }
}
