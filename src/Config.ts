import { ConfigurationError } from './errors/ConfigurationError.js';
import { KeyNormalizer } from './KeyNormalizer.js';
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
    // Ethio Telecom issues keys as bare base64 DER; accept that (or PEM,
    // including PEM with literal `\n` from env files) and normalize to PEM.
    this.privateKey = options.privateKey ? KeyNormalizer.normalizePrivateKey(options.privateKey) : options.privateKey;

    if (!options.notifyUrl) {
      throw new TypeError(
        'notifyUrl is required. This is where Telebirr will send payment status updates. (Pass it in options, or set TELEBIRR_NOTIFY_URL when using Config.fromEnvironment.)'
      );
    }
    this.notifyUrl = options.notifyUrl;

    this.redirectUrl = options.redirectUrl ?? null;
    this.telebirrPublicKey = options.telebirrPublicKey ? KeyNormalizer.normalizePublicKey(options.telebirrPublicKey) : null;

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
   * Create a config from environment variables, with any explicit option
   * overriding its env var. Enables zero-argument setup:
   *
   * - `TELEBIRR_ENVIRONMENT` (then `APP_ENV`/`NODE_ENV`, default `'test'`)
   * - `TELEBIRR_FABRIC_APP_ID`, `TELEBIRR_APP_SECRET`
   * - `TELEBIRR_MERCHANT_APP_ID`, `TELEBIRR_MERCHANT_CODE`
   * - `TELEBIRR_PRIVATE_KEY` (PEM or bare base64 — both accepted)
   * - `TELEBIRR_NOTIFY_URL`, `TELEBIRR_REDIRECT_URL`, `TELEBIRR_PUBLIC_KEY`
   */
  static fromEnvironment(options: Partial<ConfigOptions> = {}): Config {
    const env = process.env;
    const environment = options.environment ?? env.TELEBIRR_ENVIRONMENT ?? env.APP_ENV ?? env.NODE_ENV ?? 'test';
    return new Config({
      ...options,
      environment,
      fabricAppId: options.fabricAppId ?? env.TELEBIRR_FABRIC_APP_ID ?? '',
      appSecret: options.appSecret ?? env.TELEBIRR_APP_SECRET ?? '',
      merchantAppId: options.merchantAppId ?? env.TELEBIRR_MERCHANT_APP_ID ?? '',
      merchantCode: options.merchantCode ?? env.TELEBIRR_MERCHANT_CODE ?? '',
      privateKey: options.privateKey ?? env.TELEBIRR_PRIVATE_KEY ?? '',
      notifyUrl: options.notifyUrl ?? env.TELEBIRR_NOTIFY_URL ?? '',
      redirectUrl: options.redirectUrl ?? env.TELEBIRR_REDIRECT_URL ?? null,
      telebirrPublicKey: options.telebirrPublicKey ?? env.TELEBIRR_PUBLIC_KEY ?? null,
    });
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
      const hasPkcs8 = this.privateKey.includes('-----BEGIN PRIVATE KEY-----') && this.privateKey.includes('-----END PRIVATE KEY-----');
      const hasPkcs1 = this.privateKey.includes('-----BEGIN RSA PRIVATE KEY-----') && this.privateKey.includes('-----END RSA PRIVATE KEY-----');
      if (!hasPkcs8 && !hasPkcs1) {
        errors.push(
          "privateKey must be in PEM format ('-----BEGIN PRIVATE KEY-----' or '-----BEGIN RSA PRIVATE KEY-----') " +
            'or bare base64 DER as issued by Ethio Telecom (which is normalized automatically)'
        );
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
