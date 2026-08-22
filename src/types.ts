export interface SessionCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface Session {
  cookies: SessionCookie[];
  wcauthtoken: string;
  /** ISO timestamp after which the session is presumed dead */
  expiresAt?: string;
  lastLogin?: string;
  source: "browser-login" | "cookie-import" | "env" | "unknown";
}

export interface Product {
  product_uid: string;
  sku?: string;
  name: string;
  retail_price?: number | { price: number; [k: string]: unknown };
  unit_price?: number | { price: number; uom?: string; [k: string]: unknown };
  in_stock?: boolean;
  image_url?: string;
  [k: string]: unknown;
}

export interface SearchResponse {
  products: Product[];
  total?: number;
  page_number?: number;
  page_size?: number;
  [k: string]: unknown;
}

export interface BasketItem {
  item_uid: string;
  quantity: number;
  subtotal_price?: number;
  product?: { sku?: string; name?: string; [k: string]: unknown };
  [k: string]: unknown;
}

export interface Basket {
  basket_id?: string | number;
  order_id?: string | number;
  subtotal_price?: number;
  total_price?: number;
  minimum_spend?: number;
  has_exceeded_minimum_spend?: boolean;
  item_count?: number;
  items?: BasketItem[];
  [k: string]: unknown;
}

export interface Reservation {
  reservation_type?: string;
  postcode?: string;
  region?: string;
  store_identifier?: string;
  flexi_stores?: boolean;
  is_alcohol_restricted_store?: boolean;
  slot?: { slot_info?: Record<string, unknown>; [k: string]: unknown };
  [k: string]: unknown;
}

export interface DeliverySlot {
  id: string;
  date?: string;
  start?: string;
  end?: string;
  price?: number;
  type?: string;
  raw: unknown;
}

export interface OrderSummary {
  id: string;
  status?: string;
  delivery_date?: string;
  delivery_slot?: string;
  total?: number;
  amendable?: boolean;
  raw: unknown;
}
