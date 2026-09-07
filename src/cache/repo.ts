import type { Database } from "bun:sqlite";
import { Where, escapeLike, inTx } from "../core/sqlite.js";
import type { OrderDetail, OrderSummary, OrderType } from "../domain/types.js";
import type { OrderStatus } from "../domain/status.js";

// All SQL lives here. Callers pass and receive domain values; money crosses this
// boundary as integer cents and only becomes a decimal in rows.ts.

export type OrderRow = {
  order_id: string;
  order_type: string;
  purchased_at: string | null;
  purchased_at_text: string | null;
  total_cents: number | null;
  recipient_name: string | null;
  items_subtotal_cents: number | null;
  shipping_cents: number | null;
  discount_cents: number | null;
  reward_points_cents: number | null;
  gift_card_cents: number | null;
  tax_cents: number | null;
  grand_total_cents: number | null;
  subtotals_json: string | null;
  status: string;
  status_text: string | null;
  address_json: string | null;
  payment_method: string | null;
  card_brand: string | null;
  card_last4: string | null;
  installments: number | null;
  installment_cents: number | null;
  interest_free: number | null;
  payment_text: string | null;
  invoice_links_json: string | null;
  item_count: number;
  warnings: string | null;
  source_url: string | null;
  list_seen_at: string | null;
  detail_fetched_at: string | null;
  detail_error: string | null;
  parser_version: number | null;
  updated_at: string;
};

export type ItemRow = {
  order_id: string;
  position: number;
  asin: string | null;
  title: string;
  quantity: number;
  unit_cents: number | null;
  line_cents: number | null;
  seller: string | null;
  product_url: string | null;
  image_url: string | null;
  return_window_text: string | null;
};

export type ShipmentRow = {
  order_id: string;
  position: number;
  status_primary: string | null;
  status_secondary: string | null;
  delivered_at: string | null;
};

export type OrderFilters = {
  from?: string;
  to?: string;
  status?: OrderStatus;
  type?: OrderType;
  seller?: string;
  minTotalCents?: number;
  maxTotalCents?: number;
  hasInstallments?: boolean;
  includeCancelled?: boolean;
  sort?: "date_desc" | "date_asc" | "total_desc" | "total_asc";
  limit?: number;
  offset?: number;
};

export type SpendingGroup = "month" | "year" | "seller" | "payment_method" | "type" | "breakdown";
export type SpendingRow = { key: string; orders: number; items: number; totalCents: number };

export type CacheStats = {
  orders: number;
  items: number;
  withDetail: number;
  pendingDetail: number;
  detailErrors: number;
  oldestOrder: string | null;
  newestOrder: string | null;
};

/** Cancelled orders are money that was not spent; excluded unless asked for. */
const SPENDABLE = "o.status <> 'cancelled'";

const SORTS: Record<NonNullable<OrderFilters["sort"]>, string> = {
  date_desc: "o.purchased_at DESC, o.order_id DESC",
  date_asc: "o.purchased_at ASC, o.order_id ASC",
  total_desc: "COALESCE(o.grand_total_cents, o.total_cents) DESC",
  total_asc: "COALESCE(o.grand_total_cents, o.total_cents) ASC",
};

export type CacheRepo = ReturnType<typeof createCacheRepo>;

export function createCacheRepo(db: Database, now: () => number) {
  const stamp = () => new Date(now()).toISOString();

  function filters(input: OrderFilters): Where {
    const where = new Where();
    where.maybe(input.from, "o.purchased_at >= ?", input.from);
    where.maybe(input.to, "o.purchased_at <= ?", input.to);
    where.maybe(input.status, "o.status = ?", input.status);
    where.maybe(input.type, "o.order_type = ?", input.type);
    where.maybe(input.minTotalCents, "COALESCE(o.grand_total_cents, o.total_cents) >= ?", input.minTotalCents);
    where.maybe(input.maxTotalCents, "COALESCE(o.grand_total_cents, o.total_cents) <= ?", input.maxTotalCents);
    if (input.hasInstallments === true) where.add("o.installments > 1");
    if (input.hasInstallments === false) where.add("COALESCE(o.installments, 1) <= 1");
    if (input.seller) {
      where.add(
        "EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.order_id AND i.seller LIKE ? ESCAPE '\\')",
        `%${escapeLike(input.seller)}%`,
      );
    }
    // An explicit status filter means the caller knows what they asked for.
    if (!input.includeCancelled && !input.status) where.add(SPENDABLE);
    return where;
  }

  return {
    /**
     * Upsert from a LIST card. It must never clobber the detail-only columns:
     * the list has no unit prices, no payment and no address, and a re-listed
     * order would otherwise erase what the detail page filled in.
     */
    upsertSummary(order: OrderSummary): { inserted: boolean; changed: boolean } {
      return inTx(db, () => {
        const before = db
          .query("SELECT status, total_cents FROM orders WHERE order_id = ?")
          .get(order.orderId) as { status: string; total_cents: number | null } | null;

        db.query(
          `INSERT INTO orders (
             order_id, order_type, purchased_at, purchased_at_text, total_cents,
             recipient_name, status, status_text, item_count, list_seen_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(order_id) DO UPDATE SET
             order_type = excluded.order_type,
             purchased_at = COALESCE(excluded.purchased_at, orders.purchased_at),
             purchased_at_text = COALESCE(excluded.purchased_at_text, orders.purchased_at_text),
             total_cents = COALESCE(excluded.total_cents, orders.total_cents),
             recipient_name = COALESCE(excluded.recipient_name, orders.recipient_name),
             /* The list drops the status text on old orders; never downgrade a
                known status to 'unknown' because of that. */
             status = CASE WHEN excluded.status = 'unknown' THEN orders.status ELSE excluded.status END,
             status_text = COALESCE(excluded.status_text, orders.status_text),
             item_count = MAX(excluded.item_count, orders.item_count),
             list_seen_at = excluded.list_seen_at,
             updated_at = excluded.updated_at`,
        ).run(
          order.orderId,
          order.type,
          order.purchasedAt,
          order.purchasedAtText,
          order.totalCents,
          order.recipientName,
          order.status,
          order.shipmentStatusText,
          order.items.length,
          stamp(),
          stamp(),
        );

        // Items from the list carry title/asin/quantity but no price; a later
        // detail pass fills those in on the same (order_id, position) key.
        for (const item of order.items) {
          db.query(
            `INSERT INTO order_items (order_id, position, asin, title, quantity, product_url, image_url)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(order_id, position) DO UPDATE SET
               asin = COALESCE(excluded.asin, order_items.asin),
               title = excluded.title,
               quantity = excluded.quantity,
               product_url = COALESCE(excluded.product_url, order_items.product_url),
               image_url = COALESCE(excluded.image_url, order_items.image_url)`,
          ).run(
            order.orderId,
            item.position,
            item.asin,
            item.title,
            item.quantity,
            item.productUrl,
            item.imageUrl,
          );
        }

        return {
          inserted: before === null,
          changed:
            before !== null &&
            (before.status !== order.status || before.total_cents !== order.totalCents),
        };
      });
    },

    /** Upsert from the printable summary: prices, payment, address, subtotals. */
    upsertDetail(detail: OrderDetail, rawHtml: Uint8Array | null, parserVersion: number): void {
      inTx(db, () => {
        const { subtotals: sums, payment } = detail;
        db.query(
          `UPDATE orders SET
             items_subtotal_cents = ?, shipping_cents = ?, discount_cents = ?,
             reward_points_cents = ?, gift_card_cents = ?, tax_cents = ?,
             grand_total_cents = ?, subtotals_json = ?,
             status = CASE WHEN ? = 'unknown' THEN status ELSE ? END,
             status_text = COALESCE(?, status_text),
             address_json = ?,
             payment_method = ?, card_brand = ?, card_last4 = ?,
             installments = ?, installment_cents = ?, interest_free = ?, payment_text = ?,
             item_count = MAX(?, item_count),
             warnings = ?, source_url = ?, detail_fetched_at = ?, detail_error = NULL,
             raw_html = ?, parser_version = ?, updated_at = ?
           WHERE order_id = ?`,
        ).run(
          sums.itemsSubtotalCents,
          sums.shippingCents,
          sums.discountCents,
          sums.rewardPointsCents,
          sums.giftCardCents,
          sums.taxCents,
          sums.grandTotalCents,
          JSON.stringify(sums.raw),
          detail.status,
          detail.status,
          detail.statusText,
          detail.shipTo ? JSON.stringify(detail.shipTo) : null,
          payment?.method ?? null,
          payment?.brand ?? null,
          payment?.last4 ?? null,
          payment?.installments ?? null,
          payment?.installmentCents ?? null,
          payment?.interestFree === null || payment?.interestFree === undefined
            ? null
            : payment.interestFree
              ? 1
              : 0,
          payment?.raw ?? null,
          detail.items.length,
          detail.warnings.length > 0 ? JSON.stringify(detail.warnings) : null,
          detail.sourceUrl,
          stamp(),
          rawHtml,
          parserVersion,
          stamp(),
          detail.orderId,
        );

        for (const item of detail.items) {
          db.query(
            `INSERT INTO order_items
               (order_id, position, asin, title, quantity, unit_cents, line_cents, seller,
                product_url, image_url, return_window_text)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(order_id, position) DO UPDATE SET
               asin = COALESCE(excluded.asin, order_items.asin),
               title = excluded.title,
               quantity = excluded.quantity,
               unit_cents = COALESCE(excluded.unit_cents, order_items.unit_cents),
               line_cents = COALESCE(excluded.line_cents, order_items.line_cents),
               seller = COALESCE(excluded.seller, order_items.seller),
               product_url = COALESCE(excluded.product_url, order_items.product_url),
               image_url = COALESCE(excluded.image_url, order_items.image_url),
               return_window_text = COALESCE(excluded.return_window_text, order_items.return_window_text)`,
          ).run(
            detail.orderId,
            item.position,
            item.asin,
            item.title,
            item.quantity,
            item.unitCents,
            item.lineCents,
            item.seller,
            item.productUrl,
            item.imageUrl,
            item.returnWindowText,
          );
        }

        db.query("DELETE FROM shipments WHERE order_id = ?").run(detail.orderId);
        for (const shipment of detail.shipments) {
          db.query(
            `INSERT INTO shipments (order_id, position, status_primary, status_secondary, delivered_at)
             VALUES (?, ?, ?, ?, ?)`,
          ).run(
            detail.orderId,
            shipment.position,
            shipment.statusPrimary,
            shipment.statusSecondary,
            shipment.deliveredAt,
          );
        }
      });
    },

    markDetailError(orderId: string, message: string): void {
      db.query("UPDATE orders SET detail_error = ?, updated_at = ? WHERE order_id = ?").run(
        message,
        stamp(),
        orderId,
      );
    },

    setInvoiceLinks(orderId: string, links: unknown): void {
      db.query("UPDATE orders SET invoice_links_json = ?, updated_at = ? WHERE order_id = ?").run(
        JSON.stringify(links),
        stamp(),
        orderId,
      );
    },

    /**
     * Orders still needing their detail page: never fetched, or not final and
     * older than the TTL. A delivered or cancelled order can no longer change,
     * so it is never fetched twice.
     */
    pendingDetail(staleBefore: string, limit: number): string[] {
      return (
        db
          .query(
            `SELECT order_id FROM orders
             WHERE detail_error IS NULL
               AND (detail_fetched_at IS NULL
                    OR (status NOT IN ('delivered','cancelled','returned') AND detail_fetched_at < ?))
             ORDER BY purchased_at DESC
             LIMIT ?`,
          )
          .all(staleBefore, limit) as { order_id: string }[]
      ).map((row) => row.order_id);
    },

    pendingDetailCount(staleBefore: string): number {
      const row = db
        .query(
          `SELECT COUNT(*) AS n FROM orders
           WHERE detail_error IS NULL
             AND (detail_fetched_at IS NULL
                  OR (status NOT IN ('delivered','cancelled','returned') AND detail_fetched_at < ?))`,
        )
        .get(staleBefore) as { n: number };
      return row.n;
    },

    /** Orders whose stored HTML was parsed by an older version. */
    toReparse(parserVersion: number): Array<{ order_id: string; raw_html: Uint8Array }> {
      return db
        .query(
          `SELECT order_id, raw_html FROM orders
           WHERE raw_html IS NOT NULL AND COALESCE(parser_version, 0) <> ?`,
        )
        .all(parserVersion) as Array<{ order_id: string; raw_html: Uint8Array }>;
    },

    resetDetailErrors(): number {
      return db.query("UPDATE orders SET detail_error = NULL WHERE detail_error IS NOT NULL").run()
        .changes as number;
    },

    getOrder: (orderId: string): OrderRow | null =>
      (db.query("SELECT * FROM orders WHERE order_id = ?").get(orderId) as OrderRow) ?? null,

    getRawHtml: (orderId: string): Uint8Array | null =>
      (db.query("SELECT raw_html FROM orders WHERE order_id = ?").get(orderId) as {
        raw_html: Uint8Array | null;
      } | null)?.raw_html ?? null,

    getItems: (orderId: string): ItemRow[] =>
      db
        .query("SELECT * FROM order_items WHERE order_id = ? ORDER BY position")
        .all(orderId) as ItemRow[],

    getShipments: (orderId: string): ShipmentRow[] =>
      db
        .query("SELECT * FROM shipments WHERE order_id = ? ORDER BY position")
        .all(orderId) as ShipmentRow[],

    listOrders(input: OrderFilters): OrderRow[] {
      const where = filters(input);
      return db
        .query(
          `SELECT o.* FROM orders o ${where.sql()}
           ORDER BY ${SORTS[input.sort ?? "date_desc"]}
           LIMIT ? OFFSET ?`,
        )
        .all(...where.values, input.limit ?? 50, input.offset ?? 0) as OrderRow[];
    },

    countOrders(input: OrderFilters): number {
      const where = filters(input);
      const row = db
        .query(`SELECT COUNT(*) AS n FROM orders o ${where.sql()}`)
        .get(...where.values) as { n: number };
      return row.n;
    },

    /** Full-text search over what was actually bought. */
    searchItems(
      query: string,
      input: { from?: string; to?: string; limit?: number },
    ): Array<ItemRow & { purchased_at: string | null; status: string }> {
      const where = new Where().add(
        "i.rowid IN (SELECT rowid FROM order_items_fts WHERE order_items_fts MATCH ?)",
        ftsQuery(query),
      );
      where.maybe(input.from, "o.purchased_at >= ?", input.from);
      where.maybe(input.to, "o.purchased_at <= ?", input.to);
      return db
        .query(
          `SELECT i.*, o.purchased_at, o.status
           FROM order_items i JOIN orders o ON o.order_id = i.order_id
           ${where.sql()}
           ORDER BY o.purchased_at DESC
           LIMIT ?`,
        )
        .all(...where.values, input.limit ?? 30) as Array<
        ItemRow & { purchased_at: string | null; status: string }
      >;
    },

    /** FTS5 is a plain table here, so it is rebuilt wholesale after a sync. */
    rebuildFts(): void {
      inTx(db, () => {
        db.exec("DELETE FROM order_items_fts");
        db.exec(
          `INSERT INTO order_items_fts (rowid, title, seller)
           SELECT rowid, title, COALESCE(seller, '') FROM order_items`,
        );
      });
    },

    spending(group: SpendingGroup, input: OrderFilters): SpendingRow[] {
      const where = filters(input);
      const keys: Record<SpendingGroup, string> = {
        month: "substr(o.purchased_at, 1, 7)",
        year: "substr(o.purchased_at, 1, 4)",
        seller: "COALESCE((SELECT i.seller FROM order_items i WHERE i.order_id = o.order_id AND i.seller IS NOT NULL LIMIT 1), 'desconhecido')",
        payment_method: "COALESCE(o.payment_method, 'desconhecido')",
        type: "o.order_type",
        breakdown: "'total'",
      };
      if (group === "breakdown") return breakdown(db, where);
      return db
        .query(
          `SELECT ${keys[group]} AS key,
                  COUNT(*) AS orders,
                  SUM(o.item_count) AS items,
                  SUM(COALESCE(o.grand_total_cents, o.total_cents)) AS totalCents
           FROM orders o ${where.sql()}
           GROUP BY key
           ORDER BY key DESC`,
        )
        .all(...where.values) as SpendingRow[];
    },

    getMeta: (key: string): string | undefined =>
      (db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null)
        ?.value,

    setMeta(key: string, value: string | null): void {
      if (value === null) {
        db.query("DELETE FROM meta WHERE key = ?").run(key);
        return;
      }
      db.query(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(key, value);
    },

    stats(): CacheStats {
      const row = db
        .query(
          `SELECT
             (SELECT COUNT(*) FROM orders) AS orders,
             (SELECT COUNT(*) FROM order_items) AS items,
             (SELECT COUNT(*) FROM orders WHERE detail_fetched_at IS NOT NULL) AS withDetail,
             (SELECT COUNT(*) FROM orders WHERE detail_fetched_at IS NULL AND detail_error IS NULL) AS pendingDetail,
             (SELECT COUNT(*) FROM orders WHERE detail_error IS NOT NULL) AS detailErrors,
             (SELECT MIN(purchased_at) FROM orders) AS oldestOrder,
             (SELECT MAX(purchased_at) FROM orders) AS newestOrder`,
        )
        .get() as CacheStats;
      return row;
    },
  };
}

/** Sums the per-label subtotals over the period: tax, shipping, discounts. */
function breakdown(db: Database, where: Where): SpendingRow[] {
  const row = db
    .query(
      `SELECT
         COUNT(*) AS orders,
         SUM(COALESCE(o.items_subtotal_cents, 0)) AS itemsSubtotal,
         SUM(COALESCE(o.shipping_cents, 0)) AS shipping,
         SUM(COALESCE(o.discount_cents, 0)) AS discount,
         SUM(COALESCE(o.reward_points_cents, 0)) AS rewardPoints,
         SUM(COALESCE(o.gift_card_cents, 0)) AS giftCard,
         SUM(COALESCE(o.tax_cents, 0)) AS tax,
         SUM(COALESCE(o.grand_total_cents, o.total_cents)) AS total
       FROM orders o ${where.sql()}`,
    )
    .get(...where.values) as Record<string, number | null>;
  const orders = row.orders ?? 0;
  return (
    [
      ["subtotal", row.itemsSubtotal],
      ["shipping", row.shipping],
      ["discount", row.discount],
      ["reward_points", row.rewardPoints],
      ["gift_card", row.giftCard],
      ["tax", row.tax],
      ["total", row.total],
    ] as const
  )
    .filter(([, cents]) => cents !== null && cents !== 0)
    .map(([key, cents]) => ({ key, orders, items: 0, totalCents: cents as number }));
}

/**
 * Quotes each term so a user's punctuation cannot break FTS5 syntax — an
 * unbalanced quote or a bare `AND` would otherwise throw instead of searching.
 */
export function ftsQuery(query: string): string {
  const terms = query
    .split(/\s+/)
    .map((term) => term.replace(/"/g, ""))
    .filter((term) => term.length > 0);
  return terms.map((term) => `"${term}"`).join(" ");
}
