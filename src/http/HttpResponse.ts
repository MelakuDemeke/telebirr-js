/** A minimal HTTP response value object returned by {@link HttpClient.post}. */
export class HttpResponse {
  constructor(
    readonly statusCode: number,
    readonly body: string
  ) {}

  /** True for a 2xx status code. */
  isSuccessful(): boolean {
    return this.statusCode >= 200 && this.statusCode < 300;
  }
}
