import type { Database } from "bun:sqlite";
import { openDatabase } from "../core/sqlite.js";

// Schema and migrations. `PRAGMA user_version` is the whole ledger: the array
// index IS the version, so there is no migrations table and no filenames to
// keep in sync. Each migration and its version bump run in one transaction, so
// an interrupted upgrade rolls back cleanly.

export const SCHEMA_VERSION = 1;

/** Ordered and append-only: a released migration is NEVER edited. */
export const MIGRATIONS: string[] = [
  `
  /* v1 — orders, their items and shipments. Money is INTEGER CENTS. */
  CREATE TABLE orders (
    order_id             TEXT PRIMARY KEY,
    /* physical | digital — a D01- order is a subscription charge with no address. */
    order_type           TEXT NOT NULL,
    purchased_at         TEXT,
    /* The label as Amazon wrote it, kept when the date could not be parsed. */
    purchased_at_text    TEXT,

    /* From the list card. */
    total_cents          INTEGER,
    recipient_name       TEXT,

    /* From #od-subtotals on the printable summary. */
    items_subtotal_cents INTEGER,
    shipping_cents       INTEGER,
    discount_cents       INTEGER,
    reward_points_cents  INTEGER,
    gift_card_cents      INTEGER,
    tax_cents            INTEGER,
    grand_total_cents    INTEGER,
    /* Every label -> cents, including ones this version does not know. */
    subtotals_json       TEXT,

    status               TEXT NOT NULL DEFAULT 'unknown',
    status_text          TEXT,
    address_json         TEXT,

    payment_method       TEXT,
    card_brand           TEXT,
    card_last4           TEXT,
    installments         INTEGER,
    installment_cents    INTEGER,
    interest_free        INTEGER,
    payment_text         TEXT,

    invoice_links_json   TEXT,
    item_count           INTEGER NOT NULL DEFAULT 0,
    /* Accounting mismatches, surfaced instead of silently stored. */
    warnings             TEXT,

    source_url           TEXT,
    list_seen_at         TEXT,
    detail_fetched_at    TEXT,
    detail_error         TEXT,
    /* Gzipped post-decryption HTML, so a parser fix reparses without the network. */
    raw_html             BLOB,
    parser_version       INTEGER,
    updated_at           TEXT NOT NULL
  );

  CREATE TABLE order_items (
    order_id           TEXT NOT NULL,
    position           INTEGER NOT NULL,
    asin               TEXT,
    title              TEXT NOT NULL,
    quantity           INTEGER NOT NULL DEFAULT 1,
    unit_cents         INTEGER,
    line_cents         INTEGER,
    seller             TEXT,
    product_url        TEXT,
    image_url          TEXT,
    return_window_text TEXT,
    PRIMARY KEY (order_id, position),
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
  );

  CREATE TABLE shipments (
    order_id         TEXT NOT NULL,
    position         INTEGER NOT NULL,
    status_primary   TEXT,
    status_secondary TEXT,
    delivered_at     TEXT,
    PRIMARY KEY (order_id, position),
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
  );

  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

  CREATE INDEX idx_orders_date   ON orders(purchased_at DESC);
  CREATE INDEX idx_orders_status ON orders(status);
  CREATE INDEX idx_orders_type   ON orders(order_type);
  CREATE INDEX idx_items_order   ON order_items(order_id);
  CREATE INDEX idx_items_asin    ON order_items(asin);
  CREATE INDEX idx_items_seller  ON order_items(seller);

  /* remove_diacritics 2 is what makes "cafe" find "Café". */
  /* ponytail: a plain (not external-content) fts5 table, rebuilt after each
     sync. Switch to external content + triggers if this ever holds tens of
     thousands of items. */
  CREATE VIRTUAL TABLE order_items_fts USING fts5(
    title, seller, tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
];

export function migrate(db: Database): void {
  const { user_version: current } = db.query("PRAGMA user_version").get() as {
    user_version: number;
  };
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version] as string);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    })();
  }
}

export function openCache(path: string): Database {
  const db = openDatabase(path);
  migrate(db);
  return db;
}
