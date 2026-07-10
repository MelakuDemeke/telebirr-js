const SUCCESS_STATUSES = new Set(['PAY_SUCCESS', 'SUCCESS', 'PAID']);
const FAILURE_STATUSES = new Set(['PAY_FAILED', 'FAILED']);
const CANCELLED_STATUSES = new Set(['PAY_CANCEL', 'CANCEL', 'CANCELLED']);

/**
 * Utility methods for interpreting `trade_status` values from Telebirr
 * return URLs and notifications.
 */
export class PaymentStatus {
  static isSuccess(tradeStatus: string): boolean {
    return SUCCESS_STATUSES.has(tradeStatus.trim().toUpperCase());
  }

  static isFailure(tradeStatus: string): boolean {
    return FAILURE_STATUSES.has(tradeStatus.trim().toUpperCase());
  }

  static isCancelled(tradeStatus: string): boolean {
    return CANCELLED_STATUSES.has(tradeStatus.trim().toUpperCase());
  }
}
