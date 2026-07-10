import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/errors/ApiError.js';
import { InvalidParameterError } from '../src/errors/InvalidParameterError.js';
import type { HttpClient } from '../src/http/HttpClient.js';
import { HttpResponse } from '../src/http/HttpResponse.js';
import { Config } from '../src/Config.js';
import { Telebirr } from '../src/Telebirr.js';

let privateKey: string;

beforeAll(() => {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = keys.privateKey;
});

class FakeHttpClient implements HttpClient {
  public calls: { url: string; headers: Record<string, string>; body: string }[] = [];

  constructor(private readonly responses: HttpResponse[]) {}

  async post(url: string, headers: Record<string, string>, body: string): Promise<HttpResponse> {
    this.calls.push({ url, headers, body });
    const response = this.responses.shift();
    if (!response) {
      throw new Error('FakeHttpClient: no more canned responses');
    }
    return response;
  }
}

function makeConfig() {
  return Config.forTest({
    fabricAppId: 'fabric-app-id',
    appSecret: 'secret',
    merchantAppId: 'merchant-app-id',
    merchantCode: '123456',
    privateKey,
    notifyUrl: 'https://example.com/notify',
  });
}

describe('Telebirr.applyFabricToken', () => {
  it('returns the token on success', async () => {
    const http = new FakeHttpClient([new HttpResponse(200, JSON.stringify({ token: 'Bearer abc', code: '00000' }))]);
    const client = new Telebirr(makeConfig(), null, http);

    const result = await client.applyFabricToken();
    expect(result.token).toBe('Bearer abc');
    expect(http.calls[0]?.headers['X-APP-Key']).toBe('fabric-app-id');
  });

  it('throws ApiError when the token is missing', async () => {
    const http = new FakeHttpClient([new HttpResponse(200, JSON.stringify({ code: '00000' }))]);
    const client = new Telebirr(makeConfig(), null, http);

    await expect(client.applyFabricToken()).rejects.toThrow(ApiError);
  });

  it('throws ApiError on a non-2xx HTTP status', async () => {
    const http = new FakeHttpClient([new HttpResponse(500, 'Internal Server Error')]);
    const client = new Telebirr(makeConfig(), null, http);

    await expect(client.applyFabricToken()).rejects.toThrow(ApiError);
  });

  it('throws ApiError on a non-success API code', async () => {
    const http = new FakeHttpClient([new HttpResponse(200, JSON.stringify({ code: '40001', message: 'bad request' }))]);
    const client = new Telebirr(makeConfig(), null, http);

    await expect(client.applyFabricToken()).rejects.toThrow(ApiError);
  });
});

describe('Telebirr.createOrder', () => {
  it('sends a signed preOrder request and returns biz_content.prepay_id', async () => {
    const http = new FakeHttpClient([new HttpResponse(200, JSON.stringify({ code: '00000', biz_content: { prepay_id: 'PID123' } }))]);
    const client = new Telebirr(makeConfig(), null, http);

    const result = await client.createOrder('Bearer abc', 'Order #123', '10.00', 'ORDER123');
    expect((result['biz_content'] as Record<string, unknown>)['prepay_id']).toBe('PID123');

    const sentBody = JSON.parse(http.calls[0]!.body);
    expect(sentBody.biz_content.title).toBe('Order 123'); // sanitized
    expect(sentBody.biz_content.merch_order_id).toBe('ORDER123');
    expect(sentBody.biz_content.trade_type).toBe('Checkout');
    expect(sentBody.sign).toBeTypeOf('string');
  });

  it('rejects an invalid merchant order id instead of silently rewriting it', async () => {
    const http = new FakeHttpClient([]);
    const client = new Telebirr(makeConfig(), null, http);

    await expect(client.createOrder('Bearer abc', 'Order', '10.00', 'ORDER-123')).rejects.toThrow(InvalidParameterError);
  });

  it('throws ApiError when prepay_id is missing from the response', async () => {
    const http = new FakeHttpClient([new HttpResponse(200, JSON.stringify({ code: '00000', biz_content: {} }))]);
    const client = new Telebirr(makeConfig(), null, http);

    await expect(client.createOrder('Bearer abc', 'Order', '10.00')).rejects.toThrow(ApiError);
  });
});

describe('Telebirr.createInAppOrder', () => {
  it('uses trade_type InApp and returns receiveCode', async () => {
    const http = new FakeHttpClient([new HttpResponse(200, JSON.stringify({ code: '00000', biz_content: { receiveCode: 'RC1' } }))]);
    const client = new Telebirr(makeConfig(), null, http);

    const result = await client.createInAppOrder('Bearer abc', 'Order', '10.00');
    expect((result['biz_content'] as Record<string, unknown>)['receiveCode']).toBe('RC1');

    const sentBody = JSON.parse(http.calls[0]!.body);
    expect(sentBody.biz_content.trade_type).toBe('InApp');
  });
});

describe('Telebirr.buildCheckoutUrl', () => {
  it('builds a signed checkout URL', () => {
    const client = new Telebirr(makeConfig(), null, new FakeHttpClient([]));
    const url = client.buildCheckoutUrl('PID123');

    expect(url).toContain('prepay_id=PID123');
    expect(url).toContain('sign=');
    expect(url).toContain('version=1.0&trade_type=Checkout');
  });
});

describe('Telebirr.queryOrder', () => {
  it('throws InvalidParameterError when neither id is provided', async () => {
    const client = new Telebirr(makeConfig(), null, new FakeHttpClient([]));
    await expect(client.queryOrder('Bearer abc')).rejects.toThrow(InvalidParameterError);
  });

  it('sends merch_order_id when provided', async () => {
    const http = new FakeHttpClient([new HttpResponse(200, JSON.stringify({ code: '00000', biz_content: { trade_status: 'PAY_SUCCESS' } }))]);
    const client = new Telebirr(makeConfig(), null, http);

    await client.queryOrder('Bearer abc', null, 'ORDER123');
    const sentBody = JSON.parse(http.calls[0]!.body);
    expect(sentBody.biz_content.merch_order_id).toBe('ORDER123');
  });
});

describe('Telebirr.refundOrder', () => {
  it('throws InvalidParameterError when neither id is provided', async () => {
    const client = new Telebirr(makeConfig(), null, new FakeHttpClient([]));
    await expect(client.refundOrder('Bearer abc', '10.00')).rejects.toThrow(InvalidParameterError);
  });

  it('adds a refund hint to 404 ApiErrors', async () => {
    const http = new FakeHttpClient([new HttpResponse(404, 'not found')]);
    const client = new Telebirr(makeConfig(), null, http);

    await expect(client.refundOrder('Bearer abc', '10.00', null, 'ORDER123')).rejects.toThrow(/Endpoint Not Found/);
  });
});

describe('Telebirr.createCheckoutUrl (full flow)', () => {
  it('chains applyFabricToken -> createOrder -> buildCheckoutUrl', async () => {
    const http = new FakeHttpClient([
      new HttpResponse(200, JSON.stringify({ token: 'Bearer abc' })),
      new HttpResponse(200, JSON.stringify({ code: '00000', biz_content: { prepay_id: 'PID123' } })),
    ]);
    const client = new Telebirr(makeConfig(), null, http);

    const result = await client.createCheckoutUrl('Order 123', '100.00', 'ORDER123');

    expect(result.merchOrderId).toBe('ORDER123');
    expect(result.prepayId).toBe('PID123');
    expect(result.checkoutUrl).toContain('prepay_id=PID123');
    expect(result.toJSON()).toEqual({
      checkoutUrl: result.checkoutUrl,
      merchOrderId: 'ORDER123',
      prepayId: 'PID123',
    });
  });
});

describe('Telebirr logging redaction', () => {
  it('redacts appSecret and sign in logged request data', async () => {
    const http = new FakeHttpClient([new HttpResponse(200, JSON.stringify({ token: 'Bearer abc' }))]);
    const debugLog = vi.fn();
    const logger = { debug: debugLog, info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const client = new Telebirr(makeConfig(), logger, http);
    await client.applyFabricToken();

    const loggedData = debugLog.mock.calls[0]?.[1] as { data: Record<string, unknown> };
    expect(loggedData.data['appSecret']).toBe('[REDACTED]');
  });
});
