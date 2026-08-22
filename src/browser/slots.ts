import { SLOTS_URL } from "../config.ts";
import { dismissCookieConsent, connectBrowser, type ConnectOptions } from "./connect.ts";
import type { DeliverySlot } from "../types.ts";

const TIME_RANGE_RE = /(\d{1,2}(?::\d{2})?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?)/;
const PRICE_RE = /£\s?(\d+(?:\.\d{1,2})?)/;

/**
 * Slot listing via the real UI. The direct API (`GET slot/v1/slots`) is typically
 * WAF-blocked ("Access Denied"), so we drive a browser to /gol-ui/slotselection
 * and parse the DOM. Selectors are heuristic — Sainsbury's ships data-testids but
 * changes them; we fall back to scanning for "HH:MM - HH:MM" text.
 */
export async function listSlotsViaBrowser(
  opts: ConnectOptions & { postcode?: string },
): Promise<DeliverySlot[]> {
  const bs = await connectBrowser(opts);
  try {
    const page = await bs.context.newPage();
    await page.goto(SLOTS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismissCookieConsent(page).catch(() => {});

    if (opts.postcode) {
      // If asked for a postcode first (unauthenticated flow), best effort.
      const pc = page.locator('input[name*="postcode" i], input[placeholder*="postcode" i]').first();
      if (await pc.isVisible({ timeout: 3000 }).catch(() => false)) {
        await pc.fill(opts.postcode);
        const go = page.locator('button:has-text("Book"), button[type="submit"]').first();
        await go.click().catch(() => {});
      }
    }

    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    // Give the SPA a moment to render slots.
    await page
      .waitForSelector('[data-testid*="slot"]', { timeout: 20_000 })
      .catch(() => {});

    const slots = await page.evaluate(() => {
      const out: { id: string; text: string }[] = [];
      const nodes = document.querySelectorAll<HTMLElement>('[data-testid*="slot"], [class*="slot"]');
      nodes.forEach((el, i) => {
        const text = el.innerText?.replace(/\s+/g, " ").trim() ?? "";
        if (text && text.length < 300) out.push({ id: el.getAttribute("data-testid") ?? `dom-${i}`, text });
      });
      return out;
    });

    return parseSlotTexts(slots);
  } finally {
    await bs.close();
  }
}

export function parseSlotTexts(raw: { id: string; text: string }[]): DeliverySlot[] {
  const out: DeliverySlot[] = [];
  for (const r of raw) {
    const m = TIME_RANGE_RE.exec(r.text);
    if (!m) continue;
    const p = PRICE_RE.exec(r.text);
    const dateMatch = /\b(\d{1,2}\s+[A-Za-z]{3,9}|\bMon\b|\bTue\b|\bWed\b|\bThu\b|\bFri\b|\bSat\b|\bSun\b)[^,]*(,\s*\w+)?/.exec(r.text);
    out.push({
      id: r.id,
      start: m[1],
      end: m[2],
      date: dateMatch?.[1]?.trim(),
      price: p ? parseFloat(p[1]!) : undefined,
      type: /sameday/i.test(r.text) ? "same-day" : /flex/i.test(r.text) ? "flexible" : undefined,
      raw: r.text,
    });
  }
  return dedupeSlots(out);
}

function dedupeSlots(slots: DeliverySlot[]): DeliverySlot[] {
  const seen = new Set<string>();
  const out: DeliverySlot[] = [];
  for (const s of slots) {
    const key = `${s.date ?? ""}|${s.start}|${s.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Book a specific slot through the UI by clicking its card and confirming.
 * Experimental: selectors are heuristic and may need adjusting when the site changes.
 */
export async function bookSlotViaBrowser(
  opts: ConnectOptions & { match: RegExp; dryRun?: boolean },
): Promise<{ clicked: boolean; confirmed: boolean }> {
  const bs = await connectBrowser(opts);
  try {
    const page = await bs.context.newPage();
    await page.goto(SLOTS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismissCookieConsent(page).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

    const card = page.locator(`div, button, li`).filter({ hasText: opts.match }).first();
    if (!(await card.isVisible({ timeout: 15_000 }).catch(() => false))) {
      throw new Error(`No visible slot matching ${opts.match}`);
    }
    let confirmed = false;
    if (!opts.dryRun) {
      await card.click();
      const confirm = page
        .locator('button:has-text("Confirm"), button:has-text("Book this slot"), button[data-testid*="confirm"]')
        .first();
      await confirm.click({ timeout: 10_000 });
      confirmed = true;
    }
    return { clicked: true, confirmed };
  } finally {
    await bs.close();
  }
}
