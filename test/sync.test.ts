import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { migrate } from "../src/cache/db.js";
import {
  META_CURSOR,
  META_LAST_FULL,
  PARSER_VERSION,
  runSyncChunk,
} from "../src/cache/sync.js";
import { loadConfig } from "../src/config.js";
import { type Ctx, createContext } from "../src/context.js";
import { AuthError, ParseError } from "../src/core/errors.js";
import type { PageLoader } from "../src/browser/transport.js";
import type { PageResult } from "../src/browser/types.js";
import { fixture, memorySession, sessionData, silentLogger } from "./helpers.js";

// The sync is driven by a loader that answers from the real (anonymised)
// fixtures, so the chunking logic is exercised against pages Amazon actually
// served — no browser, no network.

const config = loadConfig({ AMAZON_CONFIG_DIR: "/tmp/amz-sync" });

const ORDERS_2026 = fixture("orders-with-two.html");
const ORDERS_2025 = fixture("orders-single.html");
const EMPTY = fixture("orders-empty-year.html");
const DETAIL_A = fixture("detail-physical-2.html");
const DETAIL_B = fixture("detail-digital.html");

/** Serves a page per URL pattern and counts every load. */
function fakeLoader(overrides: Array<[RegExp, string | Error]> = []) {
  const calls: string[] = [];
  const routes: Array<[RegExp, string | Error]> = [
    ...overrides,
    [/timeFilter=year-2026/, ORDERS_2026],
    [/timeFilter=year-2025/, ORDERS_2025],
    [/timeFilter=/, EMPTY],
    [/orderID=D01/, DETAIL_B],
    [/orderID=/, DETAIL_A],
  ];
  const loader: PageLoader = {
    running: () => true,
    close: async () => undefined,
    pdf: async () => new Uint8Array(Buffer.from("%PDF-1.4 fake")),
    download: async () => new Uint8Array(Buffer.from("%PDF-1.4 fake")),
    load: async (url) => {
      calls.push(url);
      for (const [pattern, answer] of routes) {
        if (pattern.test(url)) {
          if (answer instanceof Error) throw answer;
          return { url, title: "t", html: answer } satisfies PageResult;
        }
      }
      throw new Error(`unrouted ${url}`);
    },
  };
  return { loader, calls };
}

function context(loader: PageLoader, db: Database): Ctx {
  return createContext(config, {
    db,
    loader,
    session: memorySession(sessionData()),
    log: silentLogger(),
    sleep: async () => undefined,
    // A fixed clock keeps the "current year" filter at 2026, where the fixtures live.
    now: () => Date.parse("2026-09-07T12:00:00Z"),
  });
}

function memoryDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

describe("full sync", () => {
  let db: Database;
  beforeEach(() => {
    db = memoryDb();
  });

  test("walks every year, then fills in the details", async () => {
    const { loader, calls } = fakeLoader();
    const ctx = context(loader, db);
    const report = await runSyncChunk(ctx, { mode: "full", maxRequests: 100 });

    expect(report.done).toBe(true);
    expect(report.mode).toBe("full");
    expect(report.ordersNew).toBe(3);
    expect(report.detailsFetched).toBeGreaterThan(0);
    expect(report.detailErrors).toBe(0);

    const cache = ctx.cache();
    expect(cache.stats().orders).toBe(3);
    // The list gave titles; the detail added the prices.
    const detailed = cache.getOrder(cache.listOrders({})[0]?.order_id as string);
    expect(detailed?.parser_version).toBe(PARSER_VERSION);
    expect(calls.some((url) => url.includes("summary/print.html"))).toBe(true);
  });

  test("respects the request budget and resumes exactly where it stopped", async () => {
    const first = fakeLoader();
    const ctx = context(first.loader, db);
    const chunk = await runSyncChunk(ctx, { mode: "full", maxRequests: 3 });

    expect(chunk.done).toBe(false);
    expect(chunk.requestsUsed).toBe(3);
    expect(chunk.hint).toContain("de novo");
    expect(ctx.cache().getMeta(META_CURSOR)).toBeString();

    // Keep going until it finishes; the total work is bounded.
    let guard = 0;
    let report = chunk;
    while (!report.done && guard++ < 20) {
      report = await runSyncChunk(ctx, { mode: "full", maxRequests: 3 });
    }
    expect(report.done).toBe(true);
    expect(ctx.cache().stats().orders).toBe(3);
    expect(ctx.cache().getMeta(META_CURSOR)).toBeUndefined();
  });

  test("running it twice does not duplicate anything", async () => {
    const ctx = context(fakeLoader().loader, db);
    await runSyncChunk(ctx, { mode: "full", maxRequests: 100 });
    const second = await runSyncChunk(ctx, { mode: "full", maxRequests: 100 });
    expect(second.ordersNew).toBe(0);
    expect(ctx.cache().stats().orders).toBe(3);
  });

  test("marks the full sync as completed, which unlocks incremental", async () => {
    const ctx = context(fakeLoader().loader, db);
    await runSyncChunk(ctx, { mode: "full", maxRequests: 100 });
    expect(ctx.cache().getMeta(META_LAST_FULL)).toBeString();

    const { loader, calls } = fakeLoader();
    const next = context(loader, db);
    const report = await runSyncChunk(next, { maxRequests: 100 });
    expect(report.mode).toBe("incremental");
    // Nothing new and every detail already cached: one page, and that is all.
    expect(calls).toHaveLength(1);
  });
});

describe("guards", () => {
  test("an incremental sync with no full sync behind it becomes full", async () => {
    const ctx = context(fakeLoader().loader, memoryDb());
    const report = await runSyncChunk(ctx, { mode: "incremental", maxRequests: 100 });
    // The history would otherwise keep a hole nobody notices.
    expect(report.mode).toBe("full");
  });

  test("a page this version cannot read parks that order and the run continues", async () => {
    const { loader } = fakeLoader([[/orderID=D01/, new ParseError("layout novo")]]);
    const ctx = context(loader, memoryDb());
    const report = await runSyncChunk(ctx, { mode: "full", maxRequests: 100 });

    expect(report.detailErrors).toBe(1);
    expect(report.detailsFetched).toBeGreaterThan(0);
    expect(report.warnings.join(" ")).toContain("layout novo");
    // Parked, so it does not block the queue forever.
    expect(report.done).toBe(true);
  });

  test("a dead session aborts the whole run instead of parking orders", async () => {
    const { loader } = fakeLoader([[/orderID=/, new AuthError("sessão expirou")]]);
    const ctx = context(loader, memoryDb());
    await expect(runSyncChunk(ctx, { mode: "full", maxRequests: 100 })).rejects.toThrow(AuthError);
  });
});

describe("reparse", () => {
  test("reprocesses the stored html with zero page loads", async () => {
    const db = memoryDb();
    const ctx = context(fakeLoader().loader, db);
    await runSyncChunk(ctx, { mode: "full", maxRequests: 100 });

    // Pretend the parser changed: the stored version no longer matches.
    db.query("UPDATE orders SET parser_version = 0 WHERE raw_html IS NOT NULL").run();

    const { loader, calls } = fakeLoader();
    const fresh = context(loader, db);
    const report = await runSyncChunk(fresh, { mode: "reparse" });

    expect(calls).toHaveLength(0);
    expect(report.reparsed).toBeGreaterThan(0);
    expect(report.done).toBe(true);
    expect(fresh.cache().toReparse(PARSER_VERSION)).toHaveLength(0);
  });
});

describe("settled orders", () => {
  test("an old order with no status text is not re-fetched forever", async () => {
    const db = memoryDb();
    const ctx = context(fakeLoader().loader, db);
    await runSyncChunk(ctx, { mode: "full", maxRequests: 100 });

    // Amazon strips the status from old orders, so they parse as "unknown".
    expect(ctx.cache().getOrder(ctx.cache().listOrders({})[0]?.order_id as string)?.status).toBe(
      "unknown",
    );
    // Make every detail stale: a naive TTL rule would queue them all again.
    db.query("UPDATE orders SET detail_fetched_at = '2000-01-01T00:00:00Z'").run();

    const { loader, calls } = fakeLoader();
    const next = context(loader, db);
    const report = await runSyncChunk(next, { maxRequests: 100 });
    expect(report.detailsFetched).toBe(0);
    expect(calls.filter((url) => url.includes("print.html"))).toHaveLength(0);
  });

  test("a recent order with an unknown status is still refreshed", () => {
    const db = memoryDb();
    const ctx = context(fakeLoader().loader, db);
    const cache = ctx.cache();
    cache.upsertSummary({
      orderId: "702-9999999-9999999",
      type: "physical",
      purchasedAt: "2026-09-01",
      purchasedAtText: null,
      totalCents: 1000,
      recipientName: null,
      shipmentStatusText: null,
      status: "unknown",
      items: [],
    });
    db.query("UPDATE orders SET detail_fetched_at = '2000-01-01T00:00:00Z'").run();
    const settled = new Date(Date.parse("2026-09-07T12:00:00Z") - 90 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(cache.pendingDetail("2026-09-07T00:00:00Z", 10, settled)).toContain(
      "702-9999999-9999999",
    );
  });
});
