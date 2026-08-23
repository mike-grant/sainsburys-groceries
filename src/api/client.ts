import { API_BASE, BASE_URL } from "../config.ts";
import {
  ApiError,
  FetchTransport,
  NoSessionError,
  PageTransport,
  type Transport,
} from "./transport.ts";
import type {
  Basket,
  Product,
  Reservation,
  SearchResponse,
  Session,
} from "../types.ts";

export { ApiError, NoSessionError } from "./transport.ts";
export type { Transport } from "./transport.ts";

interface ClientOptions {
  session: Session | null;
  transport: Transport;
}

function tomorrowIso(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

export class GroceriesClient {
  readonly session: Session | null;
  private transport: Transport;

  constructor(opts: ClientOptions) {
    this.session = opts.session;
    this.transport = opts.transport;
  }

  requireSession(): Session {
    if (!this.session) throw new NoSessionError();
    return this.session;
  }

  basketParams(slotBooked?: boolean, pickTime?: string, storeNumber?: string): string {
    const params = new URLSearchParams({
      pick_time: pickTime ?? tomorrowIso(),
      store_number: storeNumber ?? "0560",
      slot_booked: String(slotBooked ?? false),
    });
    return params.toString();
  }

  async request<T = unknown>(
    method: string,
    pathOrUrl: string,
    opts: {
      query?: Record<string, string>;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
    const u = new URL(url);
    if (opts.query) for (const [k, v] of Object.entries(opts.query)) u.searchParams.set(k, v);

    const res = await this.transport.request(method, u.toString(), {
      body: opts.body,
      headers: opts.headers,
    });

    if (res.status >= 400 || /<HTML>/i.test(res.text.slice(0, 100))) {
      throw new ApiError(res.status, u.toString(), res.status >= 400 ? "error" : "blocked", res.text.slice(0, 2000));
    }
    if (!res.text) return {} as T;
    try {
      return JSON.parse(res.text) as T;
    } catch {
      throw new ApiError(res.status, u.toString(), "non-JSON response", res.text.slice(0, 500));
    }
  }

  // ---- products -------------------------------------------------------------

  searchProducts(query: string, pageNumber = 1, pageSize = 24): Promise<SearchResponse> {
    return this.request<SearchResponse>("GET", "/product/v1/product", {
      query: {
        "filter[keyword]": query,
        page_number: String(pageNumber),
        page_size: String(pageSize),
      },
    });
  }

  /** Search works unauthenticated; sku-looking inputs skip the lookup. */
  async resolveProduct(queryOrSku: string): Promise<Product> {
    if (/^\d{6,8}$/.test(queryOrSku)) {
      return { product_uid: queryOrSku, name: queryOrSku };
    }
    const res = await this.searchProducts(queryOrSku, 1, 10);
    const inStock = res.products?.filter((p) => p.in_stock !== false) ?? [];
    const first = inStock[0] ?? res.products?.[0];
    if (!first?.product_uid) throw new Error(`No product found for "${queryOrSku}"`);
    return first;
  }

  // ---- customer ---------------------------------------------------------------

  /**
   * NOTE: anonymous users get HTTP 200 with a guest payload (user_id like
   * -1002) on authed endpoints, so "ok" must be judged by content.
   */
  async getProfile(): Promise<Record<string, unknown>> {
    const profile = await this.request<Record<string, unknown>>("GET", "/customer/v1/customer/profile");
    const userId = Number(profile?.user_id ?? 0);
    if (!profile || Object.keys(profile).length === 0 || !Number.isFinite(userId) || userId <= 0) {
      throw new NoSessionError();
    }
    return profile;
  }

  // ---- basket -----------------------------------------------------------------

  async getBasket(slotBooked = false): Promise<Basket> {
    const b = await this.request<Basket>("GET", `/basket/v2/basket?${this.basketParams(slotBooked)}`);
    return b ?? {};
  }

  addToBasket(productUid: string, quantity: number, uom = "ea", slotBooked = false): Promise<Basket> {
    return this.request<Basket>("POST", `/basket/v2/basket/item?${this.basketParams(slotBooked)}`, {
      body: { product_uid: productUid, quantity, uom, selected_catchweight: "" },
    });
  }

  updateBasketItem(itemUid: string, quantity: number, slotBooked = false): Promise<Basket> {
    return this.request<Basket>(
      "PUT",
      `/basket/v2/basket/items/${itemUid}?${this.basketParams(slotBooked)}`,
      { body: { quantity } },
    );
  }

  removeBasketItem(itemUid: string, slotBooked = false): Promise<Basket> {
    return this.request<Basket>(
      "DELETE",
      `/basket/v2/basket/item/${itemUid}?${this.basketParams(slotBooked)}`,
    );
  }

  // ---- slots ------------------------------------------------------------------

  getReservation(): Promise<Reservation> {
    return this.request("GET", "/slot/v1/slot/reservation");
  }

  async hasBookedSlot(): Promise<boolean> {
    try {
      const r = await this.getReservation();
      const t = r?.reservation_type ? String(r.reservation_type) : "";
      return Boolean(r?.slot) || !!t && !/none/i.test(t);
    } catch {
      return false;
    }
  }

  getDeliveryInformation(): Promise<Record<string, unknown>> {
    return this.request("GET", "/slot/v1/slot/delivery-information");
  }

  listSlotsDirect(query: Record<string, string>): Promise<unknown> {
    return this.request("GET", "/slot/v1/slots", { query });
  }

  bookSlotDirect(slotId: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("POST", "/slot/v1/slot/reservation", {
      body: { ...extra, slot_id: slotId },
    });
  }

  cancelReservation(): Promise<unknown> {
    return this.request("DELETE", "/slot/v1/slot/reservation");
  }

  // ---- orders -----------------------------------------------------------------

  /** Order history endpoint is undocumented; try known candidates in order. */
  async getOrders(): Promise<{ orders: Record<string, unknown>[]; via: string }> {
    const candidates = ["/order/v1/order/status", "/order/v1/orders", "/order/v1/order/history"];
    let lastErr: unknown;
    for (const c of candidates) {
      try {
        const data = await this.request<unknown>("GET", c);
        const orders = Array.isArray(data)
          ? data
          : ((data as any)?.orders ?? (data as any)?.order_history ?? (data as any)?.results ?? []);
        if (orders.length > 0) return { orders, via: c };
        lastErr = new ApiError(404, `${BASE_URL}${c}`, "empty order list");
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
