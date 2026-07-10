import { TelebirrError } from '../errors/TelebirrError.js';

/**
 * Thrown when the transport itself fails (connection error, timeout, DNS, TLS
 * handshake) before any HTTP response is received.
 */
export class HttpClientError extends TelebirrError {}
