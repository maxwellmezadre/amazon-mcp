// Every Amazon route this project touches, in one place, plus the selector that
// proves each page finished decrypting. Routes verified against the live
// account on 2026-09-07.

/** `/gp/css/order-history` redirects here; this is the canonical list. */
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

/**
 * Accepts both outcomes on purpose. A filter with no orders renders the time
 * filter and no order id at all, and demanding an order id there would report a
 * perfectly good page as a decryption failure.
 */
export const ORDERS_READY = ".yohtmlc-order-id, #time-filter";
export const DETAIL_READY = "#od-subtotals, #orderDetails";
export const POPOVER_READY = "a[href]";

/** `last30`, `months-3`, `year-2025`… The real list is read from the page. */
export const YEAR_FILTER = (year: number): string => `year-${year}`;
export const RECENT_FILTERS = ["last30", "months-3"] as const;
