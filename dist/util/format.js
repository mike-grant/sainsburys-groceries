export function priceOf(v) {
    if (typeof v === "number")
        return v;
    if (v && typeof v === "object" && typeof v.price === "number")
        return v.price;
    return undefined;
}
export function fmtPrice(v) {
    const n = priceOf(v);
    return n !== undefined ? `£${n.toFixed(2)}` : "—";
}
export function truncate(s, n = 60) {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
export function printTable(rows, cols) {
    if (!rows.length) {
        console.log("(none)");
        return;
    }
    const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
    const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
    console.log(line(cols));
    for (const r of rows)
        console.log(line(cols.map((c) => String(r[c] ?? ""))));
}
