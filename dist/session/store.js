import fs from "node:fs";
import path from "node:path";
import { defaultSessionPath } from "../config.js";
const AUTH_COOKIE_PREFIX = "WC_AUTHENTICATION_";
export function findWcauthtoken(cookies) {
    const auth = cookies.find((c) => c.name.startsWith(AUTH_COOKIE_PREFIX));
    return auth?.value ?? "";
}
export function loadSession(sessionPath = defaultSessionPath()) {
    try {
        const raw = fs.readFileSync(sessionPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed.cookies?.length)
            return null;
        if (!parsed.wcauthtoken)
            parsed.wcauthtoken = findWcauthtoken(parsed.cookies);
        return parsed;
    }
    catch {
        return null;
    }
}
export function saveSession(session, sessionPath = defaultSessionPath()) {
    if (!session.wcauthtoken)
        session.wcauthtoken = findWcauthtoken(session.cookies);
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), { mode: 0o600 });
    return sessionPath;
}
export function deleteSession(sessionPath = defaultSessionPath()) {
    try {
        fs.unlinkSync(sessionPath);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Parse a raw Cookie request header (as copied from devtools)
 * into session cookies scoped to .sainsburys.co.uk.
 */
export function parseCookieHeader(header) {
    const out = [];
    for (const part of header.split(/;\s*/)) {
        const idx = part.indexOf("=");
        if (idx <= 0)
            continue;
        const name = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (!name || !value)
            continue;
        out.push({
            name,
            value,
            domain: ".sainsburys.co.uk",
            path: "/",
            secure: true,
            httpOnly: name.startsWith("WC_") || name === "JSESSIONID",
        });
    }
    return out;
}
export function buildCookieHeader(cookies) {
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}
/** Build a session from env vars (SAINSBURYS_COOKIE / SAINSBURYS_WCAUTHTOKEN). */
export function sessionFromEnv() {
    const cookieHeader = process.env.SAINSBURYS_COOKIE;
    if (!cookieHeader)
        return null;
    const cookies = parseCookieHeader(cookieHeader);
    return {
        cookies,
        wcauthtoken: process.env.SAINSBURYS_WCAUTHTOKEN ?? findWcauthtoken(cookies),
        source: "env",
    };
}
/** Resolve the active session: env vars take precedence over the saved file. */
export function resolveSession(sessionPath) {
    return sessionFromEnv() ?? loadSession(sessionPath);
}
