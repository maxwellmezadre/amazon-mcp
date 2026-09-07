import { type HTMLElement, parse } from "node-html-parser";
import { CsdError, ParseError } from "../core/errors.js";
import { parseDateBR } from "../domain/dates.js";
import { parseBrl } from "../domain/money.js";
import { parseStatus } from "../domain/status.js";
import type { OrderItem, OrderSummary, OrderType } from "../domain/types.js";
import { ANNOUNCED_COUNT, LIST, ORDER_ID, PAGE_SIZE } from "./selectors.js";

// Parses one page of "Seus pedidos". Pure: HTML string in, structs out, with an
// injected clock — so it runs against fixtures in CI with no browser.

export type OrdersPage = {
  orders: OrderSummary[];
  /** Filters offered by the page, newest first, e.g. last30, year-2026. */
  filters: string[];
  /**
   * The number in the filter label ("6 pedidos feitos em ..."). Informational
   * ONLY: measured against the live account it does NOT track the selected
   * filter — a year with no orders at all still showed "6 pedidos" next to the
   * page's own "voce nao fez um pedido em 2024". Never use it as a count or as
   * a completeness check; the readiness rule in urls.ts is what guarantees the
   * page was read after its orders rendered.
   */
  announcedCount: number | null;
  /** A full page means there may be another one. */
  hasMore: boolean;
};

export type ParseListOptions = {
  now: Date;
  /**
   * Value of the `session-id` cookie. It has the exact shape of an order
   * number, so any card yielding it means the parser read the wrong element.
   */
  sessionId?: string | undefined;
};

const text = (node: HTMLElement | null | undefined): string =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();

/**
 * Value of a header cell, found by its label. The label is compared in NORMAL
 * case: the uppercase on screen is `text-transform`, so `"TOTAL"` never matches.
 */
function headerValue(card: HTMLElement, label: RegExp): string | null {
  for (const item of card.querySelectorAll(LIST.headerItem)) {
    const caps = item.querySelector(LIST.headerLabel);
    if (!caps || !label.test(text(caps))) continue;
    // The label sits inside the cell, so remove it rather than assume a layout.
    const whole = text(item);
    return whole.replace(text(caps), "").replace(/\s+/g, " ").trim() || null;
  }
  return null;
}

function asin(href: string | undefined): string | null {
  const match = /\/dp\/([A-Z0-9]{10})/.exec(href ?? "");
  return match?.[1] ?? null;
}

/** Hrefs on the list are relative ("/dp/B0..."). */
function absolute(href: string | undefined, baseUrl: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function parseItems(card: HTMLElement, baseUrl: string): OrderItem[] {
  const boxes = card.querySelectorAll(LIST.itemBox);
  return boxes.map((box, position) => {
    const link = box.querySelector(`${LIST.productTitle} a`) ?? box.querySelector(LIST.productLink);
    const href = link?.getAttribute("href");
    // Absent for a quantity of one, and padded with newlines when present.
    const quantity = Number(text(box.querySelector(LIST.quantity))) || 1;
    return {
      position,
      asin: asin(href),
      title: text(link) || text(box.querySelector(LIST.productTitle)),
      quantity,
      unitCents: null,
      lineCents: null,
      seller: null,
      productUrl: absolute(href, baseUrl),
      imageUrl: box.querySelector(LIST.image)?.getAttribute("src") ?? null,
      returnWindowText: null,
    };
  });
}

export function parseOrdersPage(
  html: string,
  opts: ParseListOptions,
  baseUrl = "https://www.amazon.com.br",
): OrdersPage {
  const root = parse(html);

  const filters = root
    .querySelectorAll(`${LIST.timeFilter} option`)
    .map((option) => option.getAttribute("value") ?? "")
    .filter((value) => value !== "");

  const cards = root.querySelectorAll(LIST.card);
  if (cards.length === 0) {
    // Zero cards is only legitimate when the page itself rendered. Without the
    // filter control we are looking at a skeleton, not an empty history — and
    // reporting that as "no orders" would silently truncate the history.
    if (root.querySelectorAll(".csd-encrypted-sensitive").length > 0) {
      throw new CsdError("A página de pedidos veio cifrada: a descriptografia não rodou.");
    }
    if (filters.length === 0) {
      throw new ParseError("A página de pedidos não trouxe cards nem o filtro de período.");
    }
  }

  const orders = cards.map((card) => parseCard(card, opts, baseUrl));

  const announcedCount = parseAnnouncedCount(root);

  return {
    orders,
    filters,
    announcedCount,
    hasMore: cards.length >= PAGE_SIZE,
  };
}

/** The count lives in the filter label: "<b>6 pedidos</b> feitos em". */
function parseAnnouncedCount(root: HTMLElement): number | null {
  const label = root.querySelector(".time-filter__label");
  if (label) {
    const digits = text(label).replace(/[^0-9]/g, "");
    if (digits !== "") return Number(digits);
  }
  const fallback = ANNOUNCED_COUNT.exec(text(root));
  return fallback ? Number(fallback[1]) : null;
}

function parseCard(card: HTMLElement, opts: ParseListOptions, baseUrl: string): OrderSummary {
  const idNode = card.querySelector(LIST.orderId);
  const orderId = ORDER_ID.exec(text(idNode))?.[1];
  if (!orderId) {
    throw new ParseError("Um card de pedido não trouxe o número do pedido.");
  }
  if (opts.sessionId && orderId === opts.sessionId) {
    // Belt and braces on the trap the whole parser is shaped around.
    throw new ParseError(
      "O número lido é igual ao cookie session-id: o seletor do número do pedido está errado.",
    );
  }

  // A digital order ("D01-") is billed, not shipped: no recipient, no address.
  const type: OrderType = /^D/i.test(orderId) ? "digital" : "physical";
  const dateText = headerValue(card, /pedido realizado|assinatura cobrada/i);
  const statusText = text(card.querySelector(LIST.shipmentStatus)) || null;

  return {
    orderId,
    type,
    purchasedAt: parseDateBR(dateText, opts.now),
    purchasedAtText: dateText,
    totalCents: parseBrl(headerValue(card, /^total$/i)),
    recipientName: text(card.querySelector(LIST.recipientName)) || null,
    shipmentStatusText: statusText,
    // Amazon drops the status text from old orders, so "no text" is not
    // "unknown state" — the detail page is what settles it.
    status: parseStatus(statusText),
    items: parseItems(card, baseUrl),
  };
}
