import { ORDERS_URL } from "../config.ts";
import { GroceriesClient } from "../api/client.ts";
import { dismissCookieConsent, connectBrowser } from "../browser/connect.ts";
import type { ConnectOptions } from "../browser/connect.ts";
import type { OrderSummary } from "../types.ts";

function normaliseOrders(raw: Record<string, unknown>[]): OrderSummary[] {
  return raw.map((o) => ({
    id: String(o.order_id ?? o.id ?? o.orderNumber ?? "?"),
    status: String(o.status ?? o.order_status ?? ""),
    delivery_date: (o.delivery_date ?? (o.slot as Record<string, unknown>)?.start_date ?? o.deliveryDate) as
      | string
      | undefined,
    delivery_slot: (o.delivery_slot ?? o.slot_info) as string | undefined,
    total: Number(o.total_price ?? o.order_total ?? NaN),
    amendable: Boolean(o.amendable ?? o.can_amend ?? false),
    raw: o,
  }));
}

/** Previous & upcoming orders via API. Throws if all known endpoints come back empty/blocked. */
export async function getOrders(
  client: GroceriesClient,
): Promise<{ orders: OrderSummary[]; via: string }> {
  const { orders, via } = await client.getOrders();
  return { orders: normaliseOrders(orders), via };
}

export async function getLatestOrder(client: GroceriesClient): Promise<OrderSummary> {
  const { orders } = await getOrders(client);
  const latest = orders[0];
  if (!latest) throw new Error("No orders found on this account");
  return latest;
}

/**
 * DOM fallback for order history (requires a logged-in browser context).
 * Useful when Sainsbury's changes/withholds the order endpoints.
 */
export async function scrapeOrdersViaBrowser(opts: ConnectOptions): Promise<OrderSummary[]> {
  const bs = await connectBrowser(opts);
  try {
    const page = await bs.context.newPage();
    await page.goto(ORDERS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismissCookieConsent(page).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

    const rows = await page.evaluate(() => {
      const out: { id: string; text: string }[] = [];
      document
        .querySelectorAll<HTMLElement>('[data-testid*="order"], [class*="order-card"], [class*="OrderCard"]')
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
        total: total ? parseFloat(total[1]!) : undefined,
        amendable: /amend/i.test(text),
        raw: text,
      } satisfies OrderSummary;
    });
  } finally {
    await bs.close();
  }
}
