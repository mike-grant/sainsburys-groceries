type PriceLike = number | { price?: number } | undefined | null;

export function priceOf(v: PriceLike): number | undefined {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof v.price === "number") return v.price;
  return undefined;
}

export function fmtPrice(v: PriceLike): string {
  const n = priceOf(v);
  return n !== undefined ? `£${n.toFixed(2)}` : "—";
}

export function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function printTable(rows: object[], cols: string[]): void {
  if (!rows.length) {
    console.log("(none)");
    return;
  }
  const widths = cols.map(
    (c) => Math.max(c.length, ...rows.map((r) => String((r as Record<string, unknown>)[c] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(line(cols));
  for (const r of rows)
    console.log(line(cols.map((c) => String((r as Record<string, unknown>)[c] ?? ""))));
}
