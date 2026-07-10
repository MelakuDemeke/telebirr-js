import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Config } from '../src/Config.js';
import { ConfigurationError } from '../src/errors/ConfigurationError.js';

const validPrivateKey = '-----BEGIN PRIVATE KEY-----\nMIIB...\n-----END PRIVATE KEY-----';

function baseOptions() {
  return {
    fabricAppId: 'fabric-app-id',
    appSecret: 'secret',
    merchantAppId: 'merchant-app-id',
    merchantCode: '123456',
    privateKey: validPrivateKey,
    notifyUrl: 'https://example.com/notify',
  };
}

describe('Config.forTest / forProduction', () => {
  it('selects the test gateway URLs', () => {
    const config = Config.forTest(baseOptions());
    expect(config.baseUrl).toContain('developerportal');
    expect(config.isTest()).toBe(true);
    expect(config.isProduction()).toBe(false);
  });

  it('selects the production gateway URLs', () => {
    const config = Config.forProduction(baseOptions());
    expect(config.baseUrl).toContain('superapp');
    expect(config.isProduction()).toBe(true);
  });
});

describe('Config.fromEnvironment', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['TELEBIRR_ENVIRONMENT'];
    delete process.env['APP_ENV'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to test when nothing is set', () => {
    delete process.env['NODE_ENV'];
    const config = Config.fromEnvironment(baseOptions());
    expect(config.isTest()).toBe(true);
  });

  it('reads TELEBIRR_ENVIRONMENT', () => {
    process.env['TELEBIRR_ENVIRONMENT'] = 'production';
    const config = Config.fromEnvironment(baseOptions());
    expect(config.isProduction()).toBe(true);
  });
});

describe('Config.validate', () => {
  it('passes for a complete, well-formed config', () => {
    const config = Config.forTest(baseOptions());
    expect(config.validate()).toBe(true);
    expect(config.isComplete()).toBe(true);
    expect(config.getMissingFields()).toEqual([]);
  });

  it('throws ConfigurationError when required fields are missing', () => {
    // @ts-expect-error intentionally omit required fields for the test
    const config = new Config({ notifyUrl: 'https://example.com/notify' });
    expect(() => config.validate()).toThrow(ConfigurationError);
  });

  it('returns false instead of throwing when throwOnError is false', () => {
    // @ts-expect-error intentionally omit required fields for the test
    const config = new Config({ notifyUrl: 'https://example.com/notify' });
    expect(config.validate(false)).toBe(false);
  });

  it('flags a merchantCode that is not 6 digits', () => {
    const config = Config.forTest({ ...baseOptions(), merchantCode: '12' });
    expect(() => config.validate()).toThrow(ConfigurationError);
  });
});

describe('Config constructor', () => {
  it('throws when notifyUrl is missing', () => {
    expect(() => new Config({ ...baseOptions(), notifyUrl: '' })).toThrow(TypeError);
  });
});
