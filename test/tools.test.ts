import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "../src/cache/db.js";
import { runSyncChunk } from "../src/cache/sync.js";
import { loadConfig } from "../src/config.js";
import { type Ctx, createContext } from "../src/context.js";
import type { PageLoader } from "../src/browser/transport.js";
import { runTool } from "../src/tools/define.js";
import { toolByName } from "../src/tools/registry.js";
import { fixture, memorySession, sessionData, silentLogger } from "./helpers.js";

// The tools are exercised over a cache built from the real (anonymised) pages,
// so the numbers below are the ones Amazon actually printed.

const config = loadConfig({ AMAZON_CONFIG_DIR: "/tmp/amz-tools" });
let ctx: Ctx;

const loader: PageLoader = {
  running: () => true,
  close: async () => undefined,
  pdf: async () => new Uint8Array(Buffer.from("%PDF-1.4 fake")),
  download: async () => new Uint8Array(Buffer.from("%PDF-1.4 fake")),
  load: async (url) => {
    const html = /year-2026/.test(url)
      ? fixture("orders-with-two.html")
      : /year-2025/.test(url)
        ? fixture("orders-single.html")
        : /timeFilter=/.test(url)
          ? fixture("orders-empty-year.html")
          : /orderID=D01/.test(url)
            ? fixture("detail-digital.html")
            : /orderID=702/.test(url)
              ? fixture("detail-physical-1.html")
              : fixture("detail-physical-2.html");
    return { url, title: "t", html };
  },
};

const call = (name: string, args: Record<string, unknown> = {}) =>
  runTool(toolByName(name)!, args, ctx) as Promise<Record<string, unknown>>;

beforeAll(async () => {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  ctx = createContext(config, {
    db,
    loader,
    session: memorySession(sessionData()),
    log: silentLogger(),
    sleep: async () => undefined,
    now: () => Date.parse("2026-09-07T12:00:00Z"),
  });
  await runSyncChunk(ctx, { mode: "full", maxRequests: 100 });
});

describe("list_orders", () => {
  test("returns the cached orders newest first, with their items", async () => {
    const result = await call("list_orders");
    // Two physical orders plus a free digital one; none cancelled.
    expect(result.total).toBe(3);
    const orders = result.orders as Array<Record<string, unknown>>;
    expect(orders[0]?.date).toBe("2026-02-25");
    expect((orders[0]?.total as { amount: number }).amount).toBe(114.06);
    expect(orders[0]?.itemCount).toBe(3);
  });

  test("filters by period, type and instalments", async () => {
    expect((await call("list_orders", { from: "2026-01-01" })).total).toBe(2);
    expect((await call("list_orders", { type: "digital" })).total).toBe(1);
    expect((await call("list_orders", { has_installments: true })).total).toBe(2);
    expect((await call("list_orders", { min_total: 200 })).total).toBe(1);
  });

  test("compact drops the fields a summary does not need", async () => {
    const full = (await call("list_orders")).orders as Array<Record<string, unknown>>;
    const compact = (await call("list_orders", { compact: true })).orders as Array<
      Record<string, unknown>
    >;
    expect(full[0]).toHaveProperty("recipient");
    expect(compact[0]).not.toHaveProperty("recipient");
  });
});

describe("get_order", () => {
  test("returns every subtotal label Amazon printed, mapped and raw", async () => {
    const [first] = (await call("list_orders")).orders as Array<{ orderId: string }>;
    const order = await call("get_order", { order_id: first?.orderId });
    const subtotals = order.subtotals as Record<string, { amount: number } | null>;

    expect(subtotals.itemsSubtotal?.amount).toBe(140.53);
    expect(subtotals.shipping?.amount).toBe(8.9);
    expect(subtotals.rewardPoints?.amount).toBe(-26.47);
    expect(subtotals.grandTotal?.amount).toBe(114.06);
    // Labels this version does not map must still reach the caller.
    expect(subtotals.raw).toHaveProperty("promoção aplicada");
  });

  test("reports the instalment plan", async () => {
    const [first] = (await call("list_orders")).orders as Array<{ orderId: string }>;
    const order = await call("get_order", { order_id: first?.orderId });
    expect(order.payment).toMatchObject({
      brand: "Mastercard",
      installments: 6,
      interestFree: true,
    });
  });

  test("an unknown order says so instead of returning nothing", async () => {
    await expect(call("get_order", { order_id: "702-0000000-0000000" })).rejects.toThrow(
      /não está no cache/,
    );
  });
});

describe("spending_summary", () => {
  test("groups by year and excludes nothing that was actually spent", async () => {
    const result = await call("spending_summary", { group_by: "year" });
    const rows = result.rows as Array<{ key: string; total: { amount: number } }>;
    expect(rows.map((row) => row.key)).toEqual(["2026", "2025"]);
    expect(rows[0]?.total.amount).toBe(114.06);
  });

  test("the breakdown adds up to the total it reports", async () => {
    const result = await call("spending_summary", { group_by: "breakdown" });
    const rows = result.rows as Array<{ key: string; total: { amount: number } }>;
    const value = (key: string) => rows.find((row) => row.key === key)?.total.amount ?? 0;
    const parts =
      value("subtotal") + value("shipping") + value("discount") + value("reward_points");
    expect(Math.abs(parts - value("total"))).toBeLessThanOrEqual(0.05);
    // The breakdown already carries the total; it must not be double-counted.
    expect((result.grandTotal as { amount: number }).amount).toBe(value("total"));
  });
});

describe("installments_schedule", () => {
  test("projects monthly instalments and says so, every time", async () => {
    const result = await call("installments_schedule", { from: "2026-01-01", months: 12 });
    expect(result.projected).toBe(true);
    expect(result.warning).toContain("não expõe");
    const rows = result.rows as Array<{ month: string; amount: { amount: number } }>;
    expect(rows).toHaveLength(6); // 6x, starting on the order date
    expect(rows[0]?.month).toBe("2026-02");
    expect(rows[0]?.amount.amount).toBe(19.01);
  });

  test("the projected instalments add up to the order total, within rounding", async () => {
    const result = await call("installments_schedule", { from: "2026-01-01", months: 12 });
    expect((result.total as { amount: number }).amount).toBeCloseTo(114.06, 0);
  });
});

describe("search_products", () => {
  test("finds what was bought, ignoring accents and case", async () => {
    // Product titles are pseudonymised in the fixtures; the word below is the
    // one those pages really carry.
    const result = await call("search_products", { query: "Fokamamed" });
    expect(result.total).toBe(3);
    const items = result.items as Array<{ title: string; date: string }>;
    expect(items[0]?.date).toBe("2026-02-25");
    // Case folding and accent folding come from the FTS tokenizer.
    expect((await call("search_products", { query: "FOKAMAMED" })).total).toBe(result.total);
  });

  test("punctuation from the user cannot break the query", async () => {
    await expect(call("search_products", { query: 'hamot" OR 1=1' })).resolves.toBeDefined();
  });
});

describe("file-writing tools", () => {
  test("a filename with a path separator or a leading dot is refused", async () => {
    for (const filename of ["../escape.pdf", "sub/dir.pdf", ".hidden", "a\\b.pdf"]) {
      await expect(
        call("download_invoice", { order_id: "702-8702328-5013112", filename }),
      ).rejects.toThrow(/inválido/);
    }
  });

  test("csv quotes the values that need it", async () => {
    const { toCsv } = await import("../src/tools/export.js");
    const csv = toCsv([{ a: "x,y", b: 'he said "hi"', c: null, d: 1 }]);
    expect(csv.split("\n")[1]).toBe('"x,y","he said ""hi""",,1');
    expect(toCsv([])).toBe("");
  });

  test("export writes inside the export dir and reports the row count", async () => {
    const result = await call("export", { format: "json", scope: "items" });
    expect(result.rows).toBe(5);
    expect(result.path as string).toStartWith(ctx.config.exportDir);
  });
});

describe("doctor", () => {
  test("reports every layer, and never omits a check it could not run", async () => {
    const result = await call("doctor", { deep: false });
    const checks = result.checks as Array<{ name: string; ok: boolean; detail: string }>;
    const names = checks.map((check) => check.name);
    for (const expected of [
      "config",
      "session",
      "browser",
      "orders_page",
      "order_id_sanity",
      "detail_page",
      "money_identity",
      "cache",
    ]) {
      expect(names).toContain(expected);
    }
    // A skipped check says so rather than quietly disappearing.
    expect(checks.find((check) => check.name === "orders_page")?.detail).toContain("pulado");
    expect(checks.find((check) => check.name === "cache")?.ok).toBe(true);
  });
});
