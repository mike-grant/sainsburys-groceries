import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BASE_URL } from "../config.ts";

type PWContext = import("playwright-core").BrowserContext;
type PWPage = import("playwright-core").Page;
import type { Session } from "../types.ts";
import { dismissCookieConsent } from "./connect.ts";

/** Locate an installed Chromium without requiring `playwright install`. */
export function findChromiumExecutable(): string | undefined {
  if (process.env.SAINSBURYS_CHROMIUM_PATH) return process.env.SAINSBURYS_CHROMIUM_PATH;
  const base = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  try {
    const dirs = fs
      .readdirSync(base)
      .filter((d) => d.startsWith("chromium-") && !d.includes("headless"))
      .sort()
      .reverse();
    for (const d of dirs) {
      for (const sub of ["chrome-mac-arm64", "chrome-mac"]) {
        const p = path.join(
          base,
          d,
          sub,
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        );
        if (fs.existsSync(p)) return p;
      }
    }
    // Linux layout
    for (const d of fs.readdirSync(base).filter((x) => x.startsWith("chromium-")).sort().reverse()) {
      const p = path.join(base, d, "chrome-linux", "chrome");
      if (fs.existsSync(p)) return p;
    }
  } catch {
    // no playwright cache
  }
  return undefined;
}

/** Load saved session cookies into the browser context. */
export async function importSessionToContext(
  context: PWContext,
  session: Session,
): Promise<void> {
  await context.addCookies(
    session.cookies
      .filter((c) => c.name && c.value !== undefined)
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain ?? ".sainsburys.co.uk",
        path: c.path ?? "/",
        expires: c.expires && c.expires > 0 ? c.expires : -1,
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? true,
        sameSite: (c.sameSite ?? "Lax") as "Strict" | "Lax" | "None",
      })),
  );
}

/** Capture cookies out of a (possibly remote) context as a persistable session. */
export async function exportSessionFromContext(context: PWContext): Promise<Session> {
  const cookies = await context.cookies(["https://www.sainsburys.co.uk"]);
  return {
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
    wcauthtoken: cookies.find((c) => c.name.startsWith("WC_AUTHENTICATION_"))?.value ?? "",
    source: "browser-login",
  };
}

/**
 * Open a page on the groceries SPA and let Akamai issue its cookies.
 * All subsequent API calls ride this page's network stack.
 */
export async function openWarmedGroceriesPage(context: PWContext): Promise<PWPage> {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/gol-ui/groceries`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await dismissCookieConsent(page).catch(() => {});
  return page;
}
