import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Transport } from "./transport.ts";
import type { Session } from "../types.ts";

export interface TransportResponse {
  status: number;
  text: string;
}

interface PendingRequest {
  resolve: (r: TransportResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * TLS-impersonated HTTP transport (Chrome JA3 + HTTP/2 fingerprint) via a
 * persistent Node sidecar running `impers` (curl-impersonate bindings).
 *
 * Akamai denies Bun/Node's native TLS fingerprints, so this is the default
 * no-browser transport. koffi crashes under Bun itself, hence the sidecar.
 */
export class ImpersTransport implements Transport {
  private proc: import("bun").Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private stdoutBuf = "";
  private ready: Promise<void> | null = null;
  private stderrTail: string[] = [];

  constructor(
    private session: Session | null,
    private nodeBin = process.env.IMPERS_NODE_BIN ?? "node",
  ) {}

  static async nodeAvailable(nodeBin?: string): Promise<boolean> {
    try {
      const p = Bun.spawn([nodeBin ?? process.env.IMPERS_NODE_BIN ?? "node", "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await p.exited;
      return p.exitCode === 0;
    } catch {
      return false;
    }
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const sidecarPath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "sidecar",
        "impers-sidecar.mjs",
      );
      let proc: import("bun").Subprocess<"pipe", "pipe", "pipe">;
      try {
        proc = Bun.spawn([this.nodeBin, sidecarPath], {
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });
      } catch (err) {
        reject(new Error(`Could not spawn Node for impers sidecar (${this.nodeBin}): ${err}`));
        return;
      }
      this.proc = proc;

      // surface first line as readiness signal
      const reader = proc.stdout.getReader();
      const pump = async () => {
        const dec = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            this.stdoutBuf += dec.decode(value, { stream: true });
            let idx: number;
            while ((idx = this.stdoutBuf.indexOf("\n")) >= 0) {
              const line = this.stdoutBuf.slice(0, idx).trim();
              this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
              if (!line) continue;
              let msg: any;
              try {
                msg = JSON.parse(line);
              } catch {
                continue;
              }
              if (msg.ready) {
                resolve();
                continue;
              }
              const p = this.pending.get(msg.id);
              if (!p) continue;
              clearTimeout(p.timer);
              this.pending.delete(msg.id);
              if (msg.error) p.reject(new Error(`impers: ${msg.error}`));
              else p.resolve({ status: msg.status, text: msg.text });
            }
          }
        } catch {
          // stream ended
        }
        // process died before/while serving
        const code = proc.exitCode;
        const err = new Error(
          `impers sidecar exited (code ${code}). stderr tail: ${this.stderrTail.join("").slice(-400)}`,
        );
        if (!this.ready || (await this.ready.then(() => false, () => true))) {
          reject(err);
        }
        for (const [, p] of this.pending) p.reject(err);
        this.pending.clear();
      };
      void pump();

      (async () => {
        const dec = new TextDecoder();
        for await (const chunk of proc.stderr) this.stderrTail.push(dec.decode(chunk));
      })();
    });
    return this.ready;
  }

  private cookieRecord(): Record<string, string> | undefined {
    if (!this.session?.cookies?.length) return undefined;
    return Object.fromEntries(this.session.cookies.map((c) => [c.name, c.value]));
  }

  async request(
    method: string,
    url: string,
    opts: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<TransportResponse> {
    await this.start();
    const proc = this.proc!;
    const id = this.nextId++;
    const msg = {
      id,
      method,
      url,
      headers: opts.headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cookies: this.cookieRecord(),
    };
    return new Promise<TransportResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`impers request timed out after 45s: ${method} ${url}`));
      }, 45_000);
      this.pending.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify(msg) + "\n");
    });
  }

  async close(): Promise<void> {
    try {
      this.proc?.stdin.end();
      this.proc?.kill();
    } catch {
      // already gone
    }
    this.proc = null;
  }
}
