import { ApiError, GroceriesClient } from "../api/client.ts";
import { OrdersBrowserClient } from "../browser/orders-capture.ts";
import type { ConnectOptions } from "../browser/connect.ts";
import type { OrderSummary, Session } from "../types.ts";

export interface OrdersContext {
  session: Session | null;
  browser: ConnectOptions & { sessionPath?: string };
}

export interface OrderItemHit {
  name: string;
  quantity: number;
  uom?: string;
  sub_total?: number;
  uid?: string;
}

export interface OrderItemsResult {
  order: OrderSummary;
  items: OrderItemHit[];
}

function normalise(o: Record<string, unknown>): OrderSummary {
  return {
    id: String(o.order_uid ?? o.id ?? "?"),
    status: String(o.status ?? ""),
    delivery_date: (o.slot_start_time as string) ?? undefined,
    delivery_slot:
      o.slot_start_time && o.slot_end_time
        ? `${String(o.slot_start_time).slice(0, 16).replace("T", " ")} → ${String(o.slot_end_time).slice(11, 16)}`
        : undefined,
    total: Number(o.total ?? NaN),
    amendable: Boolean(o.is_in_amend_mode) || Boolean(o.is_cancellable),
    raw: o,
  };
}

/**
 * Opens a browser client for order calls. Direct API attempts are skipped:
 * the header pair is session-bound, so the browser pass is mandatory.
 */
async function openOrders(client: GroceriesClient, ctx: OrdersContext): Promise<OrdersBrowserClient> {
  if (!ctx.session) throw new Error("orders require an authenticated session — run `sainsburys login`");
  void client; // kept for signature symmetry / future direct-path retries
  return OrdersBrowserClient.open(ctx.session, ctx.browser);
}

/** Previous & upcoming orders. */
export async function getOrders(
  client: GroceriesClient,
  ctx: OrdersContext,
  opts: { pageSize?: number; pageNumber?: number } = {},
): Promise<{ orders: OrderSummary[]; via: string }> {
  const pageSize = opts.pageSize ?? 10;
  const pageNumber = opts.pageNumber ?? 1;
  const ob = await openOrders(client, ctx);
  try {
    const orders = await ob.list(pageNumber, pageSize);
    return { orders: orders.map(normalise), via: "browser" };
  } finally {
    await ob.close();
  }
}

export async function getLatestOrder(client: GroceriesClient, ctx: OrdersContext): Promise<OrderSummary> {
  const { orders } = await getOrders(client, ctx, { pageSize: 1 });
  const latest = orders[0];
  if (!latest) throw new Error("No orders found on this account");
  return latest;
}

/** Full detail for one order: items, payment, address, slot. */
export async function getOrderDetailFull(
  client: GroceriesClient,
  ctx: OrdersContext,
  uid: string,
): Promise<{ summary: OrderSummary; detail: Record<string, unknown> }> {
  const ob = await openOrders(client, ctx);
  try {
    const d = await ob.detail(uid);
    return { summary: normalise(d), detail: d };
  } finally {
    await ob.close();
  }
}

/**
 * Search line items across previous orders ("mushy peas", brand names…).
 * Walks history newest-first in one browser session, fetching each order's
 * detail for its items and matching case-insensitively on product name.
 */
export async function findInOrders(
  client: GroceriesClient,
  ctx: OrdersContext,
  query: string,
  opts: { maxPages?: number } = {},
): Promise<{ matches: OrderItemsResult[]; scanned: number; via: string }> {
  const q = query.toLowerCase().trim();
  const maxPages = opts.maxPages ?? 3;
  let scanned = 0;
  const matches: OrderItemsResult[] = [];

  const ob = await openOrders(client, ctx);
  try {
    for (let p = 1; p <= maxPages; p++) {
      const orders = await ob.list(p, 10);
      if (!orders.length) break;
      for (const o of orders) {
        scanned++;
        const summary = normalise(o);
        try {
          const detail = await ob.detail(summary.id);
          const items = (Array.isArray((detail as any).order_items) ? (detail as any).order_items : []) as any[];
          const hits: OrderItemHit[] = items
            .filter((it) => String(it?.product?.name ?? "").toLowerCase().includes(q))
            .map((it) => ({
              name: String(it.product?.name ?? "?"),
              quantity: Number(it.quantity ?? 0),
              uom: it.uom as string | undefined,
              sub_total: Number(it.sub_total ?? NaN),
              uid: String(it.product?.product_uid ?? ""),
            }));
          if (hits.length) matches.push({ order: summary, items: hits });
        } catch (err) {
          if ((err as any)?.status === 404) continue;
          throw err;
        }
      }
      if (orders.length < 10) break;
    }
  } finally {
    await ob.close();
  }
  return { matches, scanned, via: "browser" };
}

// Re-export for callers that still want the raw ApiError type
export { ApiError };
