import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/errors/ApiError.js';
import type { HttpClient } from '../src/http/HttpClient.js';
import { HttpClientError } from '../src/http/HttpClientError.js';
import { HttpResponse } from '../src/http/HttpResponse.js';
import { Config } from '../src/Config.js';
import { Telebirr } from '../src/Telebirr.js';

let privateKey: string;

beforeAll(() => {
  privateKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey;
});

class FakeHttpClient implements HttpClient {
  public calls: { url: string; headers: Record<string, string>; body: string }[] = [];

  constructor(private readonly responses: (HttpResponse | HttpClientError)[]) {}

  async post(url: string, headers: Record<string, string>, body: string): Promise<HttpResponse> {
    this.calls.push({ url, headers, body });
    const response = this.responses.shift();
    if (!response) {
      throw new Error('FakeHttpClient: no more canned responses');
    }
    if (response instanceof HttpClientError) {
      throw response;
    }
    return response;
  }
}

function makeConfig(overrides: Partial<Parameters<typeof Config.forTest>[0]> = {}) {
  return Config.forTest({
    fabricAppId: 'fabric-app-id',
    appSecret: 'secret',
    merchantAppId: 'merchant-app-id',
    merchantCode: '123456',
    privateKey,
    notifyUrl: 'https://example.com/notify',
    ...overrides,
  });
}

const SOUTHBOUND_ERROR = JSON.stringify({
  errorCode: '49401024991',
  errorMsg: 'When the engine tries to call a southbound business service, it finds that the service is unavailable.',
  errorSolution: 'Wait and retry.',
});

function tokenResponse(expiresInMs = 3600_000): HttpResponse {
  return new HttpResponse(200, JSON.stringify({ token: 'Bearer abc', expirationDate: String(Date.now() + expiresInMs) }));
}

describe('ApiError structured Telebirr fields', () => {
  it('parses the error envelope onto telebirrCode/Message/Solution and fills errorCode', async () => {
    const http = new FakeHttpClient([new HttpResponse(500, SOUTHBOUND_ERROR)]);
    const client = new Telebirr(makeConfig(), null, http);

    const error = await client.applyFabricToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.telebirrCode).toBe('49401024991');
    expect(apiError.telebirrMessage).toContain('southbound');
    expect(apiError.telebirrSolution).toBe('Wait and retry.');
    expect(apiError.errorCode).toBe('49401024991');
    expect(apiError.isTransient()).toBe(true);
  });

  it('does not treat success codes as an error envelope', () => {
    const error = new ApiError('x', { responseBody: JSON.stringify({ code: '00000', biz_content: {} }) });
    expect(error.telebirrCode).toBeNull();
    expect(error.isTransient()).toBe(false);
  });

  it('marks 503s and transport timeouts as transient', () => {
    expect(new ApiError('x', { httpStatus: 503 }).isTransient()).toBe(true);
    const timeout = new HttpClientError('timed out', { code: 'UND_ERR_CONNECT_TIMEOUT' });
    expect(new ApiError('x', { cause: timeout }).isTransient()).toBe(true);
    expect(new ApiError('x', { httpStatus: 400 }).isTransient()).toBe(false);
  });
});

describe('opt-in retry on transient errors', () => {
  it('retries a transient gateway error and succeeds', async () => {
    const http = new FakeHttpClient([new HttpResponse(500, SOUTHBOUND_ERROR), tokenResponse()]);
    const client = new Telebirr(makeConfig(), null, http, { retry: { retries: 2, delayMs: 1 } });

    const result = await client.applyFabricToken();
    expect(result.token).toBe('Bearer abc');
    expect(http.calls).toHaveLength(2);
  });

  it('does not retry when retry is not configured', async () => {
    const http = new FakeHttpClient([new HttpResponse(500, SOUTHBOUND_ERROR)]);
    const client = new Telebirr(makeConfig(), null, http);

    await expect(client.applyFabricToken()).rejects.toThrow(ApiError);
    expect(http.calls).toHaveLength(1);
  });

  it('does not retry non-transient errors', async () => {
    const http = new FakeHttpClient([new HttpResponse(400, JSON.stringify({ errorCode: '49401024995', errorMsg: 'bad param' }))]);
    const client = new Telebirr(makeConfig(), null, http, { retry: { retries: 3, delayMs: 1 } });

    await expect(client.applyFabricToken()).rejects.toThrow(ApiError);
    expect(http.calls).toHaveLength(1);
  });

  it('gives up after the configured number of retries', async () => {
    const http = new FakeHttpClient([
      new HttpResponse(500, SOUTHBOUND_ERROR),
      new HttpResponse(500, SOUTHBOUND_ERROR),
      new HttpResponse(500, SOUTHBOUND_ERROR),
    ]);
    const client = new Telebirr(makeConfig(), null, http, { retry: { retries: 2, delayMs: 1 } });

    await expect(client.applyFabricToken()).rejects.toThrow(ApiError);
    expect(http.calls).toHaveLength(3);
  });
});

describe('fabric token caching', () => {
  const queryResponse = () =>
    new HttpResponse(
      200,
      JSON.stringify({
        code: '00000',
        biz_content: {
          trade_status: 'PAY_SUCCESS',
          total_amount: '100.00',
          trans_currency: 'ETB',
          payment_order_id: 'TB123',
          merch_order_id: 'ORDER123',
          trans_end_time: '1700000000000',
        },
      })
    );

  it('reuses the cached token across high-level calls', async () => {
    const http = new FakeHttpClient([tokenResponse(), queryResponse(), queryResponse()]);
    const client = new Telebirr(makeConfig(), null, http);

    await client.getOrderStatus('ORDER123');
    await client.getOrderStatus('ORDER123');

    // 1 token call + 2 query calls
    expect(http.calls).toHaveLength(3);
    expect(http.calls[0]!.url).toContain('/payment/v1/token');
    expect(http.calls[1]!.url).toContain('/queryOrder');
    expect(http.calls[2]!.url).toContain('/queryOrder');
  });

  it('fetches a fresh token once the cached one expires', async () => {
    // Expires 30s from now — inside the 60s safety margin, so treated as stale.
    const http = new FakeHttpClient([tokenResponse(30_000), queryResponse(), tokenResponse(), queryResponse()]);
    const client = new Telebirr(makeConfig(), null, http);

    await client.getOrderStatus('ORDER123');
    await client.getOrderStatus('ORDER123');
    expect(http.calls).toHaveLength(4);
  });

  it('does not cache when cacheFabricToken is false', async () => {
    const http = new FakeHttpClient([tokenResponse(), queryResponse(), tokenResponse(), queryResponse()]);
    const client = new Telebirr(makeConfig(), null, http, { cacheFabricToken: false });

    await client.getOrderStatus('ORDER123');
    await client.getOrderStatus('ORDER123');
    expect(http.calls).toHaveLength(4);
  });
});

describe('Telebirr.getOrderStatus', () => {
  it('returns a typed, normalized status', async () => {
    const http = new FakeHttpClient([
      tokenResponse(),
      new HttpResponse(
        200,
        JSON.stringify({
          code: '00000',
          biz_content: {
            trade_status: 'PAY_SUCCESS',
            total_amount: '250.00',
            trans_currency: 'ETB',
            payment_order_id: 'TB999',
            merch_order_id: 'ORDER123',
            trans_end_time: '1700000000000',
          },
        })
      ),
    ]);
    const client = new Telebirr(makeConfig(), null, http);

    const status = await client.getOrderStatus('ORDER123');
    expect(status.paid).toBe(true);
    expect(status.failed).toBe(false);
    expect(status.cancelled).toBe(false);
    expect(status.tradeStatus).toBe('PAY_SUCCESS');
    expect(status.amount).toBe('250.00');
    expect(status.currency).toBe('ETB');
    expect(status.paymentOrderId).toBe('TB999');
    expect(status.merchOrderId).toBe('ORDER123');
    expect(status.raw.code).toBe('00000');
  });

  it('handles camelCase field variants defensively', async () => {
    const http = new FakeHttpClient([
      tokenResponse(),
      new HttpResponse(200, JSON.stringify({ code: '00000', biz_content: { tradeStatus: 'PAY_FAILED', totalAmount: '10.00' } })),
    ]);
    const client = new Telebirr(makeConfig(), null, http);

    const status = await client.getOrderStatus('ORDER123');
    expect(status.paid).toBe(false);
    expect(status.failed).toBe(true);
    expect(status.amount).toBe('10.00');
    expect(status.merchOrderId).toBe('ORDER123'); // falls back to the requested id
  });

  it('fails closed when trade_status is absent', async () => {
    const http = new FakeHttpClient([tokenResponse(), new HttpResponse(200, JSON.stringify({ code: '00000', biz_content: {} }))]);
    const client = new Telebirr(makeConfig(), null, http);

    const status = await client.getOrderStatus('ORDER123');
    expect(status.paid).toBe(false);
  });
});

describe('Telebirr.ping', () => {
  it('reports ok with latency when the gateway responds', async () => {
    const http = new FakeHttpClient([tokenResponse()]);
    const client = new Telebirr(makeConfig(), null, http);

    const result = await client.ping();
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports the failure instead of throwing', async () => {
    const http = new FakeHttpClient([new HttpResponse(500, SOUTHBOUND_ERROR)]);
    const client = new Telebirr(makeConfig(), null, http);

    const result = await client.ping();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('49401024991');
  });
});

describe('construction warnings', () => {
  it('warns when notifyUrl is localhost', () => {
    const warn = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
    new Telebirr(makeConfig({ notifyUrl: 'http://localhost:3000/api/telebirr/notify' }), logger, new FakeHttpClient([]));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot reach it'));
  });

  it('warns when verifySsl is disabled against the test gateway', () => {
    const warn = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
    new Telebirr(makeConfig({ verifySsl: false }), logger, new FakeHttpClient([]));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('TLS verification is disabled'));
  });

  it('escalates to error when verifySsl is disabled against production', () => {
    const error = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error };
    const config = Config.forProduction({
      fabricAppId: 'a',
      appSecret: 'b',
      merchantAppId: 'c',
      merchantCode: '123456',
      privateKey,
      notifyUrl: 'https://example.com/notify',
      verifySsl: false,
    });
    new Telebirr(config, logger, new FakeHttpClient([]));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('PRODUCTION'));
  });

  it('stays silent for a clean config', () => {
    const warn = vi.fn();
    const error = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn, error };
    new Telebirr(makeConfig(), logger, new FakeHttpClient([]));
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('Config.fromEnvironment credential env vars', () => {
  it('reads the documented TELEBIRR_* variables', () => {
    const saved = { ...process.env };
    try {
      process.env['TELEBIRR_ENVIRONMENT'] = 'test';
      process.env['TELEBIRR_FABRIC_APP_ID'] = 'env-fabric';
      process.env['TELEBIRR_APP_SECRET'] = 'env-secret';
      process.env['TELEBIRR_MERCHANT_APP_ID'] = 'env-merchant';
      process.env['TELEBIRR_MERCHANT_CODE'] = '654321';
      process.env['TELEBIRR_PRIVATE_KEY'] = privateKey;
      process.env['TELEBIRR_NOTIFY_URL'] = 'https://example.com/env-notify';

      const config = Config.fromEnvironment();
      expect(config.fabricAppId).toBe('env-fabric');
      expect(config.appSecret).toBe('env-secret');
      expect(config.merchantAppId).toBe('env-merchant');
      expect(config.merchantCode).toBe('654321');
      expect(config.notifyUrl).toBe('https://example.com/env-notify');
      expect(config.validate()).toBe(true);
    } finally {
      process.env = { ...saved };
    }
  });

  it('lets explicit options override env vars', () => {
    const saved = { ...process.env };
    try {
      process.env['TELEBIRR_FABRIC_APP_ID'] = 'env-fabric';
      process.env['TELEBIRR_NOTIFY_URL'] = 'https://example.com/env-notify';
      const config = Config.fromEnvironment({
        fabricAppId: 'explicit',
        appSecret: 's',
        merchantAppId: 'm',
        merchantCode: '123456',
        privateKey,
      });
      expect(config.fabricAppId).toBe('explicit');
      expect(config.notifyUrl).toBe('https://example.com/env-notify');
    } finally {
      process.env = { ...saved };
    }
  });
});
