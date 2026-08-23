import fs from "node:fs";
import path from "node:path";
import { LOGIN_URL } from "../config.js";
import { dismissCookieConsent, connectBrowser } from "./connect.js";
import { saveSession } from "../session/store.js";
const AUTH_COOKIE_PREFIX = "WC_AUTHENTICATION_";
function sessionFromCookies(cookies) {
    return {
        cookies: cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            expires: c.expires,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite ?? undefined,
        })),
        wcauthtoken: cookies.find((c) => c.name.startsWith(AUTH_COOKIE_PREFIX))?.value ?? "",
        lastLogin: new Date().toISOString(),
        source: "browser-login",
    };
}
async function waitUntilAuthed(context, deadline) {
    while (Date.now() < deadline) {
        const cookies = await context.cookies(["https://www.sainsburys.co.uk"]);
        if (cookies.some((c) => c.name.startsWith(AUTH_COOKIE_PREFIX)))
            return true;
        await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
}
/**
 * Interactive login. Opens the Sainsbury's login page in a browser (local or remote
 * via `--ws` CDP endpoint) and waits until the user completes login (+ any SMS MFA).
 * Resolves once WC_AUTHENTICATION_* cookies appear, then persists the session.
 */
export async function interactiveLogin(opts) {
    const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
    const bs = await connectBrowser({
        ws: opts.ws,
        headed: opts.headed,
        verbose: opts.verbose,
        executablePath: opts.executablePath,
    });
    try {
        const page = await bs.context.newPage();
        await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await dismissCookieConsent(page).catch(() => { });
        console.error(`Waiting for you to log in${opts.ws ? ` in the remote browser (${opts.ws})` : ""}... (complete any SMS/email MFA)`);
        const authed = await waitUntilAuthed(bs.context, Date.now() + timeoutMs);
        if (!authed)
            throw new Error("Timed out waiting for login (no WC_AUTHENTICATION cookie seen)");
        const cookies = await bs.context.cookies(["https://www.sainsburys.co.uk"]);
        const sessionPath = saveSession(sessionFromCookies(cookies), opts.sessionPath);
        return { session: sessionFromCookies(cookies), sessionPath };
    }
    finally {
        await bs.close();
    }
}
function promptMfa() {
    return new Promise((resolve) => {
        process.stdout.write("Enter the MFA code sent to you: ");
        let buf = "";
        const onData = (d) => {
            buf += d.toString();
            if (buf.includes("\n")) {
                process.stdin.removeListener("data", onData);
                resolve(buf.trim());
            }
        };
        process.stdin.on("data", onData);
    });
}
/**
 * Credential-driven headless login: fills the real login form inside a
 * headless/remote browser. Credentials come from env (SAINSBURYS_USERNAME /
 * SAINSBURYS_PASSWORD) — never argv. If Sainsbury's challenges with an MFA
 * step, `mfaCode` is used when provided; otherwise we prompt on stdin.
 */
export async function credentialLogin(opts) {
    const timeoutMs = opts.timeoutMs ?? 3 * 60_000;
    const bs = await connectBrowser({
        ws: opts.ws,
        headed: opts.headed,
        verbose: opts.verbose,
        executablePath: opts.executablePath,
    });
    try {
        const page = await bs.context.newPage();
        await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await dismissCookieConsent(page).catch(() => { });
        const userField = page.locator('input[data-testid="username"], input[name="username"]').first();
        const passField = page.locator('input[data-testid="password"], input[name="password"]').first();
        await userField.waitFor({ state: "visible", timeout: 30_000 });
        await userField.fill(opts.username);
        await passField.fill(opts.password);
        await page.locator('button[data-testid="log-in"], button[type="submit"]').first().click();
        // Give the challenge (if any) time to render, then handle MFA.
        await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => { });
        const mfaField = page
            .locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], [data-testid*="otp" i], [data-testid*="code" i]')
            .first();
        if (await mfaField.isVisible({ timeout: 8_000 }).catch(() => false)) {
            const code = opts.mfaCode ?? (await promptMfa());
            await mfaField.fill(code);
            await page
                .locator('button[type="submit"], button[data-testid*="verify" i], button[data-testid*="submit" i]')
                .first()
                .click();
            console.error("MFA code submitted; completing sign-in...");
        }
        const authed = await waitUntilAuthed(bs.context, Date.now() + timeoutMs);
        if (!authed) {
            const shot = `${(opts.sessionPath ?? "~/.sainsburys").replace("~", process.env.HOME)}/login-debug.png`;
            try {
                fs.mkdirSync(path.dirname(shot), { recursive: true });
                await page.screenshot({ path: shot, fullPage: true });
                console.error(`Login did not complete; screenshot saved to ${shot}`);
            }
            catch {
                console.error("Login did not complete.");
            }
            throw new Error("Credential login failed — check credentials, or an unexpected MFA/challenge screen appeared.");
        }
        const cookies = await bs.context.cookies(["https://www.sainsburys.co.uk"]);
        const sessionPath = saveSession(sessionFromCookies(cookies), opts.sessionPath);
        return { session: sessionFromCookies(cookies), sessionPath };
    }
    finally {
        await bs.close();
    }
}
