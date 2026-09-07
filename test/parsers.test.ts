import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "node-html-parser";
import { parseOrderDetail, parseSubtotals } from "../src/amazon/detail.js";
import { parseOrdersPage } from "../src/amazon/list.js";
import { parseInvoicePopover } from "../src/amazon/popover.js";
import { HASHED_CLASS, DETAIL, LIST, POPOVER } from "../src/amazon/selectors.js";
import { CsdError, ParseError } from "../src/core/errors.js";

// Every assertion below runs against pages really served by Amazon, anonymised
// but with all money, dates and quantities untouched.

const NOW = new Date("2026-09-07T12:00:00Z");
const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const list = (name: string) => parseOrdersPage(fixture(name), { now: NOW });
const detail = (name: string) =>
  parseOrderDetail(fixture(name), { now: NOW, sourceUrl: `https://x/${name}` });

describe("orders list", () => {
  test("reads two orders: a physical one with three items and a digital one", () => {
    const page = list("orders-with-two.html");
    expect(page.orders).toHaveLength(2);

    const [physical, digital] = page.orders;
    expect(physical).toMatchObject({
      type: "physical",
      purchasedAt: "2026-02-25",
      totalCents: 11406,
    });
    expect(physical?.orderId).toMatch(/^70\d-\d{7}-\d{7}$/);
    expect(physical?.items).toHaveLength(3);
    expect(physical?.recipientName).toBeString();

    // A D01- order is billed, not shipped: no recipient at all.
    expect(digital).toMatchObject({ type: "digital", purchasedAt: "2026-02-19", totalCents: 0 });
    expect(digital?.orderId).toMatch(/^D01-/);
    expect(digital?.recipientName).toBeNull();
  });

  test("every item carries a well-formed ASIN and a quantity of at least one", () => {
    for (const order of list("orders-with-two.html").orders) {
      for (const item of order.items) {
        expect(item.asin).toMatch(/^[A-Z0-9]{10}$/);
        expect(item.quantity).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(item.quantity)).toBe(true);
        expect(item.title.length).toBeGreaterThan(3);
        // Hrefs on the list are relative; they must come back absolute.
        expect(item.productUrl).toStartWith("https://");
      }
    }
  });

  test("never reads the session-id cookie as an order number", () => {
    // The cookie has exactly the shape of an order number and appears in
    // telemetry URLs all over the page.
    for (const order of list("orders-with-two.html").orders) {
      expect(order.orderId).not.toStartWith("139-");
    }
    expect(() =>
      parseOrdersPage(fixture("orders-with-two.html"), {
        now: NOW,
        sessionId: list("orders-with-two.html").orders[0]?.orderId,
      }),
    ).toThrow(ParseError);
  });

  test("discovers the available periods from the page instead of hardcoding them", () => {
    const page = list("orders-single.html");
    expect(page.filters).toContain("last30");
    expect(page.filters).toContain("months-3");
    expect(page.filters.filter((filter) => filter.startsWith("year-")).length).toBeGreaterThan(3);
  });

  test("an empty period is zero orders, not a failure — in both wordings", () => {
    // "nao fez um pedido em 2024" for a year...
    expect(list("orders-empty-year.html").orders).toEqual([]);
    // ...and "nao fez nenhum pedido nos ultimos 30 dias" for a relative filter.
    expect(list("orders-empty-last30.html").orders).toEqual([]);
    expect(list("orders-empty-year.html").filters.length).toBeGreaterThan(0);
  });

  test("a page read before its orders rendered is a failure, not an empty year", () => {
    // Strip the cards and the empty-state sentence: what is left is the shell,
    // which is exactly what a too-early extraction returns.
    // Strip the cards; the page has no empty-state sentence, which is exactly
    // what a too-early extraction returns.
    const shell = fixture("orders-with-two.html")
      .replaceAll("js-order-card", "gone")
      .replaceAll("order-card", "gone");
    expect(() => parseOrdersPage(shell, { now: NOW })).toThrow(ParseError);
  });

  test("still-encrypted cards are reported as such, never as zero orders", () => {
    const encrypted = fixture("orders-empty-year.html").replace(
      "<body",
      '<body><div class="csd-encrypted-sensitive"></div',
    );
    expect(() => parseOrdersPage(encrypted, { now: NOW })).toThrow(CsdError);
  });

  test("a short page is the last one", () => {
    expect(list("orders-with-two.html").hasMore).toBe(false);
  });
});

describe("order detail", () => {
  test("three items whose prices add up to the subtotal", () => {
    const order = detail("detail-physical-2.html");
    expect(order.items).toHaveLength(3);
    expect(order.items.map((item) => item.unitCents)).toEqual([4625, 4938, 4490]);
    expect(order.items.reduce((sum, item) => sum + (item.lineCents ?? 0), 0)).toBe(14053);
    expect(order.subtotals.itemsSubtotalCents).toBe(14053);
    expect(order.items.every((item) => item.seller !== null)).toBe(true);
  });

  test("keeps every subtotal label, including ones it does not map", () => {
    const order = detail("detail-physical-2.html");
    expect(order.subtotals).toMatchObject({
      itemsSubtotalCents: 14053,
      shippingCents: 890,
      discountCents: -890,
      rewardPointsCents: -2647,
      grandTotalCents: 11406,
    });
    // "Total" (subtotal + shipping, before adjustments) is NOT the grand total,
    // and is kept in the raw map rather than dropped.
    expect(order.subtotals.raw["total"]).toBe(14943);
    expect(Object.keys(order.subtotals.raw)).toContain("promoção aplicada");
  });

  test("the accounting identity holds on every fixture", () => {
    for (const name of ["detail-physical-1.html", "detail-physical-2.html", "detail-digital.html"]) {
      expect(detail(name).warnings).toEqual([]);
    }
  });

  test("reports a broken sum instead of silently storing it", () => {
    // A function replacer, because "$&" in a replacement STRING expands to the
    // matched text and would silently corrupt the fixture instead of editing it.
    const tampered = fixture("detail-physical-2.html").replace(
      "R$&nbsp;140,53",
      () => "R$&nbsp;999,99",
    );
    const order = parseOrderDetail(tampered, { now: NOW, sourceUrl: "x" });
    expect(order.warnings.length).toBeGreaterThan(0);
    expect(order.warnings.join(" ")).toContain("não fecham");
  });

  test("reads the instalment plan from text, never from the hashed classes", () => {
    expect(detail("detail-physical-2.html").payment).toMatchObject({
      method: "credit_card",
      brand: "Mastercard",
      installments: 6,
      installmentCents: 1901,
      interestFree: true,
    });
    expect(detail("detail-physical-1.html").payment).toMatchObject({
      installments: 4,
      installmentCents: 5277,
      interestFree: true,
    });
    expect(detail("detail-physical-2.html").payment?.last4).toMatch(/^\d{4}$/);
  });

  test("6 x 19,01 is the order total within rounding", () => {
    const payment = detail("detail-physical-2.html").payment;
    const planned = (payment?.installments ?? 0) * (payment?.installmentCents ?? 0);
    const total = detail("detail-physical-2.html").subtotals.grandTotalCents ?? 0;
    expect(Math.abs(planned - total)).toBeLessThanOrEqual(600);
  });

  test("parses the shipping address, and a digital order simply has none", () => {
    const address = detail("detail-physical-2.html").shipTo;
    // Amazon writes the postcode WITHOUT the dash ("Rolante, RS 95690000").
    expect(address?.postalCode).toMatch(/^\d{5}-?\d{3}$/);
    expect(address?.state).toMatch(/^[A-Z]{2}$/);
    expect(address?.city).toBeString();
    // A digital order is billed, not shipped: a name but no place.
    const digital = detail("detail-digital.html").shipTo;
    expect(digital?.city).toBeNull();
    expect(digital?.state).toBeNull();
    expect(digital?.postalCode).toBeNull();
  });

  test("a digital order uses its own labels and is free", () => {
    const order = detail("detail-digital.html");
    expect(order.orderId).toStartWith("D01-");
    // "Total deste pedido" instead of "Total geral".
    expect(order.subtotals.grandTotalCents).toBe(0);
    expect(Object.keys(order.subtotals.raw)).toContain("total deste pedido");
  });

  test("the detail total matches the list card total for the same order", () => {
    const fromList = list("orders-with-two.html").orders[0];
    const fromDetail = detail("detail-physical-2.html");
    expect(fromDetail.orderId).toBe(fromList?.orderId as string);
    expect(fromDetail.subtotals.grandTotalCents).toBe(fromList?.totalCents as number);
  });

  test("prices survive the non-breaking space Amazon writes them with", () => {
    expect(fixture("detail-physical-2.html")).toContain("R$&nbsp;");
    expect(detail("detail-physical-2.html").subtotals.shippingCents).toBe(890);
  });

  test("an empty charge summary yields nulls, never zeros", () => {
    const empty = parseSubtotals(parse('<div data-component="chargeSummary"></div>'));
    expect(empty.grandTotalCents).toBeNull();
    expect(empty.itemsSubtotalCents).toBeNull();
    // "No price on this row" and "this row costs nothing" are different facts.
    expect(empty.raw).toEqual({});
  });
});

describe("invoice popover", () => {
  test("a physical order links both the printable summary and the NF-e", () => {
    const links = parseInvoicePopover(fixture("popover-physical-1.html"));
    expect(links.printSummary).toContain("summary/print.html");
    expect(links.nfePdf).toBeString();
  });

  test("a digital order links only the printable summary", () => {
    expect(parseInvoicePopover(fixture("popover-digital.html"))).toMatchObject({
      nfePdf: null,
    });
  });
});

describe("selectors", () => {
  test("no selector depends on a class carrying a per-deploy hash", () => {
    for (const group of [LIST, DETAIL, POPOVER]) {
      for (const selector of Object.values(group)) {
        expect(HASHED_CLASS.test(selector)).toBe(false);
      }
    }
    // The hash really is in the page, which is why the rule exists.
    expect(HASHED_CLASS.test("pmts-portal-root-EHM5esZuGO9x")).toBe(true);
    expect(HASHED_CLASS.test("pmts-class-49e45ab6")).toBe(true);
  });
});
