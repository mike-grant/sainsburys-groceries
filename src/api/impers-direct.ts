// In-process impers transport — only usable under the Node runtime
// (koffi's NAPI bindings crash under Bun). Loaded dynamically.
import { Session } from "impers";
import type { Transport } from "./transport.ts";
import type { Session as GrocerySession } from "../types.ts";

export class ImpersDirectTransport implements Transport {
  private session: Session;
  private grocerySession: GrocerySession | null;

  constructor(grocerySession: GrocerySession | null) {
    this.grocerySession = grocerySession;
    this.session = new Session({ impersonate: "chrome", timeout: 40 });
  }

  private cookieRecord(): Record<string, string> | undefined {
    if (!this.grocerySession?.cookies?.length) return undefined;
    return Object.fromEntries(this.grocerySession.cookies.map((c) => [c.name, c.value]));
  }

  async request(
    method: string,
    url: string,
    opts: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; text: string }> {
    const reqOpts: Record<string, unknown> = {};
    if (opts.headers && Object.keys(opts.headers).length) reqOpts.headers = opts.headers;
    const cookies = this.cookieRecord();
    if (cookies) reqOpts.cookies = cookies;
    if (opts.body !== undefined) reqOpts.content = JSON.stringify(opts.body);

    const res = await this.session.request(method, url, reqOpts);
    return { status: res.status, text: res.text };
  }

  async close(): Promise<void> {
    await this.session.close().catch(() => {});
  }
}
