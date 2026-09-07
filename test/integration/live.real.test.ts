import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { ORDERS_READY, ORDERS_READY_EXPRESSION, YEAR_FILTER, ordersPath } from "../../src/amazon/urls.js";
import { parseOrdersPage } from "../../src/amazon/list.js";
import { loadConfig } from "../../src/config.js";
import { createContext } from "../../src/context.js";

// Talks to the REAL Amazon with the user's session. Gated twice, so it never
// runs in CI or on a machine that has not logged in.
const config = (() => {
  try {
    return loadConfig();
  } catch {
    return null;
  }
})();
const enabled =
  process.env.AMAZON_LIVE === "1" && config !== null && existsSync(config.sessionPath);
const gated = enabled ? describe : describe.skip;

gated("live account", () => {
  test("loads the current year's orders and they decrypt", async () => {
    const ctx = createContext(config!);
    try {
      const page = await ctx.amazon.page(
        ordersPath(YEAR_FILTER(new Date().getFullYear())),
        { readySelector: ORDERS_READY, readyExpression: ORDERS_READY_EXPRESSION },
      );
      const parsed = parseOrdersPage(page.html, { now: new Date() }, config!.baseUrl);
      expect(parsed.filters.length).toBeGreaterThan(3);
      for (const order of parsed.orders) {
        expect(order.orderId).toMatch(/^[A-Z]?\d{2,3}-\d{7}-\d{7}$/);
        expect(order.orderId).not.toStartWith("139-");
      }
    } finally {
      await ctx.dispose();
    }
  }, 120_000);
});
