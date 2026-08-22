import { describe, expect, test } from "bun:test";
import {
  buildCookieHeader,
  findWcauthtoken,
  parseCookieHeader,
} from "../src/session/store.ts";
import { parseSlotTexts } from "../src/browser/slots.ts";
import { fmtPrice, priceOf, truncate } from "../src/util/format.ts";

describe("cookie header parsing", () => {
  test("parses devtools cookie header", () => {
    const cookies = parseCookieHeader(
      "WC_AUTHENTICATION_554173388=abc123; JSESSIONID=xyz; theme=light",
    );
    expect(cookies.length).toBe(3);
    const names = cookies.map((c) => c.name);
    expect(names).toContain("WC_AUTHENTICATION_554173388");
    // scoped sensibly
    for (const c of cookies) {
      expect(c.domain).toBe(".sainsburys.co.uk");
      expect(c.secure).toBe(true);
    }
  });

  test("handles values containing '='", () => {
    const cookies = parseCookieHeader("token=abc==; a=1");
    expect(cookies[0]!.value).toBe("abc==");
    expect(cookies[1]!.value).toBe("1");
  });

  test("ignores junk", () => {
    expect(parseCookieHeader(";; = ; foo").length).toBe(0);
  });

  test("findWcauthtoken picks WC_AUTHENTICATION_*", () => {
    const cookies = parseCookieHeader("WC_AUTHENTICATION_123=tok; other=x");
    expect(findWcauthtoken(cookies)).toBe("tok");
    expect(findWcauthtoken([])).toBe("");
  });

  test("round-trips through buildCookieHeader", () => {
    const header = "a=1; b=two";
    expect(buildCookieHeader(parseCookieHeader(header))).toBe(header);
  });
});

describe("slot text parsing", () => {
  test("extracts time ranges, prices and dates", () => {
    const slots = parseSlotTexts([
      { id: "s1", text: "Tue 25 Aug  08:00 - 10:00  £1.50" },
      { id: "s2", text: "Wed 26 Aug  18:00 - 20:00  Free" },
      { id: "junk", text: "Delivery information" },
      { id: "s1-dup", text: "Tue 25 Aug 08:00 - 10:00 £1.50 extra markup" },
    ]);
    expect(slots.length).toBe(2);
    expect(slots[0]).toMatchObject({ start: "08:00", end: "10:00", price: 1.5 });
    expect(slots[1]!.price).toBeUndefined();
    // dedupe by date|start|end
    expect(slots.filter((s) => s.start === "08:00").length).toBe(1);
  });
});

describe("formatting", () => {
  test("priceOf handles nested API shapes", () => {
    expect(priceOf({ price: 1.75 })).toBe(1.75);
    expect(priceOf(2)).toBe(2);
    expect(priceOf(undefined)).toBeUndefined();
  });
  test("fmtPrice", () => {
    expect(fmtPrice({ price: 1.75 })).toBe("£1.75");
    expect(fmtPrice(null)).toBe("—");
  });
  test("truncate", () => {
    expect(truncate("abcdef", 5)).toBe("abcd…");
  });
});
