import type { Transport } from "./transport.ts";
import { buildCookieHeader } from "../session/store.ts";
import type { Session } from "../types.ts";

/**
 * Default transport: koonjs (Rust/BoringSSL via napi-rs) reproducing Chrome's
 * TLS + HTTP/2 fingerprints. Works identically under Node and Bun — no
 * sidecar, no runtime split.
 */
export class KoonTransport implements Transport {
  private session: Session | null;
  private clientPromise: Promise<any> | null = null;

  constructor(session: Session | null) {
    this.session = session;
  }

  private async getClient(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const mod: any = await import("koonjs");
        const Koon = mod.Koon ?? mod.default?.Koon;
        if (!Koon) throw new Error("koonjs: Koon export not found");
        return new Koon({ browser: "chrome" });
      })();
    }
    return this.clientPromise;
  }

  async request(
    method: string,
    url: string,
    opts: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; text: string }> {
    const client = await this.getClient();
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (this.session?.cookies?.length && !headers.cookie) {
      headers.cookie = buildCookieHeader(this.session.cookies);
    }
    const m = method.toUpperCase();
    const res =
      opts.body !== undefined
        ? await client.request(m, url, JSON.stringify(opts.body), { headers, timeout: 40 })
        : await client.request(m, url, undefined, { headers, timeout: 40 });
    return { status: res.status, text: res.text() };
  }

  async close(): Promise<void> {}
}
