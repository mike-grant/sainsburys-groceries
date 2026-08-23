import { API_BASE, BASE_URL } from "../config.js";
import { ApiError, NoSessionError, } from "./transport.js";
export { ApiError, NoSessionError } from "./transport.js";
function tomorrowIso() {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    return d.toISOString();
}
export class GroceriesClient {
    session;
    transport;
    constructor(opts) {
        this.session = opts.session;
        this.transport = opts.transport;
    }
    requireSession() {
        if (!this.session)
            throw new NoSessionError();
        return this.session;
    }
    basketParams(slotBooked, pickTime, storeNumber) {
        const params = new URLSearchParams({
            pick_time: pickTime ?? tomorrowIso(),
            store_number: storeNumber ?? "0560",
            slot_booked: String(slotBooked ?? false),
        });
        return params.toString();
    }
    async request(method, pathOrUrl, opts = {}) {
        const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
        const u = new URL(url);
        if (opts.query)
            for (const [k, v] of Object.entries(opts.query))
                u.searchParams.set(k, v);
        const res = await this.transport.request(method, u.toString(), {
            body: opts.body,
            headers: opts.headers,
        });
        if (res.status >= 400 || /<HTML>/i.test(res.text.slice(0, 100))) {
            throw new ApiError(res.status, u.toString(), res.status >= 400 ? "error" : "blocked", res.text.slice(0, 2000));
        }
        if (!res.text)
            return {};
        try {
            return JSON.parse(res.text);
        }
        catch {
            throw new ApiError(res.status, u.toString(), "non-JSON response", res.text.slice(0, 500));
        }
    }
    // ---- products -------------------------------------------------------------
    searchProducts(query, pageNumber = 1, pageSize = 24) {
        return this.request("GET", "/product/v1/product", {
            query: {
                "filter[keyword]": query,
                page_number: String(pageNumber),
                page_size: String(pageSize),
            },
        });
    }
    /** Search works unauthenticated; sku-looking inputs skip the lookup. */
    async resolveProduct(queryOrSku) {
        if (/^\d{6,8}$/.test(queryOrSku)) {
            return { product_uid: queryOrSku, name: queryOrSku };
        }
        const res = await this.searchProducts(queryOrSku, 1, 10);
        const inStock = res.products?.filter((p) => p.in_stock !== false) ?? [];
        const first = inStock[0] ?? res.products?.[0];
        if (!first?.product_uid)
            throw new Error(`No product found for "${queryOrSku}"`);
        return first;
    }
    // ---- customer ---------------------------------------------------------------
    /**
     * NOTE: anonymous users get HTTP 200 with a guest payload (user_id like
     * -1002) on authed endpoints, so "ok" must be judged by content.
     */
    async getProfile() {
        const profile = await this.request("GET", "/customer/v1/customer/profile");
        const userId = Number(profile?.user_id ?? 0);
        if (!profile || Object.keys(profile).length === 0 || !Number.isFinite(userId) || userId <= 0) {
            throw new NoSessionError();
        }
        return profile;
    }
    // ---- basket -----------------------------------------------------------------
    async getBasket(slotBooked = false) {
        const b = await this.request("GET", `/basket/v2/basket?${this.basketParams(slotBooked)}`);
        return b ?? {};
    }
    addToBasket(productUid, quantity, uom = "ea", slotBooked = false) {
        return this.request("POST", `/basket/v2/basket/item?${this.basketParams(slotBooked)}`, {
            body: { product_uid: productUid, quantity, uom, selected_catchweight: "" },
        });
    }
    updateBasketItem(itemUid, quantity, slotBooked = false) {
        return this.request("PUT", `/basket/v2/basket/items/${itemUid}?${this.basketParams(slotBooked)}`, { body: { quantity } });
    }
    removeBasketItem(itemUid, slotBooked = false) {
        return this.request("DELETE", `/basket/v2/basket/item/${itemUid}?${this.basketParams(slotBooked)}`);
    }
    // ---- slots ------------------------------------------------------------------
    getReservation() {
        return this.request("GET", "/slot/v1/slot/reservation");
    }
    async hasBookedSlot() {
        try {
            const r = await this.getReservation();
            const t = r?.reservation_type ? String(r.reservation_type) : "";
            return Boolean(r?.slot) || !!t && !/none/i.test(t);
        }
        catch {
            return false;
        }
    }
    getDeliveryInformation() {
        return this.request("GET", "/slot/v1/slot/delivery-information");
    }
    listSlotsDirect(query) {
        return this.request("GET", "/slot/v1/slots", { query });
    }
    bookSlotDirect(slotId, extra = {}) {
        return this.request("POST", "/slot/v1/slot/reservation", {
            body: { ...extra, slot_id: slotId },
        });
    }
    cancelReservation() {
        return this.request("DELETE", "/slot/v1/slot/reservation");
    }
    // ---- orders -----------------------------------------------------------------
    /** Order history endpoint is undocumented; try known candidates in order. */
    async getOrders() {
        const candidates = ["/order/v1/order/status", "/order/v1/orders", "/order/v1/order/history"];
        let lastErr;
        for (const c of candidates) {
            try {
                const data = await this.request("GET", c);
                const orders = Array.isArray(data)
                    ? data
                    : (data?.orders ?? data?.order_history ?? data?.results ?? []);
                if (orders.length > 0)
                    return { orders, via: c };
                lastErr = new ApiError(404, `${BASE_URL}${c}`, "empty order list");
            }
            catch (err) {
                lastErr = err;
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    }
}
