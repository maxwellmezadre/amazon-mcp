// Every Amazon route this project touches, in one place, plus the selector that
// proves each page finished decrypting. Routes verified against the live
// account on 2026-09-07.

/** `/gp/css/order-history` redirects here; this is the canonical list. */
import { EMPTY_STATE } from "./selectors.js";

export const ordersPath = (timeFilter: string, page = 1): string =>
  `/your-orders/orders?timeFilter=${encodeURIComponent(timeFilter)}&page=${page}`;

/**
 * The printable summary is the best detail source: one document with items,
 * prices, seller, address, payment with instalments and every subtotal, and far
 * less noise than the regular details page (no recommendation carousels), so
 * less for the decryption to chew through.
 */
export const orderDetailPath = (orderId: string): string =>
  `/gp/css/summary/print.html?orderID=${encodeURIComponent(orderId)}`;

/** Small fragment listing the real invoice links for an order. */
export const invoicePopoverPath = (orderId: string): string =>
  `/your-orders/invoice/popover?orderId=${encodeURIComponent(orderId)}&relatedRequestId=&ref_=ppx_yo2ov_dt_b_invoice`;

export const ORDERS_READY = ".yohtmlc-order-id";

/**
 * Readiness for the order list, which cannot be a single selector.
 *
 * The period filter belongs to the STATIC shell and is there before any order
 * renders, so treating it as proof extracts an empty page and silently reports
 * a year as having no orders. The two real outcomes are: at least one order id,
 * or the page saying outright that the filter has none. The count label is
 * returned too, so the parser can cross-check what it extracted.
 */
const EMPTY_STATE_SOURCE = `/${EMPTY_STATE.source}/${EMPTY_STATE.flags}`;

export const ORDERS_READY_EXPRESSION = `(() => {
  const body = document.body ? document.body.textContent || "" : "";
  const label = document.querySelector(".time-filter__label");
  const announced = label ? parseInt((label.textContent || "").replace(/[^0-9]/g, ""), 10) : NaN;
  const cards = document.querySelectorAll(".yohtmlc-order-id").length;
  return {
    encrypted: document.querySelectorAll(".csd-encrypted-sensitive").length,
    ready: cards > 0 || ${EMPTY_STATE_SOURCE}.test(body),
    cards,
    announced: Number.isFinite(announced) ? announced : null,
  };
})()`;
export const DETAIL_READY = "#od-subtotals, #orderDetails";
export const POPOVER_READY = "a[href]";

/** `last30`, `months-3`, `year-2025`… The real list is read from the page. */
export const YEAR_FILTER = (year: number): string => `year-${year}`;
export const RECENT_FILTERS = ["last30", "months-3"] as const;
