import { type HTMLElement, parse } from "node-html-parser";
import { CsdError, ParseError } from "../core/errors.js";
import { dedupeRecipient, parseAddress } from "../domain/address.js";
import { parseBrl } from "../domain/money.js";
import { parsePayment } from "../domain/payment.js";
import { parseStatus } from "../domain/status.js";
import type { OrderDetail, OrderItem, Shipment, Subtotals } from "../domain/types.js";
import { DETAIL, ORDER_ID } from "./selectors.js";

// Parses the printable order summary (/gp/css/summary/print.html), which is the
// only surface carrying unit prices, the seller, the payment plan and the full
// subtotals. Pure, like the list parser.

/** Cents of slack when checking that the subtotals add up. */
export const MONEY_TOLERANCE_CENTS = 5;

const text = (node: HTMLElement | null | undefined): string =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();

/** Multi-line text, for addresses, where the line breaks carry meaning. */
function lines(node: HTMLElement | null | undefined): string {
  if (!node) return "";
  return (node.structuredText ?? node.textContent ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Every row of the charge summary as a label -> cents map. Labels are NOT
 * assumed: orders carry different ones (coupon, gift card, tax, reward points),
 * so the map is kept whole and the known fields are picked by pattern.
 */
export function parseSubtotals(root: HTMLElement): Subtotals {
  const block =
    root.querySelector(DETAIL.chargeSummary) ?? root.querySelector(DETAIL.subtotalsFallback);
  const raw: Record<string, number | null> = {};

  for (const row of block?.querySelectorAll(DETAIL.row) ?? []) {
    const label = text(row.querySelector(DETAIL.rowLabel))
      .replace(/:\s*$/, "")
      .trim()
      .toLowerCase();
    if (label === "") continue;
    raw[label] = parseBrl(text(row.querySelector(DETAIL.rowContent)));
  }

  const pick = (pattern: RegExp): number | null => {
    for (const [label, cents] of Object.entries(raw)) {
      if (pattern.test(label)) return cents;
    }
    return null;
  };

  return {
    itemsSubtotalCents: pick(/^subtotal/),
    shippingCents: pick(/frete/),
    discountCents: pick(/desconto|cupom|promo/),
    rewardPointsCents: pick(/pontos de recompensa/),
    giftCardCents: pick(/vale[- ]presente/),
    taxCents: pick(/imposto/),
    // "Total geral" is the amount actually charged and the one that matches the
    // list card; a plain "Total" is the pre-adjustment figure (subtotal plus
    // shipping, before promotions and reward points). Digital orders label the
    // same thing "Total deste pedido".
    grandTotalCents:
      pick(/^total\s+(?:geral|deste pedido|do pedido)/) ?? pick(/^total$/),
    raw,
  };
}

function parseItems(root: HTMLElement, baseUrl: string): OrderItem[] {
  const images = root.querySelectorAll(DETAIL.itemImageGrid);
  return root.querySelectorAll(DETAIL.item).map((box, position) => {
    const link = box.querySelector(`${DETAIL.itemTitle} a`);
    const href = link?.getAttribute("href");
    // Rendered empty for a quantity of one.
    const quantity = Number(text(box.querySelector(DETAIL.itemQuantity))) || 1;
    // The component prints the price twice (accessible + visual); both are the
    // same value, so the first match is the price.
    const unitCents = parseBrl(text(box.querySelector(DETAIL.itemUnitPrice)));
    const seller = text(box.querySelector(DETAIL.itemMerchant)).replace(/^Vendido por:\s*/i, "");

    return {
      position,
      asin: /\/dp\/([A-Z0-9]{10})/.exec(href ?? "")?.[1] ?? null,
      title: text(link),
      quantity,
      unitCents,
      lineCents: unitCents === null ? null : unitCents * quantity,
      seller: seller || null,
      productUrl: href ? new URL(href, baseUrl).toString() : null,
      imageUrl: images[position]?.querySelector("img")?.getAttribute("src") ?? null,
      returnWindowText: text(box.querySelector(DETAIL.itemReturnWindow)) || null,
    };
  });
}

function parseShipments(root: HTMLElement): Shipment[] {
  const nodes = root.querySelectorAll(DETAIL.shipmentStatus);
  return nodes
    .map((node, position) => ({
      position,
      statusPrimary: text(node) || null,
      statusSecondary: null,
      deliveredAt: null,
    }))
    .filter((shipment) => shipment.statusPrimary !== null);
}

/**
 * Locates the payment block by its stable data-component, falling back to the
 * unhashed widget class and then to the heading. Its own classes carry a
 * per-deploy hash and must never be selectors.
 */
function paymentBlock(root: HTMLElement): HTMLElement | null {
  const direct = root.querySelector(DETAIL.payment) ?? root.querySelector(DETAIL.paymentFallback);
  if (direct) return direct;
  for (const heading of root.querySelectorAll("h5, h4")) {
    if (/^forma de pagamento$/i.test(text(heading))) return heading.parentNode ?? null;
  }
  return null;
}

export function parseOrderDetail(
  html: string,
  opts: { now: Date; sourceUrl: string },
  baseUrl = "https://www.amazon.com.br",
): OrderDetail {
  const root = parse(html);

  if (root.querySelectorAll(".csd-encrypted-sensitive").length > 0) {
    throw new CsdError(`O detalhe de ${opts.sourceUrl} veio cifrado.`);
  }

  const orderId = ORDER_ID.exec(text(root.querySelector(DETAIL.orderId)))?.[1];
  if (!orderId) {
    throw new ParseError(`O detalhe de ${opts.sourceUrl} não trouxe o número do pedido.`);
  }

  const subtotals = parseSubtotals(root);
  const items = parseItems(root, baseUrl);
  const statusText = text(root.querySelector(DETAIL.statusMessage)) || null;
  const payment = paymentBlock(root);
  const address = parseAddress(lines(root.querySelector(DETAIL.shippingAddress)));

  return {
    orderId,
    subtotals,
    items,
    shipments: parseShipments(root),
    payment: payment ? parsePayment(text(payment)) : null,
    shipTo: address ? dedupeRecipient(address) : null,
    status: parseStatus(statusText),
    statusText,
    warnings: checkMoney(subtotals, items),
    sourceUrl: opts.sourceUrl,
  };
}

/**
 * The accounting identity. A mismatch is reported, never corrected: a silently
 * "fixed" total is how a parser regression reaches someone's spending report.
 */
export function checkMoney(subtotals: Subtotals, items: OrderItem[]): string[] {
  const warnings: string[] = [];
  const { itemsSubtotalCents, grandTotalCents } = subtotals;

  const parts = [
    subtotals.itemsSubtotalCents,
    subtotals.shippingCents,
    subtotals.discountCents,
    subtotals.rewardPointsCents,
    subtotals.giftCardCents,
    subtotals.taxCents,
  ];
  if (grandTotalCents !== null && parts.some((part) => part !== null)) {
    const sum = parts.reduce<number>((total, part) => total + (part ?? 0), 0);
    if (Math.abs(sum - grandTotalCents) > MONEY_TOLERANCE_CENTS) {
      warnings.push(
        `subtotais não fecham: soma ${sum} vs total geral ${grandTotalCents} (centavos)`,
      );
    }
  }

  const linesTotal = items.reduce<number>((total, item) => total + (item.lineCents ?? 0), 0);
  if (itemsSubtotalCents !== null && items.every((item) => item.lineCents !== null)) {
    if (Math.abs(linesTotal - itemsSubtotalCents) > MONEY_TOLERANCE_CENTS) {
      warnings.push(
        `itens não fecham: soma das linhas ${linesTotal} vs subtotal ${itemsSubtotalCents} (centavos)`,
      );
    }
  }
  return warnings;
}
