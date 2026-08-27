import fs from "node:fs";
import path from "node:path";
import { LOGIN_URL } from "../config.ts";
import { dismissCookieConsent, connectBrowser, type ConnectOptions } from "./connect.ts";
import { saveSession } from "../session/store.ts";
import type { Session } from "../types.ts";

export interface LoginResult {
  session: Session;
  sessionPath: string;
}

const AUTH_COOKIE_PREFIX = "WC_AUTHENTICATION_";
const AUTH_ORIGINS = [
  "https://www.sainsburys.co.uk",
  "https://account.sainsburys.co.uk",
];

function sessionFromCookies(
  cookies: import("playwright-core").Cookie[],
): Session {
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
    wcauthtoken: cookies.find((c) => c.name.startsWith(AUTH_COOKIE_PREFIX))?.value ?? "",
    lastLogin: new Date().toISOString(),
    source: "browser-login",
  };
}

async function waitUntilAuthed(
  context: import("playwright-core").BrowserContext,
  deadline: number,
): Promise<boolean> {
  while (Date.now() < deadline) {
    const cookies = await context.cookies(AUTH_ORIGINS);
    if (cookies.some((c) => c.name.startsWith(AUTH_COOKIE_PREFIX))) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

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

    const authed = await waitUntilAuthed(bs.context, Date.now() + timeoutMs);
    if (!authed)
      throw new Error("Timed out waiting for login (no WC_AUTHENTICATION cookie seen)");

    const cookies = await bs.context.cookies(AUTH_ORIGINS);
    const sessionPath = saveSession(sessionFromCookies(cookies), opts.sessionPath);
    return { session: sessionFromCookies(cookies), sessionPath };
  } finally {
    await bs.close();
  }
}

export interface CredentialLoginOptions extends ConnectOptions {
  username: string;
  password: string;
  /** One-time code for the post-submit MFA step, if the account requires it. */
  mfaCode?: string;
  /** File to poll for an MFA code, useful for non-interactive agents. */
  mfaFile?: string;
  sessionPath?: string;
  timeoutMs?: number;
}

function promptMfa(): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write("Enter the MFA code sent to you: ");
    // once() + pause(): leaving stdin flowing keeps the process alive after
    // login completes — a classic CLI hang.
    process.stdin.once("data", (buf: Buffer) => {
      const code = buf.toString().trim();
      try {
        process.stdin.pause();
        (process.stdin as unknown as { unref?: () => void }).unref?.();
      } catch {
        // non-TTY edge cases
      }
      resolve(code);
    });
  });
}

async function waitForMfaFile(file: string, deadline: number): Promise<string> {
  console.error(`MFA_REQUIRED: waiting for a one-time code in ${file}`);
  while (Date.now() < deadline) {
    try {
      const code = fs.readFileSync(file, "utf8").trim();
      if (code) return code.split(/\s+/)[0]!;
    } catch {
      // The agent/user may create the file after the MFA prompt appears.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for MFA code file ${file}`);
}

async function resolveMfaCode(
  opts: { mfaCode?: string; mfaFile?: string },
  deadline: number,
): Promise<string> {
  if (opts.mfaCode) return opts.mfaCode;
  if (opts.mfaFile) return waitForMfaFile(opts.mfaFile, deadline);
  if (process.stdin.isTTY) return promptMfa();
  throw new Error(
    "MFA is required but stdin is not interactive. Re-run with --mfa <code> or --mfa-file <path>; write the code to that file when prompted.",
  );
}

/**
 * The OneTrust consent SDK re-renders a full-page dark filter between login
 * steps, intercepting all pointer events. Remove it outright rather than
 * hoping the (often invisible) banner buttons are clickable.
 */
async function stripConsentOverlay(page: import("playwright-core").Page): Promise<void> {
  await dismissCookieConsent(page).catch(() => {});
  await page
    .evaluate(() => {
      document.getElementById("onetrust-consent-sdk")?.remove();
      document
        .querySelectorAll(".onetrust-pc-dark-filter, .onetrust-banner-sdk, #onetrust-banner-sdk")
        .forEach((el) => el.remove());
    })
    .catch(() => {});
}

/**
 * Credential-driven headless login: fills the real login form inside a
 * headless/remote browser. Credentials come from env (SAINSBURYS_USERNAME /
 * SAINSBURYS_PASSWORD) — never argv. If Sainsbury's challenges with an MFA
 * step, `mfaCode` is used when provided. Agents can use `mfaFile` to pause
 * until the user writes the received code to a file.
 */
export async function credentialLogin(opts: CredentialLoginOptions): Promise<LoginResult> {
  const timeoutMs = opts.timeoutMs ?? 3 * 60_000;
  const t0 = Date.now();
  const step = (msg: string) =>
    console.error(`[login ${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);

  const bs = await connectBrowser({
    ws: opts.ws,
    headed: opts.headed,
    verbose: opts.verbose,
    executablePath: (opts as { executablePath?: string }).executablePath,
  });

  try {
    step("opening account.sainsburys.co.uk/gol/login ...");
    const page = await bs.context.newPage();
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await stripConsentOverlay(page);
    step(`page loaded: "${await page.title().catch(() => "?")}"`);

    step("filling credentials...");
    const userField = page.locator('input[data-testid="username"], input[name="username"]').first();
    const passField = page.locator('input[data-testid="password"], input[name="password"]').first();
    await userField.waitFor({ state: "visible", timeout: 30_000 });
    await userField.fill(opts.username);
    await passField.fill(opts.password);

    step("submitting...");
    await page.locator('button[data-testid="log-in"], button[type="submit"]').first().click();

    // Give the challenge (if any) time to render, then handle MFA.
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await stripConsentOverlay(page);
    step(`post-submit page: "${await page.title().catch(() => "?")}" (${page.url().slice(0, 80)})`);

    // MFA input can lag the navigation slightly; poll rather than single-check.
    const mfaSelector =
      'input[autocomplete="one-time-code"], input[inputmode="numeric"], [data-testid*="otp" i], [data-testid*="code" i]';
    let mfaSeen = false;
    for (let waited = 0; waited < 20_000; waited += 2000) {
      if (await page.locator(mfaSelector).first().isVisible({ timeout: 1000 }).catch(() => false)) {
        mfaSeen = true;
        break;
      }
      await stripConsentOverlay(page);
      if (await waitUntilAuthed(bs.context, Date.now() + 1))
        break; // signed in without MFA
    }

    if (mfaSeen) {
      step("MFA input detected");
      await stripConsentOverlay(page);
      const code = await resolveMfaCode(opts, Date.now() + timeoutMs);
      await page.locator(mfaSelector).first().fill(code);
      await stripConsentOverlay(page);
      await page
        .locator(
          'button[data-testid="submit-code"], button[type="submit"], button[data-testid*="verify" i]',
        )
        .first()
        .click();
      step("MFA code submitted; completing sign-in...");
      await stripConsentOverlay(page);
    } else if (opts.verbose) {
      step("no MFA input seen; waiting for auth cookies...");
    }

    const authed = await waitUntilAuthed(bs.context, Date.now() + timeoutMs);
    if (!authed) {
      const shot = `${(opts.sessionPath ?? "~/.sainsburys").replace("~", process.env.HOME!)}/login-debug.png`;
      try {
        fs.mkdirSync(path.dirname(shot), { recursive: true });
        await page.screenshot({ path: shot, fullPage: true });
        step(`Login did not complete; screenshot saved to ${shot}`);
      } catch {
        step("Login did not complete.");
      }
      throw new Error(
        "Credential login failed — check credentials, or an unexpected MFA/challenge screen appeared.",
      );
    }
    step("authenticated ✓ capturing session...");

    const cookies = await bs.context.cookies(AUTH_ORIGINS);
    const sessionPath = saveSession(sessionFromCookies(cookies), opts.sessionPath);
    return { session: sessionFromCookies(cookies), sessionPath };
  } finally {
    await bs.close();
  }
}
