import type { Address } from "./address.js";
import type { PaymentInfo } from "./payment.js";
import type { OrderStatus } from "./status.js";

// The normalised shape every layer above the parsers speaks. Money is in
// integer cents; `null` means "not available", never zero.

export type OrderType = "physical" | "digital";

export type OrderItem = {
  /** Position within the order; `(orderId, position)` is the key. */
  position: number;
  asin: string | null;
  title: string;
  quantity: number;
  unitCents: number | null;
  lineCents: number | null;
  seller: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  returnWindowText: string | null;
};

export type Shipment = {
  position: number;
  statusPrimary: string | null;
  statusSecondary: string | null;
  deliveredAt: string | null;
};

/** Every label of `#od-subtotals`, mapped and raw. */
export type Subtotals = {
  itemsSubtotalCents: number | null;
  shippingCents: number | null;
  discountCents: number | null;
  rewardPointsCents: number | null;
  giftCardCents: number | null;
  taxCents: number | null;
  grandTotalCents: number | null;
  /** The full label -> cents map, including labels this version does not know. */
  raw: Record<string, number | null>;
};

/** What one card of the orders list yields. */
export type OrderSummary = {
  orderId: string;
  type: OrderType;
  purchasedAt: string | null;
  purchasedAtText: string | null;
  totalCents: number | null;
  recipientName: string | null;
  shipmentStatusText: string | null;
  status: OrderStatus;
  items: OrderItem[];
};

/** What the printable order summary yields. */
export type OrderDetail = {
  orderId: string;
  subtotals: Subtotals;
  items: OrderItem[];
  shipments: Shipment[];
  payment: PaymentInfo | null;
  shipTo: Address | null;
  status: OrderStatus;
  statusText: string | null;
  /** Accounting mismatches worth surfacing instead of silently storing. */
  warnings: string[];
  sourceUrl: string;
};

export type InvoiceLinks = {
  /** Always present: the printable order summary. */
  printSummary: string | null;
  /** The NF-e PDF, when the seller issued one and the popover links it. */
  nfePdf: string | null;
};
