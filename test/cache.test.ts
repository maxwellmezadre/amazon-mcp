import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { MIGRATIONS, SCHEMA_VERSION, migrate, openCache } from "../src/cache/db.js";
import { type CacheRepo, createCacheRepo, ftsQuery } from "../src/cache/repo.js";
import type { OrderDetail, OrderSummary } from "../src/domain/types.js";

const NOW = 1_757_000_000_000;

function repo(): CacheRepo {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return createCacheRepo(db, () => NOW);
}

const summary = (overrides: Partial<OrderSummary> = {}): OrderSummary => ({
  orderId: "702-1234567-1234567",
  type: "physical",
  purchasedAt: "2024-12-22",
  purchasedAtText: "22 de dezembro de 2024",
  totalCents: 8766,
  recipientName: "Nome Exemplo",
  shipmentStatusText: "Entregue em 2 de dezembro",
  status: "delivered",
  items: [
    {
      position: 0,
      asin: "B09K2S2XK3",
      title: "Antitranspirante Aerossol",
      quantity: 3,
      unitCents: null,
      lineCents: null,
      seller: null,
      productUrl: "https://www.amazon.com.br/dp/B09K2S2XK3",
      imageUrl: null,
      returnWindowText: null,
    },
  ],
  ...overrides,
});

const detail = (overrides: Partial<OrderDetail> = {}): OrderDetail => ({
  orderId: "702-1234567-1234567",
  subtotals: {
    itemsSubtotalCents: 24680,
    shippingCents: 0,
    discountCents: null,
    rewardPointsCents: -96,
    giftCardCents: null,
    taxCents: null,
    grandTotalCents: 24584,
    raw: { "subtotal do(s) item(ns)": 24680, "total geral": 24584 },
  },
  items: [
    {
      position: 0,
      asin: "B09K2S2XK3",
      title: "Antitranspirante Aerossol",
      quantity: 3,
      unitCents: 8226,
      lineCents: 24680,
      seller: "Amazon.com.br",
      productUrl: "https://www.amazon.com.br/dp/B09K2S2XK3",
      imageUrl: null,
      returnWindowText: null,
    },
  ],
  shipments: [
    { position: 0, statusPrimary: "Entregue em 2 de dezembro", statusSecondary: null, deliveredAt: "2024-12-02" },
  ],
  payment: {
    method: "credit_card",
    brand: "Mastercard",
    last4: "1234",
    installments: 6,
    installmentCents: 4099,
    interestFree: true,
    raw: "Mastercard terminando em 1234 Em 6x de R$ 40,99 sem juros",
  },
  shipTo: {
    recipient: "Nome Exemplo",
    lines: ["Rua Exemplo, 123"],
    city: "Cidade Exemplo",
    state: "RS",
    postalCode: "00000-000",
    raw: "Nome Exemplo\nRua Exemplo, 123\nCidade Exemplo, RS 00000-000",
  },
  status: "delivered",
  statusText: "Entregue",
  warnings: [],
  sourceUrl: "https://www.amazon.com.br/gp/css/summary/print.html?orderID=702-1234567-1234567",
  ...overrides,
});

describe("migrations", () => {
  test("apply once and are idempotent", () => {
    const db = new Database(":memory:");
    migrate(db);
    const version = () =>
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    expect(version()).toBe(MIGRATIONS.length);
    expect(version()).toBe(SCHEMA_VERSION);
    migrate(db);
    expect(version()).toBe(SCHEMA_VERSION);
  });

  test("an in-memory cache opens with foreign keys on", () => {
    const db = openCache(":memory:");
    expect((db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
  });
});

describe("upsertSummary", () => {
  let cache: CacheRepo;
  beforeEach(() => {
    cache = repo();
  });

  test("inserts once and updates on the second pass", () => {
    expect(cache.upsertSummary(summary())).toEqual({ inserted: true, changed: false });
    expect(cache.upsertSummary(summary())).toEqual({ inserted: false, changed: false });
    expect(cache.countOrders({})).toBe(1);
    expect(cache.getItems("702-1234567-1234567")).toHaveLength(1);
  });

  test("reports a real change in status or total", () => {
    cache.upsertSummary(summary());
    expect(cache.upsertSummary(summary({ status: "shipped" })).changed).toBe(true);
  });

  test("never downgrades a known status when the list stops showing one", () => {
    cache.upsertSummary(summary({ status: "delivered" }));
    cache.upsertSummary(summary({ status: "unknown", shipmentStatusText: null }));
    expect(cache.getOrder("702-1234567-1234567")?.status).toBe("delivered");
  });

  test("never clobbers the detail columns the list does not have", () => {
    cache.upsertSummary(summary());
    cache.upsertDetail(detail(), null, 1);
    cache.upsertSummary(summary());

    const order = cache.getOrder("702-1234567-1234567");
    expect(order?.grand_total_cents).toBe(24584);
    expect(order?.card_last4).toBe("1234");
    expect(order?.installments).toBe(6);
    expect(cache.getItems("702-1234567-1234567")[0]?.unit_cents).toBe(8226);
    expect(cache.getItems("702-1234567-1234567")[0]?.seller).toBe("Amazon.com.br");
  });
});

describe("upsertDetail", () => {
  let cache: CacheRepo;
  beforeEach(() => {
    cache = repo();
    cache.upsertSummary(summary());
  });

  test("stores every subtotal, including the raw label map", () => {
    cache.upsertDetail(detail(), null, 2);
    const order = cache.getOrder("702-1234567-1234567");
    expect(order).toMatchObject({
      items_subtotal_cents: 24680,
      reward_points_cents: -96,
      grand_total_cents: 24584,
      interest_free: 1,
      parser_version: 2,
    });
    expect(JSON.parse(order?.subtotals_json as string)).toHaveProperty("total geral", 24584);
  });

  test("replaces shipments rather than accumulating them", () => {
    cache.upsertDetail(detail(), null, 1);
    cache.upsertDetail(detail(), null, 1);
    expect(cache.getShipments("702-1234567-1234567")).toHaveLength(1);
  });

  test("keeps the gzipped html for an offline reparse", () => {
    const html = Bun.gzipSync(Buffer.from("<html>oi</html>"));
    cache.upsertDetail(detail(), html, 1);
    const stored = cache.getRawHtml("702-1234567-1234567");
    expect(Buffer.from(Bun.gunzipSync(Buffer.from(stored!))).toString()).toBe("<html>oi</html>");
    expect(cache.toReparse(2)).toHaveLength(1);
    expect(cache.toReparse(1)).toHaveLength(0);
  });

  test("records warnings so a broken sum is visible, not silent", () => {
    cache.upsertDetail(detail({ warnings: ["subtotais não fecham"] }), null, 1);
    expect(JSON.parse(cache.getOrder("702-1234567-1234567")?.warnings as string)).toEqual([
      "subtotais não fecham",
    ]);
  });
});

describe("detail queue", () => {
  test("a final order is never fetched twice, a live one is refetched when stale", () => {
    const cache = repo();
    cache.upsertSummary(summary({ orderId: "702-0000001-0000001", status: "delivered" }));
    cache.upsertSummary(summary({ orderId: "702-0000002-0000002", status: "shipped" }));
    expect(cache.pendingDetail("2026-01-01T00:00:00Z", 10)).toHaveLength(2);

    cache.upsertDetail(detail({ orderId: "702-0000001-0000001" }), null, 1);
    cache.upsertDetail(detail({ orderId: "702-0000002-0000002", status: "shipped" }), null, 1);
    // Nothing is stale yet.
    expect(cache.pendingDetail("2000-01-01T00:00:00Z", 10)).toEqual([]);
    // Everything is stale: only the non-final order comes back.
    expect(cache.pendingDetail("2999-01-01T00:00:00Z", 10)).toEqual(["702-0000002-0000002"]);
  });

  test("a parked order stays out of the queue until the errors are reset", () => {
    const cache = repo();
    cache.upsertSummary(summary());
    cache.markDetailError("702-1234567-1234567", "layout mudou");
    expect(cache.pendingDetailCount("2999-01-01T00:00:00Z")).toBe(0);
    expect(cache.resetDetailErrors()).toBe(1);
    expect(cache.pendingDetailCount("2999-01-01T00:00:00Z")).toBe(1);
  });
});

describe("queries", () => {
  let cache: CacheRepo;
  beforeEach(() => {
    cache = repo();
    cache.upsertSummary(
      summary({ orderId: "702-0000001-0000001", purchasedAt: "2024-07-20", totalCents: 15900 }),
    );
    cache.upsertSummary(
      summary({ orderId: "702-0000002-0000002", purchasedAt: "2025-03-05", totalCents: 95880 }),
    );
    cache.upsertSummary(
      summary({
        orderId: "D01-0000003-0000003",
        type: "digital",
        purchasedAt: "2025-03-20",
        totalCents: 1490,
        status: "cancelled",
      }),
    );
    cache.upsertDetail(
      detail({ orderId: "702-0000002-0000002", subtotals: { ...detail().subtotals, grandTotalCents: 95880 } }),
      null,
      1,
    );
    cache.rebuildFts();
  });

  test("cancelled orders are excluded from spending by default", () => {
    expect(cache.countOrders({})).toBe(2);
    expect(cache.countOrders({ includeCancelled: true })).toBe(3);
    // An explicit status filter means the caller knows what they asked for.
    expect(cache.countOrders({ status: "cancelled" })).toBe(1);
  });

  test("filters by date, type, total and instalments", () => {
    expect(cache.listOrders({ from: "2025-01-01" }).map((row) => row.order_id)).toEqual([
      "702-0000002-0000002",
    ]);
    expect(cache.countOrders({ type: "digital", includeCancelled: true })).toBe(1);
    expect(cache.countOrders({ minTotalCents: 20000 })).toBe(1);
    expect(cache.countOrders({ hasInstallments: true })).toBe(1);
    expect(cache.countOrders({ seller: "amazon.com.br" })).toBe(1);
  });

  test("sorts by date and by total", () => {
    expect(cache.listOrders({ sort: "date_asc" })[0]?.order_id).toBe("702-0000001-0000001");
    expect(cache.listOrders({ sort: "total_desc" })[0]?.order_id).toBe("702-0000002-0000002");
  });

  test("full text search ignores accents and quotes user input", () => {
    expect(cache.searchItems("antitranspirante", {})).not.toHaveLength(0);
    expect(cache.searchItems("ANTITRANSPIRANTE", {})).not.toHaveLength(0);
    expect(ftsQuery('cabo " OR 1=1')).toBe('"cabo" "OR" "1=1"');
    // Punctuation must not blow up the query.
    expect(() => cache.searchItems('aerossol"', {})).not.toThrow();
  });

  test("spending groups by month, year and payment method", () => {
    const byMonth = cache.spending("month", {});
    expect(byMonth.map((row) => row.key)).toEqual(["2025-03", "2024-07"]);
    expect(byMonth.find((row) => row.key === "2024-07")?.totalCents).toBe(15900);
    expect(cache.spending("year", {}).map((row) => row.key)).toEqual(["2025", "2024"]);
    expect(cache.spending("payment_method", {}).map((row) => row.key)).toContain("credit_card");
  });

  test("the breakdown sums the labelled subtotals over the period", () => {
    const rows = cache.spending("breakdown", {});
    expect(rows.find((row) => row.key === "subtotal")?.totalCents).toBe(24680);
    expect(rows.find((row) => row.key === "reward_points")?.totalCents).toBe(-96);
    // Zero-valued lines are not reported as if they were facts.
    expect(rows.find((row) => row.key === "tax")).toBeUndefined();
  });

  test("stats reports what still needs a detail pass", () => {
    expect(cache.stats()).toMatchObject({ orders: 3, withDetail: 1, pendingDetail: 2 });
  });

  test("meta round trips and deletes", () => {
    cache.setMeta("sync.cursor", '{"page":2}');
    expect(cache.getMeta("sync.cursor")).toBe('{"page":2}');
    cache.setMeta("sync.cursor", null);
    expect(cache.getMeta("sync.cursor")).toBeUndefined();
  });
});
