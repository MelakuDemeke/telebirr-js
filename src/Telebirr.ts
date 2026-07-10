import { CheckoutResult } from './CheckoutResult.js';
import type { Config } from './Config.js';
import { ApiError } from './errors/ApiError.js';
import { InvalidParameterError } from './errors/InvalidParameterError.js';
import { HttpClientError } from './http/HttpClientError.js';
import type { HttpClient } from './http/HttpClient.js';
import { UndiciHttpClient } from './http/UndiciHttpClient.js';
import type { Logger } from './logger/Logger.js';
import { NullLogger } from './logger/Logger.js';
import { ParameterValidator } from './ParameterValidator.js';
import { Signer, type SignableRequest } from './Signer.js';

/** Loosely-typed Telebirr API response — the shape varies per endpoint. */
export type TelebirrApiResponse = Record<string, unknown> & {
  code?: string;
  biz_content?: Record<string, unknown>;
};

const SENSITIVE_KEYS = new Set(['sign', 'msisdn', 'phone', 'phone_no', 'phonenumber', 'payer_name', 'customer_name', 'buyer', 'openid', 'open_id', 'id_no', 'email']);

/**
 * Telebirr Web Checkout client (modern H5 C2B API).
 *
 * @see https://developer.ethiotelecom.et/docs/H5%20C2B%20Web%20Payment%20Integration%20Quick%20Guide/requestCreateOrder
 */
export class Telebirr {
  private readonly config: Config;
  private readonly signer: Signer;
  private logger: Logger;
  private readonly httpClient: HttpClient;

  /**
   * @param config Library configuration.
   * @param logger Any logger matching {@link Logger} (console, pino, winston, ...). Defaults to a no-op.
   * @param httpClient Injectable HTTP client. Defaults to {@link UndiciHttpClient}, which verifies
   *        TLS and applies timeouts using the config's transport settings.
   */
  constructor(config: Config, logger?: Logger | null, httpClient?: HttpClient | null) {
    this.config = config;
    this.signer = new Signer(config);
    this.logger = logger ?? new NullLogger();
    this.httpClient =
      httpClient ??
      new UndiciHttpClient({
        verifySsl: config.verifySsl,
        caBundlePath: config.caBundlePath,
        timeout: config.timeout,
        connectTimeout: config.connectTimeout,
      });
  }

  /** Set the logger used for API request/response logging. */
  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  /**
   * Step 1: Apply fabric token.
   *
   * - Endpoint: `POST /payment/v1/token`
   * - Headers: `Content-Type: application/json`, `X-APP-Key: {fabricAppId}`
   * - Body: `{ "appSecret": "{appSecret}" }`
   * - Response: `{ "token": "Bearer xxx", "effectiveDate": "...", "expirationDate": "..." }`
   *
   * @throws ApiError on API errors or invalid responses.
   */
  async applyFabricToken(): Promise<TelebirrApiResponse & { token: string }> {
    const url = `${this.config.baseUrl}/payment/v1/token`;

    const result = await this.sendApiRequest('applyFabricToken', url, { appSecret: this.config.appSecret }, null, false);

    if (!result['token']) {
      throw new ApiError(`Token missing in API response. Response: ${JSON.stringify(result)}`, {
        httpStatus: 200,
        responseBody: JSON.stringify(result),
      });
    }

    return result as TelebirrApiResponse & { token: string };
  }

  /**
   * Step 2: Request create order (preOrder) — Telebirr H5 C2B `requestCreateOrder`.
   *
   * @see https://developer.ethiotelecom.et/docs/H5%20C2B%20Web%20Payment%20Integration%20Quick%20Guide/requestCreateOrder
   *
   * @param fabricToken "Bearer xxx" from {@link applyFabricToken}.
   * @param title Order title (auto-sanitized to Telebirr's allowed charset).
   * @param amount Total amount (ETB) — formatted to 2 decimals.
   * @param merchOrderId Optional merchant order id; must be alphanumeric (`^[A-Za-z0-9]+$`).
   *        If omitted, one is generated. Invalid ids throw — they are NOT silently rewritten
   *        (Telebirr would otherwise strip characters and break lookups).
   * @throws ApiError on API errors, invalid responses, or a missing `prepay_id`.
   * @throws InvalidParameterError on parameter validation failures.
   */
  async createOrder(fabricToken: string, title: string, amount: string | number, merchOrderId?: string | null): Promise<TelebirrApiResponse> {
    const validated = this.validateOrderParams('createOrder', title, amount, merchOrderId);

    const reqObject = this.buildPreOrderRequest(validated.title, validated.amount, validated.merchOrderId, 'Checkout');
    const url = `${this.config.baseUrl}/payment/v1/merchant/preOrder`;

    const result = await this.sendApiRequest('createOrder', url, reqObject, fabricToken);

    const bizContent = result['biz_content'];
    if (!bizContent || typeof bizContent !== 'object' || !(bizContent as Record<string, unknown>)['prepay_id']) {
      throw new ApiError(`prepay_id missing in create order response. Response: ${JSON.stringify(result)}`, {
        httpStatus: 200,
        responseBody: JSON.stringify(result),
      });
    }

    return result;
  }

  /**
   * Request create order for the In-App SDK flow — `trade_type: "InApp"`.
   *
   * Used when a mobile app's Telebirr SDK initiates the payment. Unlike the
   * web checkout flow, there is no checkout URL: the response's
   * `receiveCode` must be passed to the mobile SDK to continue the payment.
   *
   * @throws ApiError on API errors, invalid responses, or a missing `receiveCode`.
   * @throws InvalidParameterError on parameter validation failures.
   */
  async createInAppOrder(fabricToken: string, title: string, amount: string | number, merchOrderId?: string | null): Promise<TelebirrApiResponse> {
    const validated = this.validateOrderParams('createInAppOrder', title, amount, merchOrderId);

    const reqObject = this.buildPreOrderRequest(validated.title, validated.amount, validated.merchOrderId, 'InApp');
    const url = `${this.config.baseUrl}/payment/v1/inapp/createOrder`;

    const result = await this.sendApiRequest('createInAppOrder', url, reqObject, fabricToken);

    const bizContent = result['biz_content'];
    if (!bizContent || typeof bizContent !== 'object' || !(bizContent as Record<string, unknown>)['receiveCode']) {
      throw new ApiError(`receiveCode missing in in-app order response. Response: ${JSON.stringify(result)}`, {
        httpStatus: 200,
        responseBody: JSON.stringify(result),
      });
    }

    return result;
  }

  /**
   * Step 3: Generate the checkout URL from a `prepay_id` — Telebirr H5 C2B `Generate_Check_Url`.
   *
   * @see https://developer.ethiotelecom.et/docs/H5%20C2B%20Web%20Payment%20Integration%20Quick%20Guide/Generate_Check_Url
   *
   * @param prepayId The `prepay_id` obtained from {@link createOrder}'s response (`biz_content.prepay_id`).
   * @returns The complete checkout URL, ready for a browser redirect.
   */
  buildCheckoutUrl(prepayId: string): string {
    const map: Record<string, string> = {
      appid: this.config.merchantAppId,
      merch_code: this.config.merchantCode,
      nonce_str: Signer.createNonceStr(),
      prepay_id: prepayId,
      timestamp: Signer.createTimeStamp(),
    };

    const sign = this.signer.signRequestObject(map);

    const parts = [
      `appid=${map['appid']}`,
      `merch_code=${map['merch_code']}`,
      `nonce_str=${map['nonce_str']}`,
      `prepay_id=${map['prepay_id']}`,
      `timestamp=${map['timestamp']}`,
      `sign=${sign}`,
      'sign_type=SHA256WithRSA',
    ];

    return `${this.config.webBaseUrl}${parts.join('&')}&version=1.0&trade_type=Checkout`;
  }

  /**
   * Query order status — Telebirr H5 C2B `queryOrder`.
   *
   * Use this for a server-to-server confirmation of a payment's real status,
   * instead of trusting the (spoofable) parameters on a browser return URL.
   *
   * @see https://developer.ethiotelecom.et/docs/H5%20C2B%20Web%20Payment%20Integration%20Quick%20Guide/queryOrder
   *
   * @param fabricToken "Bearer xxx" from {@link applyFabricToken}.
   * @param prepayId Optional: `prepay_id` from {@link createOrder}'s response.
   * @param merchOrderId Optional: merchant order id (at least one of the two must be provided).
   * @throws InvalidParameterError if neither id is provided, or on validation failure.
   */
  async queryOrder(fabricToken: string, prepayId?: string | null, merchOrderId?: string | null): Promise<TelebirrApiResponse> {
    if (!prepayId && !merchOrderId) {
      throw new InvalidParameterError('prepayId|merchOrderId', null, 'Either prepayId or merchOrderId must be provided');
    }

    let validatedMerchOrderId = merchOrderId ?? null;
    if (merchOrderId) {
      try {
        validatedMerchOrderId = ParameterValidator.validateMerchantOrderId(merchOrderId, false);
      } catch (e) {
        this.logValidationFailure('queryOrder', e);
        throw e;
      }
    }

    const req: SignableRequest = {
      timestamp: Signer.createTimeStamp(),
      nonce_str: Signer.createNonceStr(),
      method: 'payment.queryorder',
      version: '1.0',
    };

    const biz: Record<string, unknown> = {
      appid: this.config.merchantAppId,
      merch_code: this.config.merchantCode,
    };
    if (prepayId) biz['prepay_id'] = prepayId;
    if (validatedMerchOrderId) biz['merch_order_id'] = validatedMerchOrderId;
    req['biz_content'] = biz;
    req['sign'] = this.signer.signRequestObject(req);
    req['sign_type'] = 'SHA256WithRSA';

    const url = `${this.config.baseUrl}/payment/v1/merchant/queryOrder`;
    return this.sendApiRequest('queryOrder', url, req, fabricToken);
  }

  /**
   * Refund order — Telebirr H5 C2B `RefundOrder`.
   *
   * @see https://developer.ethiotelecom.et/docs/H5%20C2B%20Web%20Payment%20Integration%20Quick%20Guide/RefundOrder
   *
   * @param fabricToken "Bearer xxx" from {@link applyFabricToken}.
   * @param refundAmount Refund amount (ETB) — formatted to 2 decimals.
   * @param paymentOrderId Optional: Telebirr's `payment_order_id`.
   * @param merchOrderId Optional: merchant order id (at least one of the two must be provided).
   * @param refundReason Optional: reason for the refund.
   * @param refundOrderId Optional: `refund_request_no` (auto-generated if omitted).
   * @throws InvalidParameterError if neither id is provided, or on validation failure.
   */
  async refundOrder(
    fabricToken: string,
    refundAmount: string | number,
    paymentOrderId?: string | null,
    merchOrderId?: string | null,
    refundReason?: string | null,
    refundOrderId?: string | null
  ): Promise<TelebirrApiResponse> {
    if (!paymentOrderId && !merchOrderId) {
      throw new InvalidParameterError('paymentOrderId|merchOrderId', null, 'Either paymentOrderId or merchOrderId must be provided');
    }

    let validatedAmount: string;
    let validatedMerchOrderId = merchOrderId ?? null;
    let validatedRefundOrderId = refundOrderId ?? null;
    try {
      validatedAmount = ParameterValidator.validateAmount(refundAmount);
      if (merchOrderId) validatedMerchOrderId = ParameterValidator.validateMerchantOrderId(merchOrderId, false);
      if (refundOrderId) validatedRefundOrderId = ParameterValidator.validateMerchantOrderId(refundOrderId, false);
    } catch (e) {
      this.logValidationFailure('refundOrder', e);
      throw e;
    }

    const reqObject = this.buildRefundOrderRequest(validatedAmount, paymentOrderId ?? null, validatedMerchOrderId, refundReason ?? null, validatedRefundOrderId);
    const url = `${this.config.baseUrl}/payment/v1/merchant/refund`;

    try {
      return await this.sendApiRequest('refundOrder', url, reqObject, fabricToken);
    } catch (e) {
      if (e instanceof ApiError) {
        const hint = this.refundErrorHint(e, url);
        if (hint) {
          throw new ApiError(e.message + hint, {
            httpStatus: e.httpStatus,
            errorCode: e.errorCode,
            responseBody: e.responseBody,
            cause: e,
          });
        }
      }
      throw e;
    }
  }

  /**
   * High-level helper: {@link applyFabricToken} + {@link createOrder} + {@link buildCheckoutUrl}.
   *
   * Returns a {@link CheckoutResult} carrying the checkout URL AND the exact
   * `merch_order_id` that was sent to Telebirr. Persist that id against your
   * order — it is the value Telebirr echoes back in notifications and on the
   * return URL, so storing anything else risks a lookup miss.
   *
   * @see https://developer.ethiotelecom.et/docs/H5%20C2B%20Web%20Payment%20Integration%20Quick%20Guide/%20CheckOut
   *
   * @param title Order title (auto-sanitized).
   * @param amount Total amount (ETB).
   * @param merchOrderId Optional merchant order id (`^[A-Za-z0-9]+$`). Generated if omitted.
   *        Invalid ids throw rather than being silently rewritten.
   */
  async createCheckoutUrl(title: string, amount: string | number, merchOrderId?: string | null): Promise<CheckoutResult> {
    // Resolve the id up-front (generate if empty, throw if invalid) so we can
    // report back the EXACT value Telebirr will use.
    const resolvedMerchOrderId = ParameterValidator.validateMerchantOrderId(merchOrderId ?? null, false);

    const tokenInfo = await this.applyFabricToken();
    const fabricToken = tokenInfo['token'];
    if (!fabricToken) {
      const errorMsg = `Fabric token missing in token response: ${JSON.stringify(tokenInfo)}`;
      this.logger.error(errorMsg);
      throw new ApiError(errorMsg, { httpStatus: 200, responseBody: JSON.stringify(tokenInfo) });
    }

    const order = await this.createOrder(fabricToken, title, amount, resolvedMerchOrderId);
    const prepayId = (order['biz_content'] as Record<string, unknown>)['prepay_id'] as string;
    const checkoutUrl = this.buildCheckoutUrl(prepayId);

    return new CheckoutResult(checkoutUrl, resolvedMerchOrderId, prepayId);
  }

  /** Generate a valid merchant order id (alphanumeric, matches Telebirr's charset). */
  generateMerchantOrderId(): string {
    return ParameterValidator.generateMerchantOrderId();
  }

  /** Sanitize a title by removing characters Telebirr rejects. */
  sanitizeTitle(title: string): string {
    return ParameterValidator.sanitizeTitle(title);
  }

  /** Format an amount to 2 decimal places. @throws InvalidParameterError if the amount is invalid. */
  formatAmount(amount: string | number): string {
    return ParameterValidator.validateAmount(amount);
  }

  /** Check whether a merchant order id matches Telebirr's required format. */
  isValidMerchantOrderId(merchantOrderId: string): boolean {
    return ParameterValidator.isValidMerchantOrderId(merchantOrderId);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private validateOrderParams(
    operation: string,
    title: string,
    amount: string | number,
    merchOrderId: string | null | undefined
  ): { title: string; amount: string; merchOrderId: string } {
    try {
      return {
        title: ParameterValidator.validateTitle(title, true),
        amount: ParameterValidator.validateAmount(amount),
        merchOrderId: ParameterValidator.validateMerchantOrderId(merchOrderId ?? null, false),
      };
    } catch (e) {
      this.logValidationFailure(operation, e);
      throw e;
    }
  }

  private logValidationFailure(operation: string, e: unknown): void {
    if (e instanceof InvalidParameterError) {
      this.logger.error(`Parameter validation failed in ${operation}`, {
        parameter: e.parameterName,
        value: e.parameterValue,
        message: e.message,
      });
    }
  }

  private buildPreOrderRequest(title: string, amount: string, merchOrderId: string, tradeType: 'Checkout' | 'InApp'): SignableRequest {
    const req: SignableRequest = {
      timestamp: Signer.createTimeStamp(),
      nonce_str: Signer.createNonceStr(),
      method: 'payment.preorder',
      version: '1.0',
    };

    const biz: Record<string, unknown> = {
      notify_url: this.config.notifyUrl,
      appid: this.config.merchantAppId,
      merch_code: this.config.merchantCode,
      merch_order_id: merchOrderId,
      trade_type: tradeType,
      title,
      total_amount: amount,
      trans_currency: 'ETB',
      timeout_express: '120m',
    };

    if (tradeType === 'Checkout' && this.config.redirectUrl) {
      biz['redirect_url'] = this.config.redirectUrl;
    }

    req['biz_content'] = biz;
    req['sign'] = this.signer.signRequestObject(req);
    req['sign_type'] = 'SHA256WithRSA';

    return req;
  }

  private buildRefundOrderRequest(
    refundAmount: string,
    paymentOrderId: string | null,
    merchOrderId: string | null,
    refundReason: string | null,
    refundOrderId: string | null
  ): SignableRequest {
    const req: SignableRequest = {
      timestamp: Signer.createTimeStamp(),
      nonce_str: Signer.createNonceStr(),
      method: 'payment.refund',
      version: '1.0',
    };

    const refundRequestNo = refundOrderId ?? ParameterValidator.generateMerchantOrderId();

    const biz: Record<string, unknown> = {
      appid: this.config.merchantAppId,
      merch_code: this.config.merchantCode,
      refund_amount: refundAmount,
      refund_request_no: refundRequestNo,
    };

    if (paymentOrderId) biz['payment_order_id'] = paymentOrderId;
    if (merchOrderId) biz['merch_order_id'] = merchOrderId;
    if (refundReason) biz['refund_reason'] = refundReason;
    if (refundOrderId) biz['refund_order_id'] = refundOrderId;

    req['biz_content'] = biz;
    req['sign'] = this.signer.signRequestObject(req);
    req['sign_type'] = 'SHA256WithRSA';

    return req;
  }

  /**
   * Shared request pipeline: signing is already applied to `reqObject` by the
   * caller's builder. Handles transport, HTTP status, JSON decoding, and
   * API-level error detection.
   */
  private async sendApiRequest(
    operation: string,
    url: string,
    reqObject: Record<string, unknown>,
    fabricToken?: string | null,
    checkApiCode = true
  ): Promise<TelebirrApiResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-APP-Key': this.config.fabricAppId,
    };
    if (fabricToken) {
      headers['Authorization'] = fabricToken;
    }

    this.logRequest(operation, url, reqObject);

    let response;
    try {
      response = await this.httpClient.post(url, headers, JSON.stringify(reqObject));
    } catch (e) {
      const errorMsg = `Failed to call ${operation} API: ${e instanceof Error ? e.message : String(e)}`;
      this.logger.error(errorMsg);
      throw new ApiError(errorMsg, { cause: e instanceof HttpClientError ? e : undefined });
    }

    const httpCode = response.statusCode;
    const responseBody = response.body;

    this.logResponse(operation, httpCode, responseBody);

    if (httpCode < 200 || httpCode >= 300) {
      const errorMsg = this.formatApiError(operation, httpCode, responseBody);
      this.logger.error(errorMsg, { http_code: httpCode });
      throw new ApiError(errorMsg, { httpStatus: httpCode, responseBody });
    }

    let result: unknown;
    try {
      result = JSON.parse(responseBody);
    } catch {
      const errorMsg = `Invalid ${operation} API response (not JSON): ${responseBody}`;
      this.logger.error(errorMsg);
      throw new ApiError(errorMsg, { httpStatus: httpCode, responseBody });
    }

    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      const errorMsg = `Invalid ${operation} API response (not a JSON object): ${responseBody}`;
      this.logger.error(errorMsg);
      throw new ApiError(errorMsg, { httpStatus: httpCode, responseBody });
    }

    const parsed = result as TelebirrApiResponse;

    if (checkApiCode && parsed['code'] !== undefined && parsed['code'] !== '00000' && parsed['code'] !== '0') {
      const errorMsg = this.formatApiErrorResponse(operation, parsed);
      this.logger.error(errorMsg, { error_code: parsed['code'] });
      throw new ApiError(errorMsg, { httpStatus: httpCode, errorCode: String(parsed['code']), responseBody });
    }

    return parsed;
  }

  /** Build actionable guidance for known refund failure modes. Returns '' when none applies. */
  private refundErrorHint(e: ApiError, url: string): string {
    if (e.httpStatus === 404) {
      return (
        '\n\n⚠️ 404 Error - Endpoint Not Found\n' +
        'The refund endpoint might not be available for your account.\n\n' +
        `Current endpoint being called: ${url}\n\n` +
        'Please verify:\n' +
        '1. The official RefundOrder documentation:\n' +
        '   https://developer.ethiotelecom.et/docs/H5%20C2B%20Web%20Payment%20Integration%20Quick%20Guide/RefundOrder\n' +
        '2. That the RefundOrder API is enabled for your account\n' +
        '3. That you are using the correct base URL (dev vs production)\n' +
        '4. Contact Telebirr support if refunds are not available for your account.'
      );
    }

    const errorCode = e.errorCode ?? '';
    if (errorCode === '60320025' || e.message.includes('failed to call the payment platform')) {
      return (
        '\n\n⚠️ This error typically indicates:\n' +
        '1. A development/sandbox environment where refunds are not enabled\n' +
        '2. Your account may not have refund permissions enabled\n' +
        '3. The original payment may not be eligible for refund (not completed, too old, etc.)\n' +
        '4. You may need to use the production environment for refunds'
      );
    }

    return '';
  }

  private logRequest(method: string, url: string, data: Record<string, unknown>): void {
    this.logger.debug('Telebirr API Request', { method, url, data: this.sanitizeLogData(data) });
  }

  private logResponse(method: string, httpCode: number, response: string): void {
    const level = httpCode >= 200 && httpCode < 300 ? 'info' : 'error';
    this.logger[level]('Telebirr API Response', { method, http_code: httpCode, response: this.sanitizeResponseData(response) });
  }

  /** Redact sensitive fields from a request payload before logging. */
  private sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = { ...data };

    if ('appSecret' in sanitized) {
      sanitized['appSecret'] = '[REDACTED]';
    }

    if (sanitized['biz_content'] && typeof sanitized['biz_content'] === 'object') {
      const biz = { ...(sanitized['biz_content'] as Record<string, unknown>) };
      if ('privateKey' in biz) {
        biz['privateKey'] = '[REDACTED]';
      }
      sanitized['biz_content'] = biz;
    }

    if (typeof sanitized['sign'] === 'string') {
      sanitized['sign'] = `${(sanitized['sign'] as string).slice(0, 20)}...`;
    }

    return sanitized;
  }

  /** Redact PII/sensitive fields from a response body before logging. */
  private sanitizeResponseData(response: string): Record<string, unknown> | string {
    let decoded: unknown;
    try {
      decoded = JSON.parse(response);
    } catch {
      return response.length > 500 ? `${response.slice(0, 500)}…[truncated]` : response;
    }

    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      return response.length > 500 ? `${response.slice(0, 500)}…[truncated]` : response;
    }

    return this.redactSensitiveKeys(decoded as Record<string, unknown>);
  }

  private redactSensitiveKeys(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.redactSensitiveKeys(value as Record<string, unknown>);
      } else if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private formatApiError(operation: string, httpCode: number, responseBody: string): string {
    let message = `${operation} API returned HTTP ${httpCode}`;

    let errorData: unknown;
    try {
      errorData = JSON.parse(responseBody);
    } catch {
      errorData = null;
    }

    if (errorData && typeof errorData === 'object' && !Array.isArray(errorData)) {
      const data = errorData as Record<string, unknown>;
      const errorCode = data['errorCode'] ?? data['code'];
      const errorMsg = data['errorMsg'] ?? data['message'] ?? data['msg'];
      const errorSolution = data['errorSolution'];

      if (errorCode) message += `\nError Code: ${errorCode}`;
      if (errorMsg) message += `\nError Message: ${errorMsg}`;
      if (errorSolution) message += `\nSolution: ${errorSolution}`;

      if (errorCode === '49401024995') {
        message +=
          '\n\nThis error indicates a parameter validation issue.' +
          '\nCommon causes:' +
          '\n- Invalid merchant order ID format (must be alphanumeric only)' +
          '\n- Invalid title characters (special characters not allowed)' +
          '\n- Parameter type mismatch';
      }
    } else {
      message += `: ${responseBody}`;
    }

    return message;
  }

  private formatApiErrorResponse(operation: string, result: TelebirrApiResponse): string {
    const errorCode = result['code'] ?? result['errorCode'] ?? 'Unknown';
    const errorMsg = result['message'] ?? result['msg'] ?? result['errorMsg'] ?? 'Unknown error';
    const errorSolution = result['errorSolution'];

    let message = `${operation} API error (code: ${errorCode}): ${errorMsg}`;

    if (errorSolution) {
      message += `\nSolution: ${errorSolution}`;
    }

    if (errorCode === '49401024995') {
      message +=
        '\n\nThis error indicates a parameter validation issue.' +
        '\nCommon causes:' +
        '\n- Invalid merchant order ID format (must be alphanumeric only, no underscores)' +
        '\n- Invalid title characters (special characters like #, !, $, etc. not allowed)' +
        '\n- Parameter type mismatch' +
        '\n\nTip: Use ParameterValidator.validateTitle() and ParameterValidator.validateMerchantOrderId() to validate parameters before calling the API.';
    } else if (errorCode === '60320025') {
      message +=
        '\n\nThis error typically indicates:' +
        '\n- Payment platform unavailable' +
        '\n- Account permissions issue' +
        '\n- Environment mismatch (test vs production)';
    }

    return message;
  }
}
