#!/usr/bin/env bun
import { Command } from "commander";
import { GroceriesClient } from "./api/client.ts";
import { FetchTransport, PageTransport } from "./api/transport.ts";
import { KoonTransport } from "./api/koon.ts";
import { defaultSessionPath } from "./config.ts";
import {
  parseCookieHeader,
  resolveSession,
  saveSession,
  deleteSession,
  findWcauthtoken,
} from "./session/store.ts";
import { connectBrowser } from "./browser/connect.ts";
import {
  exportSessionFromContext,
  findChromiumExecutable,
  importSessionToContext,
  openWarmedGroceriesPage,
} from "./browser/context.ts";
import { interactiveLogin, credentialLogin } from "./browser/login.ts";
import { bookSlotViaBrowser, listSlotsViaBrowser } from "./browser/slots.ts";
import { getLatestOrder, getOrders } from "./services/orders.ts";
import { smartAdd } from "./services/basket.ts";
import { doctorApi, doctorLightpanda } from "./services/doctor.ts";
import { fmtPrice, printTable, priceOf, truncate } from "./util/format.ts";

const program = new Command();

program
  .name("sainsburys")
  .description("Sainsbury's Groceries automation: orders, slots, basket/amendments")
  .version("0.1.0")
  .option("--json", "machine-readable output", false)
  .option("-v, --verbose", "verbose logging to stderr", false)
  .option("--ws <url>", "remote CDP WebSocket endpoint (remote Playwright / LightPanda)")
  .option("--headed", "show the local browser window", false)
  .option("--browser", "force local Chromium page transport instead of impers sidecar", false)
  .option("--http", "use raw fetch (denied by Akamai TLS fingerprinting on most networks)", false)
  .option("--session <path>", "session file path", defaultSessionPath());

interface OpenedClient {
  client: GroceriesClient;
  close?: () => Promise<void>;
}

/** Build a working client. Priority: --ws remote browser > --browser local > impers sidecar > --http fetch. */
async function openClient(): Promise<OpenedClient> {
  const opts = program.opts();
  const session = resolveSession(opts.session);

  if (opts.http) {
    return { client: new GroceriesClient({ session, transport: new FetchTransport(session) }) };
  }

  if (wsEndpoint(opts)) {
    const bs = await connectBrowser({ ws: wsEndpoint(opts), verbose: opts.verbose });
    if (session) await importSessionToContext(bs.context, session);
    const page = await openWarmedGroceriesPage(bs.context);
    return {
      client: new GroceriesClient({ session, transport: new PageTransport(page) }),
      close: () => bs.close(),
    };
  }

  // Default: koonjs impersonated-TLS transport (works under Node AND Bun).
  const koon = new KoonTransport(session);
  return { client: new GroceriesClient({ session, transport: koon }), close: () => koon.close() };
}


/** Resolve remote CDP endpoint: --ws flag wins, then SAINSBURYS_WS env. */
function wsEndpoint(opts: { ws?: string }): string | undefined {
  return opts.ws ?? (process.env.SAINSBURYS_WS || undefined);
}

function fail(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`error: ${msg}`);
  process.exit(1);
}

async function withClient<T>(fn: (c: GroceriesClient) => Promise<T>): Promise<void> {
  let opened: OpenedClient | undefined;
  try {
    opened = await openClient();
    await fn(opened.client);
  } catch (err) {
    fail(err);
  } finally {
    await opened?.close?.();
  }
}

// ---- auth -----------------------------------------------------------------

program
  .command("login")
  .description("authenticate: with SAINSBURYS_USERNAME+SAINSBURYS_PASSWORD set, fills the form headlessly (add --mfa <code> if prompted); otherwise opens an interactive browser window")
  .option("--mfa <code>", "one-time code for the MFA challenge step")
  .action(async (cmdOpts: { mfa?: string }) => {
    const opts = program.opts();
    const username = process.env.SAINSBURYS_USERNAME;
    const password = process.env.SAINSBURYS_PASSWORD;
    try {
      if (username && password) {
        console.error(
          `Credential login for ${username}${wsEndpoint(opts) ? ` via remote browser ${wsEndpoint(opts)}` : " (headless local browser)"}...`,
        );
        const { sessionPath } = await credentialLogin({
          username,
          password,
          mfaCode: cmdOpts.mfa,
          ws: wsEndpoint(opts),
          headed: opts.headed,
          verbose: opts.verbose,
          sessionPath: opts.session,
          executablePath: findChromiumExecutable(),
        });
        console.log(`Session saved to ${sessionPath}`);
      } else {
        const { sessionPath } = await interactiveLogin({
          ws: wsEndpoint(opts),
          headed: opts.headed || !wsEndpoint(opts),
          verbose: opts.verbose,
          sessionPath: opts.session,
          executablePath: findChromiumExecutable(),
        });
        console.log(`Session saved to ${sessionPath}`);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command("import-cookie-header")
  .description("import cookies pasted from devtools (Network -> groceries-api request -> Cookie header)")
  .argument("<cookieHeader>")
  .option("-t, --wcauthtoken <token>", "wcauthtoken request header value")
  .action((header: string, cmdOpts: { wcauthtoken?: string }) => {
    try {
      const cookies = parseCookieHeader(header);
      if (!cookies.length) throw new Error("No cookies parsed from input");
      const session = saveSession({
        cookies,
        wcauthtoken: cmdOpts.wcauthtoken ?? findWcauthtoken(cookies),
        source: "cookie-import",
      });
      console.log(`Imported ${cookies.length} cookies -> ${session}`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("logout")
  .description("delete the saved session")
  .action(() => {
    console.log(deleteSession(program.opts().session) ? "Session deleted" : "No saved session");
  });

// ---- account ----------------------------------------------------------------

program
  .command("whoami")
  .description("verify session; show profile summary")
  .action(async () =>
    withClient(async (client) => {
      const profile = await client.getProfile();
      if (program.opts().json) return console.log(JSON.stringify(profile, null, 2));
      printTable(
        Object.entries(profile)
          .filter(([, v]) => typeof v !== "object")
          .map(([k, v]) => ({ field: k, value: String(v).slice(0, 80) })),
        ["field", "value"],
      );
    }),
  );

// ---- search -------------------------------------------------------------------

program
  .command("search")
  .description("search products")
  .argument("<query>")
  .option("-n, --limit <n>", "results", "10")
  .action(async (query: string, cmdOpts: { limit: string }) =>
    withClient(async (client) => {
      const res = await client.searchProducts(query, 1, Math.min(Number(cmdOpts.limit), 60));
      if (program.opts().json) return console.log(JSON.stringify(res.products ?? res, null, 2));
      printTable(
        (res.products ?? []).map((p) => ({
          uid: p.product_uid,
          name: truncate(p.name, 55),
          price: fmtPrice(p.retail_price),
          stock: p.in_stock === false ? "out" : "in",
        })),
        ["uid", "name", "price", "stock"],
      );
    }),
  );

// ---- basket ---------------------------------------------------------------------

const basket = program.command("basket").description("view / edit the current basket");

basket.command("view").action(async () =>
  withClient(async (client) => {
    const b = await client.getBasket();
    if (program.opts().json) return console.log(JSON.stringify(b, null, 2));
    printTable(
      (b.items ?? []).map((i) => ({
        item_uid: i.item_uid,
        sku: i.product?.sku ?? "?",
        name: truncate(String(i.product?.name ?? "?"), 50),
        qty: i.quantity,
        subtotal: fmtPrice(i.subtotal_price),
      })),
      ["item_uid", "sku", "name", "qty", "subtotal"],
    );
    console.log(
      `\nitems=${b.item_count ?? (b.items ?? []).length} subtotal=${fmtPrice(b.subtotal_price)} min_spend=${fmtPrice(b.minimum_spend)}`,
    );
  }),
);

async function addToTarget(queryOrSku: string, qty: number): Promise<void> {
  // With a booked slot, additions amend the upcoming order automatically.
  await withClient(async (client) => {
    const result = await smartAdd(client, queryOrSku, qty);
    if (program.opts().json) return console.log(JSON.stringify(result, null, 2));
    console.log(`+ ${result.quantity} x ${result.name} (${result.productUid}) -> ${result.target}`);
  });
}

basket
  .command("add")
  .description("add a product by uid or search query")
  .argument("<productOrQuery>")
  .option("-q, --qty <n>", "quantity", "1")
  .action(async (p: string, o: { qty: string }) => {
    try {
      await addToTarget(p, Number(o.qty));
    } catch (err) {
      fail(err);
    }
  });

basket
  .command("remove")
  .description("remove a basket item by item_uid")
  .argument("<itemUid>")
  .action(async (itemUid: string) =>
    withClient(async (client) => {
      const b = await client.removeBasketItem(itemUid);
      if (program.opts().json) return console.log(JSON.stringify(b, null, 2));
      console.log(`removed ${itemUid}; items=${(b.items ?? []).length}`);
    }),
  );

// ---- orders -----------------------------------------------------------------------

const orders = program.command("orders").description("previous & upcoming orders");

orders
  .command("list")
  .alias("history")
  .option("-n, --limit <n>", "max orders shown", "10")
  .action(async (o: { limit: string }) =>
    withClient(async (client) => {
      const { orders: list, via } = await getOrders(client);
      const rows = list.slice(0, Number(o.limit));
      if (program.opts().json) return console.log(JSON.stringify({ via, orders: rows }, null, 2));
      console.error(`via: ${via}`);
      printTable(rows, ["id", "status", "delivery_date", "total", "amendable"]);
    }),
  );

orders
  .command("latest")
  .description("most recent / next order")
  .action(async () =>
    withClient(async (client) => {
      const latest = await getLatestOrder(client);
      if (program.opts().json) return console.log(JSON.stringify(latest, null, 2));
      printTable([{ ...latest, raw: undefined }], ["id", "status", "delivery_date", "total", "amendable"]);
    }),
  );

const amend = program.command("amend").description("amend an existing/upcoming order");

amend
  .command("add")
  .description("add items to the upcoming order (uses booked-slot semantics)")
  .argument("<productOrQuery>")
  .option("-q, --qty <n>", "quantity", "1")
  .action(async (p: string, o: { qty: string }) => {
    try {
      await addToTarget(p, Number(o.qty));
    } catch (err) {
      fail(err);
    }
  });

// ---- slots -------------------------------------------------------------------------

const slots = program.command("slots").description("delivery slots");

slots
  .command("list")
  .description("list available delivery slots (API first, UI fallback)")
  .option("-p, --postcode <pc>", "postcode for unauthenticated search")
  .action(async (o: { postcode?: string }) =>
    withClient(async (client) => {
      const opts = program.opts();
      let rows: Record<string, unknown>[];
      let via = "ui";
      try {
        const direct = await client.listSlotsDirect({});
        const arr = Array.isArray(direct) ? direct : ((direct as any)?.slots ?? []);
        rows = (arr as any[]).map((s, i) => ({
          id: String(s.id ?? s.slot_id ?? i),
          date: s.date ?? s.start_date,
          start: s.start_time ?? s.start,
          end: s.end_time ?? s.end,
          price: fmtPrice(s.price ?? s.slot_price),
        }));
        via = "api";
      } catch (err) {
        if (!wsEndpoint(opts) && !opts.headed) throw err;
        const domSlots = await listSlotsViaBrowser({
          ws: wsEndpoint(opts),
          headed: opts.headed,
          postcode: o.postcode,
        });
        rows = domSlots.map((s) => ({
          id: s.id,
          date: s.date,
          start: s.start,
          end: s.end,
          price: fmtPrice(s.price),
        }));
      }
      if (opts.json) return console.log(JSON.stringify({ via, slots: rows }, null, 2));
      console.error(`via: ${via}`);
      printTable(rows, ["id", "date", "start", "end", "price"]);
    }),
  );

slots
  .command("book")
  .description("book a slot by id (API attempt, then UI click fallback). A regex picks a visible slot.")
  .argument("<slotIdOrPattern>")
  .option("--dry-run", "do not confirm booking", false)
  .action(async (slotIdOrPattern: string, o: { dryRun: boolean }) =>
    withClient(async (client) => {
      const opts = program.opts();
      if (/^[\w-]+$/.test(slotIdOrPattern)) {
        try {
          const res = await client.bookSlotDirect(slotIdOrPattern);
          if (opts.json) return console.log(JSON.stringify(res, null, 2));
          return console.log(`Booked slot ${slotIdOrPattern} (via API)`);
        } catch (err) {
          console.error(`direct API failed (${String(err).slice(0, 120)}); trying UI...`);
        }
      }
      if (!wsEndpoint(opts) && !opts.headed) throw new Error("UI booking needs --ws or --headed");
      const result = await bookSlotViaBrowser({
        ws: wsEndpoint(opts),
        headed: opts.headed,
        match: new RegExp(slotIdOrPattern, "i"),
        dryRun: o.dryRun,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        `${o.dryRun ? "would click" : "clicked"} slot matching /${slotIdOrPattern}/` +
          (result.confirmed ? " and confirmed" : ""),
      );
    }),
  );

slots.command("cancel").description("cancel current slot reservation").action(async () =>
  withClient(async (client) => {
    const res = await client.cancelReservation();
    if (program.opts().json) return console.log(JSON.stringify(res, null, 2));
    console.log("Reservation cancelled");
  }),
);

slots.command("reservation").description("show current reservation status").action(async () =>
  withClient(async (client) => {
    const r = await client.getReservation();
    console.log(JSON.stringify(r, null, 2));
  }),
);

// ---- doctor ---------------------------------------------------------------------------

const doctor = program.command("doctor").description("diagnostics");

doctor
  .command("lightpanda")
  .description("test whether a LightPanda/CDP browser is accepted by sainsburys.co.uk")
  .option("--ws <url>", "CDP endpoint", "ws://127.0.0.1:9222")
  .action(async (o: { ws: string }) => {
    try {
      const result = await doctorLightpanda({ ws: o.ws, verbose: program.opts().verbose });
      if (program.opts().json) return console.log(JSON.stringify(result, null, 2));
      for (const c of result.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
      console.log(result.ok ? "\nLightPanda appears accepted." : "\nLightPanda NOT fully accepted.");
      process.exitCode = result.ok ? 0 : 1;
    } catch (err) {
      fail(err);
    }
  });

doctor.command("api").description("check session health against authenticated endpoints").action(async () =>
  withClient(async (client) => {
    const result = await doctorApi(client);
    if (program.opts().json) return console.log(JSON.stringify(result, null, 2));
    for (const c of result.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
    process.exitCode = result.ok ? 0 : 1;
  }),
);

program.parseAsync(process.argv);
