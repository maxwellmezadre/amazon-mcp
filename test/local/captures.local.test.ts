import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseOrderDetail } from "../../src/amazon/detail.js";
import { parseOrdersPage } from "../../src/amazon/list.js";
import { sessionIdOf } from "../../src/session/jar.js";
import { createSessionStore } from "../../src/session/store.js";
import { loadConfig } from "../../src/config.js";

// The golden corpus: every page captured from the real account, un-anonymised.
// It lives in task/captures (gitignored), so this self-skips everywhere else.

const DIR = join(process.cwd(), "task", "captures");
const gated = existsSync(DIR) ? describe : describe.skip;
const NOW = new Date("2026-09-07T12:00:00Z");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".html")) : [];

let sessionId: string | undefined;
try {
  sessionId = sessionIdOf(createSessionStore(loadConfig()).load()?.cookies ?? []);
} catch {
  sessionId = undefined;
}

gated("captured corpus", () => {
  test("every list page parses, and no order number is the session id", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const file of files.filter((f) => f.startsWith("orders-") && !f.includes("precsd"))) {
      try {
        const page = parseOrdersPage(read(file), { now: NOW, sessionId });
        for (const order of page.orders) {
          seen.add(order.orderId);
          if (order.orderId.startsWith("139-")) problems.push(`${file}: session id como pedido`);
          if (order.purchasedAt && !/^\d{4}-\d{2}-\d{2}$/.test(order.purchasedAt)) {
            problems.push(`${file}: data ${order.purchasedAt}`);
          }
          for (const item of order.items) {
            if (item.asin !== null && !/^[A-Z0-9]{10}$/.test(item.asin)) {
              problems.push(`${file}: asin ${item.asin}`);
            }
            if (!Number.isInteger(item.quantity) || item.quantity < 1) {
              problems.push(`${file}: quantidade ${item.quantity}`);
            }
          }
        }
      } catch (error) {
        problems.push(`${file}: ${(error as Error).message}`);
      }
    }
    expect(problems).toEqual([]);
    expect(seen.size).toBeGreaterThan(0);
  });

  test("every detail page parses with the money identity holding", () => {
    const problems: string[] = [];
    for (const file of files.filter((f) => f.startsWith("detail-"))) {
      try {
        const detail = parseOrderDetail(read(file), { now: NOW, sourceUrl: file });
        if (detail.subtotals.grandTotalCents === null) problems.push(`${file}: sem total geral`);
        for (const warning of detail.warnings) problems.push(`${file}: ${warning}`);
      } catch (error) {
        problems.push(`${file}: ${(error as Error).message}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("the list total matches the detail total for every captured order", () => {
    const listTotals = new Map<string, number | null>();
    for (const file of files.filter((f) => f.startsWith("orders-") && !f.includes("precsd"))) {
      for (const order of parseOrdersPage(read(file), { now: NOW, sessionId }).orders) {
        listTotals.set(order.orderId, order.totalCents);
      }
    }
    const problems: string[] = [];
    for (const file of files.filter((f) => f.startsWith("detail-"))) {
      const detail = parseOrderDetail(read(file), { now: NOW, sourceUrl: file });
      const fromList = listTotals.get(detail.orderId);
      if (fromList === undefined) continue;
      if (fromList !== detail.subtotals.grandTotalCents) {
        problems.push(`${detail.orderId}: lista ${fromList} vs detalhe ${detail.subtotals.grandTotalCents}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
