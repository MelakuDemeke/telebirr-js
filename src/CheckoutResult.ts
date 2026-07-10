/**
 * Result of {@link Telebirr.createCheckoutUrl}.
 *
 * Crucially this exposes the exact `merch_order_id` the library sent to
 * Telebirr — the same value Telebirr echoes back in notifications and return
 * URLs. Persist {@link CheckoutResult.merchOrderId} against your order so the
 * later lookup cannot miss, rather than assuming it equals whatever id you
 * passed in.
 */
export class CheckoutResult {
  constructor(
    /** The URL to redirect the user to for payment. */
    readonly checkoutUrl: string,
    /** The exact merchant order id used — persist this, Telebirr echoes it back verbatim. */
    readonly merchOrderId: string,
    /** Telebirr's prepay id for this order. */
    readonly prepayId: string
  ) {}

  toJSON(): { checkoutUrl: string; merchOrderId: string; prepayId: string } {
    return {
      checkoutUrl: this.checkoutUrl,
      merchOrderId: this.merchOrderId,
      prepayId: this.prepayId,
    };
  }
}
