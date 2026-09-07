// EVERY selector lives here. When Amazon changes the layout — and it will —
// this is the one file to fix instead of hunting strings across the project.
//
// Two rules, both learned from the live pages:
//
//  1. On the printable detail page, prefer `[data-component="..."]`. Amazon
//     annotates that page semantically (itemTitle, unitPrice, quantity,
//     chargeSummary, shippingAddress), and those names survive restyling.
//  2. NEVER use a class carrying a hash. The payment widget renders as
//     `pmts-portal-root-EHM5esZuGO9x` / `pmts-class-49e45ab6`, and the hash
//     changes between deploys — two orders in one session came back different.
//     A meta-test enforces this.

/** Matches the hashed class names that must never appear below. */
export const HASHED_CLASS = /pmts-(portal-root|class|portal-components)-[A-Za-z0-9]{6,}/;

export const LIST = {
  /** 10 per page. */
  card: ".order-card.js-order-card",
  headerItem: ".order-header__header-list-item",
  /** Careful: textContent is normal case. The uppercase on screen is CSS. */
  headerLabel: ".a-color-secondary.a-text-caps",
  /** The ONLY place an order number may be read from — see ORDER_ID. */
  orderId: ".yohtmlc-order-id",
  recipient: ".yohtmlc-recipient",
  recipientName: ".yohtmlc-recipient h5",
  shipmentStatus: ".yohtmlc-shipment-status-primaryText",
  shipmentStatusSecondary: ".yohtmlc-shipment-status-secondaryText",
  /** Present on the list (unlike the detail page), one per item. */
  itemBox: ".item-box",
  productTitle: ".yohtmlc-product-title",
  productLink: 'a[href*="/dp/"]',
  /** Absent when the quantity is 1; the text needs trimming ("\n    3\n"). */
  quantity: ".product-image__qty",
  image: ".product-image img",
  timeFilter: "#time-filter",
  pagination: ".a-pagination",
} as const;

export const DETAIL = {
  root: "#orderDetails",
  orderId: '[data-component="orderId"]',
  orderDate: '[data-component="orderDate"]',
  /** Subtotals block; rows are label/content pairs. */
  chargeSummary: '[data-component="chargeSummary"]',
  subtotalsFallback: "#od-subtotals",
  row: ".od-line-item-row",
  rowLabel: ".od-line-item-row-label",
  rowContent: ".od-line-item-row-content",
  /** One per purchased item; holds the title, quantity, price and seller. */
  item: '[data-component="purchasedItemsRightGrid"]',
  itemImageGrid: '[data-component="purchasedItemsLeftGrid"]',
  itemTitle: '[data-component="itemTitle"]',
  itemQuantity: '[data-component="quantity"]',
  itemUnitPrice: '[data-component="unitPrice"]',
  itemMerchant: '[data-component="orderedMerchant"]',
  itemReturnWindow: '[data-component="itemReturnEligibility"]',
  shippingAddress: '[data-component="shippingAddress"]',
  shipmentStatus: '[data-component="shipmentStatus"]',
  /** Stable anchor for the payment block, whose classes are hashed. */
  payment: '[data-component="viewPaymentPlanSummaryWidget"]',
  /** Unhashed fallback inside the payments widget. */
  paymentFallback: ".pmts-payment-instrument-billing-address",
  statusMessage: ".od-status-message",
} as const;

export const POPOVER = {
  list: ".invoice-list",
  link: "a[href]",
} as const;

/**
 * `702-` and `701-` are retail orders, `D01-` digital ones.
 *
 * This is applied ONLY to the text inside {@link LIST.orderId} or the detail
 * page's orderId component. The `session-id` cookie has exactly this shape
 * (`139-9338268-4563450`) and appears in dozens of telemetry URLs, so running
 * it over a whole page happily collects the session id as if it were an order.
 */
export const ORDER_ID = /\b([A-Z]?\d{2,3}-\d{7}-\d{7})\b/;

/** "3 pedidos feitos em 2026" — used to sanity-check the pagination. */
export const ANNOUNCED_COUNT = /(\d+)\s+pedidos?\s+(?:feitos?|realizados?)/i;

/** Amazon paginates the order list at ten cards. */
export const PAGE_SIZE = 10;
