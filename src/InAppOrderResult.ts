/**
 * Result of {@link Telebirr.createInAppPayment}.
 *
 * Carries the `receiveCode` the mobile Telebirr SDK needs to start the
 * payment, plus the exact `merch_order_id` the library sent to Telebirr — the
 * same value Telebirr echoes back in the notification. Persist
 * {@link InAppOrderResult.merchOrderId} against your order before answering
 * the app.
 */
export class InAppOrderResult {
  constructor(
    /** The code to hand to the mobile SDK, unchanged. */
    readonly receiveCode: string,
    /** The exact merchant order id used — persist this, Telebirr echoes it back verbatim. */
    readonly merchOrderId: string,
    /** Telebirr's prepay id for this order, when the gateway returns one. */
    readonly prepayId: string | null = null
  ) {}

  toJSON(): { receiveCode: string; merchOrderId: string; prepayId: string | null } {
    return {
      receiveCode: this.receiveCode,
      merchOrderId: this.merchOrderId,
      prepayId: this.prepayId,
    };
  }
}
