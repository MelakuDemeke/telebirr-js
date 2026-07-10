/** Minimal shape of a Node `http.ServerResponse` (and, by extension, Express's `res`). */
export interface NodeStyleResponse {
  writeHead(statusCode: number, headers: Record<string, string>): unknown;
  end(chunk: string): unknown;
}

/**
 * An acknowledgement to return to Telebirr from your notification endpoint.
 *
 * This is a framework-agnostic value object. Use whichever accessor matches
 * your stack:
 * - {@link toWebResponse} — a standard `Response` (Next.js route handlers,
 *   Remix, Bun, Deno, Cloudflare Workers, ...).
 * - {@link send} — writes directly to a Node `http.ServerResponse`
 *   (works for Express's `res` too, since it extends `http.ServerResponse`).
 * - {@link statusCode} / {@link body} / {@link headers} — build your own
 *   response in any other framework.
 */
export class NotificationResponse {
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    readonly statusCode: number,
    readonly body: string,
    headers: Record<string, string> = {}
  ) {
    this.headers = { 'Content-Type': 'application/json', ...headers };
  }

  /** Build a standard Web `Response` — for Next.js/Remix/Bun/Deno/Cloudflare Workers route handlers. */
  toWebResponse(): Response {
    return new Response(this.body, { status: this.statusCode, headers: this.headers });
  }

  /** Write this response directly to a Node `http.ServerResponse` (or Express `res`). */
  send(res: NodeStyleResponse): void {
    res.writeHead(this.statusCode, { ...this.headers });
    res.end(this.body);
  }
}
