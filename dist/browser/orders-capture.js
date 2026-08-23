import { ORDERS_URL } from "../config.js";
import { dismissCookieConsent, connectBrowser } from "./connect.js";
import { importSessionToContext } from "./context.js";
/**
 * Order-history access needs a Bearer JWT + rotating wcauthtoken that only the
 * logged-in SPA holds; the pair is session-bound (replaying it from another
 * process/TLS stack 401s). So we keep ONE browser page open on the orders
 * screen and execute every API call as an in-page fetch carrying the SPA's
 * own headers. List + detail both verified against production.
 */
export class OrdersBrowserClient {
    page;
    headers;
    constructor(page, headers) {
        this.page = page;
        this.headers = headers;
    }
    static async open(session, opts) {
        const bs = await connectBrowser(opts);
        try {
            await importSessionToContext(bs.context, session);
            const page = await bs.context.newPage();
            let pair = null;
            let firstOrders = null;
            page.on("request", (req) => {
                if (pair || !/\/order\/v1\/order\?/.test(req.url()))
                    return;
                const h = req.headers();
                if (h["authorization"] && h["wcauthtoken"]) {
                    pair = { authorization: h["authorization"], wcauthtoken: h["wcauthtoken"] };
                }
            });
            page.on("response", async (res) => {
                if (firstOrders || !/\/order\/v1\/order\?/.test(res.url()))
                    return;
                try {
                    const j = JSON.parse(await res.text());
                    if (Array.isArray(j.orders))
                        firstOrders = j.orders;
                }
                catch { }
            });
            await page.goto(ORDERS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await dismissCookieConsent(page).catch(() => { });
            await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => { });
            const deadline = Date.now() + (opts.timeoutMs ?? 45_000);
            while ((!pair || !firstOrders) && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 1000));
            }
            if (!pair)
                throw new Error("could not observe order auth headers on the orders page");
            const client = new OrdersBrowserClient(page, pair);
            client.firstPage = firstOrders ?? undefined;
            // keep the browser alive for the lifetime of the client
            client.closeFn = async () => {
                await bs.close().catch(() => { });
            };
            return client;
        }
        catch (err) {
            await bs.close().catch(() => { });
            throw err;
        }
    }
    firstPage;
    closeFn;
    /** First page of orders captured during page load (free — no extra request). */
    takeFirstPage() {
        const f = this.firstPage;
        this.firstPage = undefined;
        return f;
    }
    async call(path) {
        const headers = this.headers;
        return this.page.evaluate(async ({ path, headers }) => {
            const r = await fetch(`https://www.sainsburys.co.uk${path}`, {
                credentials: "include",
                headers,
            });
            return { status: r.status, text: await r.text() };
        }, { path, headers });
    }
    async list(pageNumber = 1, pageSize = 10) {
        if (pageNumber === 1) {
            const free = this.takeFirstPage();
            if (free)
                return free;
        }
        const res = await this.call(`/groceries-api/gol-services/order/v1/order?page_size=${pageSize}&page_number=${pageNumber}`);
        if (res.status >= 400)
            throw new Error(`orders list HTTP ${res.status}`);
        return (JSON.parse(res.text).orders ?? []);
    }
    async detail(uid) {
        const res = await this.call(`/groceries-api/gol-services/order/v1/order/${uid}`);
        if (res.status >= 400)
            throw Object.assign(new Error(`detail HTTP ${res.status}`), { status: res.status });
        return JSON.parse(res.text);
    }
    async close() {
        await this.closeFn?.();
    }
}
