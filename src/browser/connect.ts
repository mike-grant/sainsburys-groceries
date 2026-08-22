import { DEFAULT_UA } from "../config.ts";

export interface ConnectOptions {
  /** CDP WebSocket endpoint. Works with a remote Playwright/CDP server or LightPanda (`ws://127.0.0.1:9222`). */
  ws?: string;
  headed?: boolean;
  verbose?: boolean;
  /** Explicit chromium executable (local launches only). */
  executablePath?: string;
}

export interface ConnectOptions {
  /** CDP WebSocket endpoint. Works with a remote Playwright/CDP server or LightPanda (`ws://127.0.0.1:9222`). */
  ws?: string;
  headed?: boolean;
  verbose?: boolean;
}

/**
 * Connect to a Chromium-compatible browser.
 *
 * - `ws` set  -> chromium.connectOverCDP(endpoint). This covers remote Playwright
 *   servers and Lightpanda (which exposes a CDP server on :9222).
 * - otherwise -> local headless chromium via playwright-core.
 *
 * NOTE (Bun): Playwright's connectOverCDP has had WebSocket instability under Bun
 * (lightpanda-io/browser#2019). If connecting fails here under Bun, retry under Node:
 *   `node --experimental-strip-types node_modules/.bin/../src/index.ts ...`
 */
export interface BrowserSession {
  browser: import("playwright-core").Browser;
  context: import("playwright-core").BrowserContext;
  close(): Promise<void>;
}

/**
 * Connect to a Chromium-compatible browser.
 *
 * - `ws` set  -> chromium.connectOverCDP(endpoint). This covers remote Playwright
 *   servers and Lightpanda (which exposes a CDP server on :9222).
 * - otherwise -> local headless chromium via playwright-core.
 *
 * The UA override is essential: Akamai denies default `HeadlessChrome` UAs.
 *
 * NOTE (Bun): Playwright's connectOverCDP has had WebSocket instability under Bun
 * (lightpanda-io/browser#2019). If connecting fails here under Bun, retry under Node.
 */
export async function connectBrowser(opts: ConnectOptions): Promise<BrowserSession> {
  const { chromium } = await import("playwright-core");

  if (opts.ws) {
    if (opts.verbose) console.error(`[browser] connectOverCDP -> ${opts.ws}`);
    let browser;
    try {
      browser = await chromium.connectOverCDP(opts.ws, { timeout: 15_000 });
    } catch (err) {
      const hint =
        typeof Bun !== "undefined"
          ? " (known Bun+Playwright CDP issue; try running under Node, or check the endpoint is up)"
          : " (check the CDP endpoint is reachable)";
      throw new Error(`Failed to connect to CDP endpoint ${opts.ws}${hint}: ${err}`);
    }
    // Reuse the default context if the server provides one (LightPanda does).
    const context =
      browser.contexts()[0] ?? (await browser.newContext({ userAgent: DEFAULT_UA }));
    return {
      browser,
      context,
      close: async () => {
        await browser.close().catch(() => {});
      },
    };
  }

  if (opts.verbose) console.error("[browser] launching local chromium");
  const executablePath = opts.executablePath ?? (process.env.SAINSBURYS_CHROMIUM_PATH || undefined);
  const browser = await chromium.launch({
    headless: !opts.headed,
    ...(executablePath ? { executablePath } : {}),
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({ userAgent: DEFAULT_UA });
  return {
    browser,
    context,
    close: async () => {
      await browser.close().catch(() => {});
    },
  };
}

export async function dismissCookieConsent(page: import("playwright-core").Page): Promise<void> {
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("Accept all cookies")',
    "#onetrust-accept-btn-handler",
    'button[data-testid="cookie-consent-accept"]',
  ];
  for (const sel of candidates) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        return;
      }
    } catch {
      // keep trying other selectors
    }
  }
}
