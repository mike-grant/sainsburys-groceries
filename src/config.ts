import path from "node:path";
import os from "node:os";

export const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const BASE_URL = "https://www.sainsburys.co.uk";
export const API_BASE = `${BASE_URL}/groceries-api/gol-services`;
export const UI_BASE = `${BASE_URL}/gol-ui`;
export const LOGIN_URL = `${UI_BASE}/oauth/login`;
export const ORDERS_URL = `${UI_BASE}/my-account/orders`;
export const SLOTS_URL = `${UI_BASE}/slotselection`;

export function defaultSessionPath(): string {
  return (
    process.env.SAINSBURYS_SESSION_PATH ??
    path.join(os.homedir(), ".sainsburys", "session.json")
  );
}

export interface GlobalOptions {
  json?: boolean;
  verbose?: boolean;
  ws?: string;
  headed?: boolean;
  timeoutMs?: number;
}

export const DEFAULT_LIGHTPANDA_WS = "ws://127.0.0.1:9222";
