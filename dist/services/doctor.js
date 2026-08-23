import { DEFAULT_LIGHTPANDA_WS } from "../config.js";
import { connectBrowser } from "../browser/connect.js";
/**
 * Test whether a CDP browser (LightPanda by default) is accepted by sainsburys.co.uk.
 * Navigates the public search API + homepage and reports blocking signals.
 */
export async function doctorLightpanda(opts) {
    const ws = opts.ws || process.env.SAINSBURYS_LIGHTPANDA_WS || DEFAULT_LIGHTPANDA_WS;
    const checks = [];
    const bs = await connectBrowser({ ws, verbose: opts.verbose });
    try {
        // Server identity via standard CDP discovery endpoint
        let version = "unknown";
        try {
            const httpUrl = ws.replace(/^ws(s?):/, "http$1:") + "/json/version";
            const res = await fetch(httpUrl, { signal: AbortSignal.timeout(5000) });
            const j = (await res.json());
            version = j.Browser ?? JSON.stringify(j).slice(0, 120);
        }
        catch (err) {
            checks.push({
                name: "cdp-version-endpoint",
                ok: false,
                detail: `GET /json/version failed (${err}). Some builds only expose it on /json/version.`,
            });
        }
        if (version !== "unknown") {
            checks.push({ name: "cdp-version-endpoint", ok: true, detail: version });
        }
        const page = await bs.context.newPage();
        // 1) public product API (no auth needed)
        let apiOk = false;
        try {
            const res = await page.request.get("https://www.sainsburys.co.uk/groceries-api/gol-services/product/v1/product?filter[keyword]=milk&page_size=3", { timeout: 20_000 });
            apiOk = res.ok();
            const body = await res.text().catch(() => "");
            const blocked = /access denied|captcha|denied/i.test(body.slice(0, 2000));
            checks.push({
                name: "public-api",
                ok: apiOk && !blocked,
                detail: `HTTP ${res.status()}${blocked ? " (blocked page)" : ""} ua=${res
                    .headersArray()
                    .find((h) => h.name.toLowerCase() === "user-agent")?.value ?? "n/a"}`,
            });
        }
        catch (err) {
            checks.push({ name: "public-api", ok: false, detail: String(err) });
        }
        // 2) homepage render
        try {
            const res = await page.goto("https://www.sainsburys.co.uk/", {
                waitUntil: "domcontentloaded",
                timeout: 45_000,
            });
            const title = await page.title().catch(() => "");
            const status = res?.status() ?? 0;
            const looksBlocked = /access denied|error|robot/i.test(title);
            checks.push({
                name: "homepage",
                ok: !!status && status < 400 && !looksBlocked,
                detail: `HTTP ${status} title="${title.slice(0, 80)}"`,
            });
        }
        catch (err) {
            checks.push({ name: "homepage", ok: false, detail: String(err) });
        }
        // 3) UA seen by the site
        const ua = await page.evaluate(() => navigator.userAgent).catch(() => "n/a");
        checks.push({
            name: "user-agent",
            ok: !/lightpanda/i.test(ua),
            detail: ua,
        });
        const ok = checks.every((c) => c.ok);
        return { target: "lightpanda", ok, checks };
    }
    finally {
        await bs.close();
    }
}
/** Verify the saved session against authenticated endpoints. */
export async function doctorApi(client) {
    const checks = [];
    try {
        client.requireSession();
        checks.push({ name: "session-present", ok: true, detail: client.session.source });
    }
    catch (err) {
        return {
            target: "api",
            ok: false,
            checks: [{ name: "session-present", ok: false, detail: err.message }],
        };
    }
    for (const [name, fn] of [
        ["profile", () => client.getProfile()],
        ["reservation", () => client.getReservation()],
        ["basket", () => client.getBasket()],
        ["orders", () => client.getOrders()],
    ]) {
        try {
            const data = (await fn());
            const size = Array.isArray(data?.orders)
                ? `${data.orders.length} orders`
                : "ok";
            checks.push({ name, ok: true, detail: size });
        }
        catch (err) {
            checks.push({ name, ok: false, detail: String(err).slice(0, 160) });
        }
    }
    return { target: "api", ok: checks.every((c) => c.ok), checks };
}
