import { BASE_URL, DEFAULT_UA } from "../config.ts";
import { buildCookieHeader } from "../session/store.ts";
import type { Session } from "../types.ts";

export interface TransportResponse {
  status: number;
  text: string;
}

export interface Transport {
  /** Perform an HTTP request against sainsburys.co.uk. */
  request(
    method: string,
    url: string,
    opts: { body?: unknown; headers?: Record<string, string> },
  ): Promise<TransportResponse>;
  close(): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public url: string,
    message: string,
    public body?: string,
  ) {
    super(`HTTP ${status} on ${url}: ${message}`);
    this.name = "ApiError";
  }
  get looksBlocked(): boolean {
    return /access denied|captcha/i.test(this.body ?? "");
  }
}

export class NoSessionError extends Error {
  constructor() {
    super(
      "No Sainsbury's session. Run `sainsburys login`, or `sainsburys import-cookie-header` / set SAINSBURYS_COOKIE + SAINSBURYS_WCAUTHTOKEN.",
    );
    this.name = "NoSessionError";
  }
}

type PWPage = import("playwright-core").Page;

/**
 * Primary transport: in-page fetch() executed on a page already loaded on
 * sainsburys.co.uk. Uses the browser's full network stack (TLS fingerprint,
 * header order, cookies) which is what Akamai validates — plain Node/Bun
 * fetch is TLS-fingerprint-denied, and APIRequestContext lacks sec-* headers.
 *
 * Works identically against a local headless Chromium or a remote CDP
 * browser (`--ws`, incl. LightPanda).
 */
export class PageTransport implements Transport {
  constructor(private page: PWPage) {}

  async request(
    method: string,
    url: string,
    opts: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<TransportResponse> {
    const result = await this.page.evaluate(
      async ({ url, method, body, headers }) => {
        const res = await fetch(url, {
          method,
          credentials: "include",
          headers: headers as Record<string, string> | undefined,
          body: body === undefined || body === null ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        return { status: res.status, text };
      },
      { url, method, body: opts.body as never, headers: opts.headers as never },
    );
    return { status: result.status, text: result.text };
  }

  async close(): Promise<void> {}
}

/** Fallback direct transport (works only on networks where Akamai tolerates non-browser TLS, e.g. some UK residential setups or via proxy). */
export class FetchTransport implements Transport {
  constructor(private session: Session | null) {}

  async request(
    method: string,
    url: string,
    opts: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<TransportResponse> {
    const headers: Record<string, string> = {
      "user-agent": DEFAULT_UA,
      accept: "application/json, text/plain, */*",
      "accept-language": "en-GB,en;q=0.9",
      origin: BASE_URL,
      referer: `${BASE_URL}/gol-ui/`,
      ...(opts.headers ?? {}),
    };
    const cookies = this.session ? buildCookieHeader(this.session.cookies) : "";
    if (cookies && !("cookie" in headers)) headers.cookie = cookies;

    const res = await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(20_000),
    });
    return { status: res.status, text: await res.text() };
  }

  async close(): Promise<void> {}
}
