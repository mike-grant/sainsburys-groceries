import { LOGIN_URL } from "../config.ts";
import { dismissCookieConsent, connectBrowser, type ConnectOptions } from "./connect.ts";
import { saveSession } from "../session/store.ts";
import type { Session } from "../types.ts";

export interface LoginResult {
  session: Session;
  sessionPath: string;
}

const AUTH_COOKIE_PREFIX = "WC_AUTHENTICATION_";

/**
 * Interactive login. Opens the Sainsbury's login page in a browser (local or remote
 * via `--ws` CDP endpoint) and waits until the user completes login (+ any SMS MFA).
 * Resolves once WC_AUTHENTICATION_* cookies appear, then persists the session.
 */
export async function interactiveLogin(
  opts: ConnectOptions & { sessionPath?: string; timeoutMs?: number },
): Promise<LoginResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const bs = await connectBrowser({
    ws: opts.ws,
    headed: opts.headed,
    verbose: opts.verbose,
    executablePath: (opts as { executablePath?: string }).executablePath,
  });

  try {
    const page = await bs.context.newPage();
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismissCookieConsent(page).catch(() => {});

    console.error(
      `Waiting for you to log in${
        opts.ws ? ` in the remote browser (${opts.ws})` : ""
      }... (complete any SMS/email MFA)`,
    );

    const deadline = Date.now() + timeoutMs;
    let cookies: import("playwright-core").Cookie[] = [];
    while (Date.now() < deadline) {
      cookies = await bs.context.cookies(["https://www.sainsburys.co.uk"]);
      if (cookies.some((c) => c.name.startsWith(AUTH_COOKIE_PREFIX))) break;
      await new Promise((r) => setTimeout(r, 1500));
    }

    const authed = cookies.some((c) => c.name.startsWith(AUTH_COOKIE_PREFIX));
    if (!authed) throw new Error("Timed out waiting for login (no WC_AUTHENTICATION cookie seen)");

    const session: Session = {
      cookies: cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: (c.sameSite as Session["cookies"][number]["sameSite"]) ?? undefined,
      })),
      wcauthtoken: cookies.find((c) => c.name.startsWith(AUTH_COOKIE_PREFIX))?.value ?? "",
      lastLogin: new Date().toISOString(),
      source: "browser-login",
    };
    const sessionPath = saveSession(session, opts.sessionPath);
    return { session, sessionPath };
  } finally {
    await bs.close();
  }
}
