import { ConfigurationError } from './errors/ConfigurationError.js';
import { ParameterValidator } from './ParameterValidator.js';

export type TelebirrEnvironment = 'test' | 'production';

const BASE_URL_TEST = 'https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway';
const BASE_URL_PRODUCTION = 'https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway';
const WEB_BASE_URL_TEST = 'https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?';
const WEB_BASE_URL_PRODUCTION = 'https://superapp.ethiomobilemoney.et:38443/payment/web/paygate?';

const TEST_ALIASES = new Set(['test', 'development', 'dev', 'sandbox']);
const PRODUCTION_ALIASES = new Set(['production', 'prod', 'live']);

export interface ConfigOptions {
  /** 'test' | 'production' (and aliases: development/dev/sandbox, prod/live). Overrides manual baseUrl/webBaseUrl. */
  environment?: string;
  /** Manual override — normally left unset in favor of `environment` or `Config.forTest/forProduction`. */
  baseUrl?: string;
  /** Manual override — normally left unset in favor of `environment` or `Config.forTest/forProduction`. */
  webBaseUrl?: string;
  fabricAppId: string;
  appSecret: string;
  merchantAppId: string;
  merchantCode: string;
  privateKey: string;
  /** Server-to-server notification URL. Required — Telebirr sends payment status updates here. */
  notifyUrl: string;
  /** Optional: where Telebirr redirects the user's browser after payment. */
  redirectUrl?: string | null;
  /** Optional: Telebirr's public key (PEM), used to verify signatures on return URLs/notifications. */
  telebirrPublicKey?: string | null;
  /** Verify the gateway's TLS certificate. Default true — only disable knowingly, never against production. */
  verifySsl?: boolean;
  /** Path to a custom CA bundle (PEM), if not using the system trust store. */
  caBundlePath?: string | null;
  /** Total request timeout in seconds. Default 30. */
  timeout?: number;
  /** Connection timeout in seconds. Default 10. */
  connectTimeout?: number;
}

/**
 * Telebirr client configuration.
 *
 * Prefer the named constructors — {@link Config.forTest}, {@link Config.forProduction},
 * or {@link Config.fromEnvironment} — over calling `new Config()` directly, so
 * the base/web URLs are always set consistently for the chosen environment.
 */
export class Config {
  readonly baseUrl: string;
  readonly webBaseUrl: string;
  readonly fabricAppId: string;
  readonly appSecret: string;
  readonly merchantAppId: string;
  readonly merchantCode: string;
  readonly privateKey: string;
  readonly notifyUrl: string;
  readonly redirectUrl: string | null;
  readonly telebirrPublicKey: string | null;

  readonly verifySsl: boolean;
  readonly caBundlePath: string | null;
  readonly timeout: number;
  readonly connectTimeout: number;

  constructor(options: ConfigOptions) {
    if (options.environment) {
      const urls = Config.resolveEnvironmentUrls(options.environment);
      this.baseUrl = urls.baseUrl;
      this.webBaseUrl = urls.webBaseUrl;
    } else {
      this.baseUrl = options.baseUrl ?? BASE_URL_TEST;
      this.webBaseUrl = options.webBaseUrl ?? WEB_BASE_URL_TEST;
    }

    this.fabricAppId = options.fabricAppId;
    this.appSecret = options.appSecret;
    this.merchantAppId = options.merchantAppId;
    this.merchantCode = options.merchantCode;
    this.privateKey = options.privateKey;

    if (!options.notifyUrl) {
      throw new TypeError('notifyUrl is required. This is where Telebirr will send payment status updates.');
    }
    this.notifyUrl = options.notifyUrl;

    this.redirectUrl = options.redirectUrl ?? null;
    this.telebirrPublicKey = options.telebirrPublicKey ?? null;

    this.verifySsl = options.verifySsl ?? true;
    this.caBundlePath = options.caBundlePath ?? null;
    this.timeout = options.timeout ?? 30;
    this.connectTimeout = options.connectTimeout ?? 10;
  }

  private static resolveEnvironmentUrls(environment: string): { baseUrl: string; webBaseUrl: string } {
    const env = environment.toLowerCase();

    if (TEST_ALIASES.has(env)) {
      return { baseUrl: BASE_URL_TEST, webBaseUrl: WEB_BASE_URL_TEST };
    }
    if (PRODUCTION_ALIASES.has(env)) {
      return { baseUrl: BASE_URL_PRODUCTION, webBaseUrl: WEB_BASE_URL_PRODUCTION };
    }

    throw new TypeError(`Invalid environment '${environment}'. Must be 'test' or 'production'.`);
  }

  /** Create a config pointed at Telebirr's test/development gateway. */
  static forTest(options: Omit<ConfigOptions, 'environment'>): Config {
    return new Config({ ...options, environment: 'test' });
  }

  /** Create a config pointed at Telebirr's production gateway. */
  static forProduction(options: Omit<ConfigOptions, 'environment'>): Config {
    return new Config({ ...options, environment: 'production' });
  }

  /**
   * Create a config with the environment auto-detected from
   * `TELEBIRR_ENVIRONMENT`, then `NODE_ENV`/`APP_ENV`, defaulting to `'test'`.
   */
  static fromEnvironment(options: Omit<ConfigOptions, 'environment'> & { environment?: string }): Config {
    const environment = options.environment ?? process.env.TELEBIRR_ENVIRONMENT ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? 'test';
    return new Config({ ...options, environment });
  }

  /** `'test'`, `'production'`, or `'unknown'` if the base URL doesn't match either known gateway. */
  getEnvironment(): TelebirrEnvironment | 'unknown' {
    if (this.baseUrl.includes('developerportal')) {
      return 'test';
    }
    if (this.baseUrl.includes('telebirrappcube') || this.baseUrl.includes('superapp')) {
      return 'production';
    }
    return 'unknown';
  }

  isTest(): boolean {
    return this.getEnvironment() === 'test';
  }

  isProduction(): boolean {
    return this.getEnvironment() === 'production';
  }

  /**
   * Validate configuration completeness and correctness.
   *
   * @throws ConfigurationError if `throwOnError` is true (default) and validation fails.
   */
  validate(throwOnError = true): boolean {
    const errors: string[] = [];

    if (!this.fabricAppId) errors.push('fabricAppId is required');
    if (!this.appSecret) errors.push('appSecret is required');
    if (!this.merchantAppId) errors.push('merchantAppId is required');
    if (!this.merchantCode) errors.push('merchantCode is required');
    if (!this.privateKey) errors.push('privateKey is required');
    if (!this.notifyUrl) errors.push('notifyUrl is required');

    if (this.privateKey) {
      if (!this.privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        errors.push("privateKey must be in PEM format (should start with '-----BEGIN PRIVATE KEY-----')");
      }
      if (!this.privateKey.includes('-----END PRIVATE KEY-----')) {
        errors.push("privateKey must be in PEM format (should end with '-----END PRIVATE KEY-----')");
      }
    }

    if (this.notifyUrl) {
      try {
        ParameterValidator.validateUrl(this.notifyUrl, 'notifyUrl');
      } catch (e) {
        errors.push(`notifyUrl validation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (this.redirectUrl) {
      try {
        ParameterValidator.validateUrl(this.redirectUrl, 'redirectUrl');
      } catch (e) {
        errors.push(`redirectUrl validation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (this.merchantCode && !/^\d{6}$/.test(this.merchantCode)) {
      errors.push(`merchantCode should be 6 digits (got: '${this.merchantCode}')`);
    }

    if (errors.length > 0) {
      if (throwOnError) {
        throw new ConfigurationError(errors);
      }
      return false;
    }

    return true;
  }

  /** Whether all required fields are present (does not check format). */
  isComplete(): boolean {
    return Boolean(
      this.fabricAppId && this.appSecret && this.merchantAppId && this.merchantCode && this.privateKey && this.notifyUrl
    );
  }

  /** List the required fields that are missing. */
  getMissingFields(): string[] {
    const missing: string[] = [];
    if (!this.fabricAppId) missing.push('fabricAppId');
    if (!this.appSecret) missing.push('appSecret');
    if (!this.merchantAppId) missing.push('merchantAppId');
    if (!this.merchantCode) missing.push('merchantCode');
    if (!this.privateKey) missing.push('privateKey');
    if (!this.notifyUrl) missing.push('notifyUrl');
    return missing;
  }

  /** @throws TypeError if the base URL doesn't match a known environment. */
  validateEnvironment(): TelebirrEnvironment {
    const env = this.getEnvironment();
    if (env === 'unknown') {
      throw new TypeError(
        `Unable to determine environment from baseUrl: '${this.baseUrl}'. Use Config.forTest() or Config.forProduction() to set environment explicitly.`
      );
    }
    return env;
  }
}
