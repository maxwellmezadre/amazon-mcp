#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DETAIL_READY,
  ORDERS_READY,
  ORDERS_READY_EXPRESSION,
  POPOVER_READY,
  invoicePopoverPath,
  orderDetailPath,
  ordersPath,
} from "../src/amazon/urls.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";

// Captures the REAL account into task/captures (gitignored). These raw pages
// become the local golden corpus and, after scripts/anonymize-fixture.ts, the
// committed fixtures.
//
// Dry run by default: nothing is written without --write. Capturing the failure
// shapes matters as much as the happy path, so this also grabs the page BEFORE
// decryption and the response to a session-less request.

const argv = process.argv.slice(2);
const args = new Set(argv);
const write = args.has("--write");
/**
 * Cap the number of orders whose detail is fetched. A full pass costs one page
 * load per order at browsing speed, so the first run should be small enough to
 * check the parsers against reality before spending the whole history.
 */
const maxOrders = Number(argv.find((a) => a.startsWith("--max-orders="))?.split("=")[1] ?? Infinity);
/** Stop after this many list filters (a filter is one year). */
const maxFilters = Number(argv.find((a) => a.startsWith("--max-filters="))?.split("=")[1] ?? Infinity);
const outDir = join(process.cwd(), "task", "captures");

type Entry = { name: string; bytes: number; url: string; kind: string };
const index: Entry[] = [];

function save(name: string, kind: string, url: string, body: string): void {
  index.push({ name, bytes: body.length, url, kind });
  console.error(`  ${write ? "saved" : "would save"} ${name} (${body.length} bytes)`);
  if (write) writeFileSync(join(outDir, name), body, { mode: 0o600 });
}

async function attempt(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  FAILED ${name}: ${message}`);
    if (write) writeFileSync(join(outDir, `${name}.error.txt`), message, { mode: 0o600 });
  }
}

const ctx = createContext(loadConfig());
if (write) mkdirSync(outDir, { recursive: true, mode: 0o700 });
console.error(`amazon-mcp — captura de fixtures ${write ? "(gravando)" : "(dry run)"}`);

try {
  // 1. The current year's first page, which also reveals every available year.
  const year = new Date().getFullYear();
  let years: string[] = [];
  await attempt("orders-current", async () => {
    const page = await ctx.amazon.page(ordersPath(`year-${year}`), { readySelector: ORDERS_READY, readyExpression: ORDERS_READY_EXPRESSION });
    save(`orders-year-${year}-p1.html`, "list", page.url, page.html);
    years = [...page.html.matchAll(/value="(year-\d{4}|last30|months-3)"/g)].map(
      (match) => match[1] as string,
    );
    console.error(`  filtros disponíveis: ${years.join(", ") || "(nenhum lido)"}`);
  });

  // 2. Every filter, every page. This is the corpus the parser is judged on.
  const orderIds = new Set<string>();
  for (const filter of years.slice(0, maxFilters)) {
    for (let page = 1; page <= 20; page += 1) {
      let more = false;
      await attempt(`orders-${filter}-p${page}`, async () => {
        const result = await ctx.amazon.page(ordersPath(filter, page), { readySelector: ORDERS_READY, readyExpression: ORDERS_READY_EXPRESSION });
        save(`orders-${filter}-p${page}.html`, "list", result.url, result.html);
        // Order ids ONLY from inside .yohtmlc-order-id: the session-id cookie has
        // the very same shape and appears in telemetry URLs all over the page.
        for (const block of result.html.matchAll(
          /class="yohtmlc-order-id"[\s\S]{0,400}?<\/div>/g,
        )) {
          const id = /([A-Z]?\d{2,3}-\d{7}-\d{7})/.exec(block[0]);
          if (id) orderIds.add(id[1] as string);
        }
        // Amazon paginates at 10 cards; a short page is the last one.
        const cards = (result.html.match(/js-order-card/g) ?? []).length;
        more = cards >= 10 && page < 20;
      });
      if (!more) break;
    }
  }
  console.error(`  ${orderIds.size} pedidos vistos`);

  // 3. Detail and invoice popover per order.
  for (const orderId of [...orderIds].slice(0, maxOrders)) {
    await attempt(`detail-${orderId}`, async () => {
      const page = await ctx.amazon.page(orderDetailPath(orderId), {
        readySelector: DETAIL_READY,
      });
      save(`detail-${orderId}.html`, "detail", page.url, page.html);
    });
    await attempt(`popover-${orderId}`, async () => {
      const page = await ctx.amazon.page(invoicePopoverPath(orderId), {
        readySelector: POPOVER_READY,
      });
      save(`popover-${orderId}.html`, "popover", page.url, page.html);
    });
  }

  // 4. The page BEFORE decryption: proof of what a plain HTTP client would get,
  // and the fixture that keeps the CsdError path honest.
  await attempt("orders-encrypted", async () => {
    const page = await ctx.amazon.page(ordersPath(`year-${year}`), {
      // Anything already in the skeleton, so extraction happens before the
      // decryption has replaced the cards.
      readySelector: "body",
    });
    save(`orders-year-${year}-precsd.html`, "encrypted", page.url, page.html);
  });

  if (write) {
    writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2), { mode: 0o600 });
  }
  console.error(
    `\n${index.length} arquivos ${write ? "gravados em task/captures" : "seriam gravados (rode com --write)"}`,
  );
} finally {
  await ctx.dispose();
}
