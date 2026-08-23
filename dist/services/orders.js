import { ORDERS_URL } from "../config.js";
import { dismissCookieConsent, connectBrowser } from "../browser/connect.js";
function normaliseOrders(raw) {
    return raw.map((o) => ({
        id: String(o.order_id ?? o.id ?? o.orderNumber ?? "?"),
        status: String(o.status ?? o.order_status ?? ""),
        delivery_date: (o.delivery_date ?? o.slot?.start_date ?? o.deliveryDate),
        delivery_slot: (o.delivery_slot ?? o.slot_info),
        total: Number(o.total_price ?? o.order_total ?? NaN),
        amendable: Boolean(o.amendable ?? o.can_amend ?? false),
        raw: o,
    }));
}
/** Previous & upcoming orders via API. Throws if all known endpoints come back empty/blocked. */
export async function getOrders(client) {
    const { orders, via } = await client.getOrders();
    return { orders: normaliseOrders(orders), via };
}
export async function getLatestOrder(client) {
    const { orders } = await getOrders(client);
    const latest = orders[0];
    if (!latest)
        throw new Error("No orders found on this account");
    return latest;
}
/**
 * DOM fallback for order history (requires a logged-in browser context).
 * Useful when Sainsbury's changes/withholds the order endpoints.
 */
export async function scrapeOrdersViaBrowser(opts) {
    const bs = await connectBrowser(opts);
    try {
        const page = await bs.context.newPage();
        await page.goto(ORDERS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await dismissCookieConsent(page).catch(() => { });
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => { });
        const rows = await page.evaluate(() => {
            const out = [];
            document
                .querySelectorAll('[data-testid*="order"], [class*="order-card"], [class*="OrderCard"]')
                .forEach((el, i) => {
                out.push({ id: el.getAttribute("data-order-id") ?? `dom-${i}`, text: el.innerText });
            });
            return out;
        });
        return rows.map((r) => {
            const text = String(r.text ?? "").replace(/\s+/g, " ").trim();
            const date = /\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/.exec(text)?.[0];
            const total = /£\s?(\d+(?:\.\d{1,2})?)/.exec(text);
            const idMatch = /\b(\d{9,12})\b/.exec(text);
            return {
                id: r.id.startsWith("dom-") ? idMatch?.[1] ?? r.id : r.id,
                delivery_date: date,
                total: total ? parseFloat(total[1]) : undefined,
                amendable: /amend/i.test(text),
                raw: text,
            };
        });
    }
    finally {
        await bs.close();
    }
}
