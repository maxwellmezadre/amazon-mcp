import { parseOrderDetail } from "../amazon/detail.js";
import { parseOrdersPage } from "../amazon/list.js";
import {
  DETAIL_READY,
  ORDERS_READY,
  ORDERS_READY_EXPRESSION,
  orderDetailPath,
  ordersPath,
} from "../amazon/urls.js";
import type { Ctx } from "../context.js";
import { AuthError, CaptchaError, CsdError, ParseError } from "../core/errors.js";
import { sessionIdOf } from "../session/jar.js";

// Fills the local cache in resumable chunks. Every read tool answers from
// SQLite, so this is the only thing that ever touches the network, and it is
// budgeted: one call spends at most `maxRequests` page loads and hands back a
// cursor, so a tool call never outlives the client's timeout.

/** Bump when a parser changes what it extracts; stored pages are reparsed. */
export const PARSER_VERSION = 1;

export const META_CURSOR = "sync.cursor";
export const META_LAST_SYNC = "sync.last_completed_at";
export const META_LAST_FULL = "sync.last_full_at";
export const META_FILTERS = "sync.filters";

/** A live order may still change; a delivered one cannot. */
export const DETAIL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Past this age an order is treated as settled even when its status is unknown.
 * Amazon removes the status text from old orders, so they never parse as
 * "delivered" and would otherwise be re-fetched forever.
 */
export const SETTLED_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

export type SyncMode = "incremental" | "full" | "reparse";

export type SyncOptions = {
  mode?: SyncMode;
  maxRequests?: number;
  withDetails?: boolean;
  /** Sync a single period, e.g. "year-2024". */
  year?: string;
};

export type SyncReport = {
  done: boolean;
  mode: SyncMode;
  requestsUsed: number;
  pagesFetched: number;
  ordersSeen: number;
  ordersNew: number;
  ordersChanged: number;
  detailsFetched: number;
  detailErrors: number;
  pendingDetails: number;
  reparsed: number;
  durationMs: number;
  warnings: string[];
  hint?: string;
};

/**
 * Resume point. `listDone` is persisted rather than inferred from the cursor
 * being absent: when the list finishes on the last request of a chunk, the next
 * chunk must go straight to the detail queue instead of walking every year again.
 */
type Cursor = { filters: string[]; index: number; page: number; listDone: boolean };

export async function runSyncChunk(ctx: Ctx, options: SyncOptions = {}): Promise<SyncReport> {
  const started = ctx.now();
  const cache = ctx.cache();
  const budget = options.maxRequests ?? 15;
  const withDetails = options.withDetails ?? true;
  const mode = resolveMode(ctx, options);

  const report: SyncReport = {
    done: false,
    mode,
    requestsUsed: 0,
    pagesFetched: 0,
    ordersSeen: 0,
    ordersNew: 0,
    ordersChanged: 0,
    detailsFetched: 0,
    detailErrors: 0,
    pendingDetails: 0,
    reparsed: 0,
    durationMs: 0,
    warnings: [],
  };

  if (mode === "reparse") {
    reparseAll(ctx, report);
    finish(ctx, report, started, true);
    return report;
  }

  const sessionId = sessionIdOf(ctx.session.load()?.cookies ?? []);
  let cursor = loadCursor(cache.getMeta(META_CURSOR));
  // `cursor === null` alone is ambiguous: it means both "not started" and
  // "finished". Tracking the two separately is what keeps the walk from
  // restarting itself forever.
  let bootstrapped = cursor !== null;
  let listDone = cursor?.listDone ?? false;

  // Phase A — the order lists, one page per request, resumable by cursor.
  while (report.requestsUsed < budget && !listDone) {
    if (!bootstrapped) {
      const first = await fetchList(ctx, options.year ?? currentYearFilter(ctx), sessionId);
      report.requestsUsed += 1;
      report.pagesFetched += 1;
      apply(ctx, first.orders, report);
      cache.setMeta(META_FILTERS, JSON.stringify(first.filters));
      bootstrapped = true;

      if (mode === "incremental" && report.ordersNew === 0) {
        // Nothing new on the newest page: the rest is already known.
        listDone = true;
        break;
      }

      const filters = options.year
        ? [options.year]
        : mode === "full"
          ? first.filters.filter((filter) => filter.startsWith("year-"))
          : [currentYearFilter(ctx)];
      cursor = { filters, index: 0, page: 2, listDone: false };
      // The current year's page 1 is already done; skip to page 2 or move on.
      if (!first.hasMore) {
        const next = advance(cursor);
        if (next === null) listDone = true;
        else cursor = next;
      }
      continue;
    }

    const filter = cursor?.filters[cursor.index];
    if (cursor === null || filter === undefined) {
      listDone = true;
      break;
    }
    // Page 1 of the period the bootstrap already covered.
    if (cursor.page === 1 && filter === (options.year ?? currentYearFilter(ctx))) {
      const next = advance(cursor);
      if (next === null) {
        listDone = true;
        break;
      }
      cursor = next;
      continue;
    }

    const page = await fetchList(ctx, filter, sessionId, cursor.page);
    report.requestsUsed += 1;
    report.pagesFetched += 1;
    const before = report.ordersNew;
    apply(ctx, page.orders, report);

    if (page.hasMore) {
      cursor = { ...cursor, page: cursor.page + 1 };
    } else if (mode === "incremental" && report.ordersNew === before) {
      listDone = true;
    } else {
      const next = advance(cursor);
      if (next === null) listDone = true;
      else cursor = next;
    }
  }

  // Keep the resume point until BOTH phases are done.
  if (cursor !== null) cursor = { ...cursor, listDone };
  else if (listDone) cursor = { filters: [], index: 0, page: 1, listDone: true };

  // Phase B — the detail pages, which is where the prices and payment live.
  if (withDetails && listDone) {
    const staleBefore = new Date(ctx.now() - DETAIL_TTL_MS).toISOString();
    const settledBefore = new Date(ctx.now() - SETTLED_AFTER_MS).toISOString().slice(0, 10);
    while (report.requestsUsed < budget) {
      const [orderId] = cache.pendingDetail(staleBefore, 1, settledBefore);
      if (!orderId) break;
      report.requestsUsed += 1;
      try {
        await fetchDetail(ctx, orderId, report);
      } catch (error) {
        // A dead session or a challenge stops everything; a page this version
        // cannot read parks that one order and the run carries on.
        if (error instanceof AuthError || error instanceof CaptchaError) throw error;
        if (error instanceof ParseError || error instanceof CsdError) {
          cache.markDetailError(orderId, (error as Error).message);
          report.detailErrors += 1;
          report.warnings.push(`detalhe de ${orderId}: ${(error as Error).message}`);
          continue;
        }
        throw error;
      }
    }
    report.pendingDetails = cache.pendingDetailCount(staleBefore, settledBefore);
  } else if (withDetails) {
    report.pendingDetails = cache.pendingDetailCount(
      new Date(ctx.now() - DETAIL_TTL_MS).toISOString(),
      new Date(ctx.now() - SETTLED_AFTER_MS).toISOString().slice(0, 10),
    );
  }

  const done = listDone && (!withDetails || report.pendingDetails === 0);
  cache.setMeta(META_CURSOR, done ? null : JSON.stringify(cursor));
  finish(ctx, report, started, done);
  return report;
}

function finish(ctx: Ctx, report: SyncReport, started: number, done: boolean): void {
  const cache = ctx.cache();
  report.done = done;
  report.durationMs = ctx.now() - started;
  if (done) {
    cache.rebuildFts();
    cache.setMeta(META_CURSOR, null);
    cache.setMeta(META_LAST_SYNC, new Date(ctx.now()).toISOString());
    if (report.mode === "full") cache.setMeta(META_LAST_FULL, new Date(ctx.now()).toISOString());
  } else {
    report.hint = "Chame `sync` de novo para continuar de onde parou.";
  }
}

/**
 * An incremental sync only makes sense on top of a completed full one;
 * otherwise the history keeps a hole nobody notices. An interrupted full sync
 * stays full until it finishes.
 */
function resolveMode(ctx: Ctx, options: SyncOptions): SyncMode {
  if (options.mode === "reparse") return "reparse";
  const cache = ctx.cache();
  if (options.mode === "full") return "full";
  if (cache.getMeta(META_CURSOR) !== undefined && cache.getMeta(META_LAST_FULL) === undefined) {
    return "full";
  }
  return cache.getMeta(META_LAST_FULL) === undefined ? "full" : "incremental";
}

const currentYearFilter = (ctx: Ctx): string => `year-${new Date(ctx.now()).getFullYear()}`;

function advance(cursor: Cursor): Cursor | null {
  const next = cursor.index + 1;
  return next >= cursor.filters.length ? null : { ...cursor, index: next, page: 1 };
}

function loadCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Cursor;
    return Array.isArray(parsed.filters) ? { ...parsed, listDone: parsed.listDone === true } : null;
  } catch {
    return null;
  }
}

async function fetchList(ctx: Ctx, filter: string, sessionId: string | undefined, page = 1) {
  const result = await ctx.amazon.page(ordersPath(filter, page), {
    readySelector: ORDERS_READY,
    readyExpression: ORDERS_READY_EXPRESSION,
  });
  return parseOrdersPage(result.html, { now: new Date(ctx.now()), sessionId }, ctx.config.baseUrl);
}

function apply(ctx: Ctx, orders: ReturnType<typeof parseOrdersPage>["orders"], report: SyncReport) {
  const cache = ctx.cache();
  for (const order of orders) {
    report.ordersSeen += 1;
    const { inserted, changed } = cache.upsertSummary(order);
    if (inserted) report.ordersNew += 1;
    else if (changed) report.ordersChanged += 1;
  }
}

async function fetchDetail(ctx: Ctx, orderId: string, report: SyncReport): Promise<void> {
  const path = orderDetailPath(orderId);
  const page = await ctx.amazon.page(path, { readySelector: DETAIL_READY });
  const detail = parseOrderDetail(
    page.html,
    { now: new Date(ctx.now()), sourceUrl: page.url },
    ctx.config.baseUrl,
  );
  // Store the page so a parser fix can reparse it without the network.
  const raw = Bun.gzipSync(Buffer.from(page.html));
  ctx.cache().upsertDetail({ ...detail, orderId }, raw, PARSER_VERSION);
  report.detailsFetched += 1;
  if (detail.warnings.length > 0) {
    report.warnings.push(`${orderId}: ${detail.warnings.join("; ")}`);
  }
}

/** Reprocesses the stored HTML with the current parser. Spends no requests. */
function reparseAll(ctx: Ctx, report: SyncReport): void {
  const cache = ctx.cache();
  for (const row of cache.toReparse(PARSER_VERSION)) {
    const html = Buffer.from(Bun.gunzipSync(Buffer.from(row.raw_html))).toString("utf8");
    try {
      const detail = parseOrderDetail(
        html,
        { now: new Date(ctx.now()), sourceUrl: "cache" },
        ctx.config.baseUrl,
      );
      cache.upsertDetail({ ...detail, orderId: row.order_id }, row.raw_html, PARSER_VERSION);
      report.reparsed += 1;
    } catch (error) {
      report.detailErrors += 1;
      report.warnings.push(`reparse de ${row.order_id}: ${(error as Error).message}`);
    }
  }
}
