import type { ItemRow, OrderRow, ShipmentRow } from "./repo.js";
import { money } from "../domain/money.js";

// Cache rows -> tool output. This is the ONLY place integer cents become
// decimals, so nothing inside the system ever does float arithmetic on money.

const parseJson = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export type ItemOut = ReturnType<typeof itemOut>;

export function itemOut(row: ItemRow, compact = false) {
  const base = {
    asin: row.asin,
    title: row.title,
    quantity: row.quantity,
    unitPrice: money(row.unit_cents),
    linePrice: money(row.line_cents),
    seller: row.seller,
  };
  if (compact) return base;
  return {
    ...base,
    productUrl: row.product_url,
    imageUrl: row.image_url,
    returnWindow: row.return_window_text,
  };
}

export function paymentOut(row: OrderRow) {
  if (row.payment_method === null && row.installments === null) return null;
  return {
    method: row.payment_method,
    brand: row.card_brand,
    last4: row.card_last4,
    installments: row.installments,
    installmentAmount: money(row.installment_cents),
    interestFree: row.interest_free === null ? null : row.interest_free === 1,
  };
}

export function orderOut(row: OrderRow, items: ItemRow[], compact = false) {
  const base = {
    orderId: row.order_id,
    type: row.order_type,
    date: row.purchased_at,
    status: row.status,
    total: money(row.grand_total_cents ?? row.total_cents),
    itemCount: row.item_count,
    items: items.map((item) => itemOut(item, compact)),
    payment: paymentOut(row),
  };
  if (compact) return base;
  return {
    ...base,
    dateText: row.purchased_at_text,
    statusText: row.status_text,
    recipient: row.recipient_name,
    hasDetail: row.detail_fetched_at !== null,
    warnings: parseJson<string[]>(row.warnings) ?? undefined,
  };
}

/** The full order, including every subtotal label Amazon printed. */
export function orderDetailOut(row: OrderRow, items: ItemRow[], shipments: ShipmentRow[]) {
  const raw = parseJson<Record<string, number | null>>(row.subtotals_json) ?? {};
  return {
    ...orderOut(row, items),
    subtotals: {
      itemsSubtotal: money(row.items_subtotal_cents),
      shipping: money(row.shipping_cents),
      discount: money(row.discount_cents),
      rewardPoints: money(row.reward_points_cents),
      giftCard: money(row.gift_card_cents),
      tax: money(row.tax_cents),
      grandTotal: money(row.grand_total_cents),
      // Every label as Amazon wrote it, including ones this version does not map.
      raw: Object.fromEntries(
        Object.entries(raw).map(([label, cents]) => [label, cents === null ? null : cents / 100]),
      ),
    },
    shipTo: parseJson(row.address_json),
    shipments: shipments.map((shipment) => ({
      status: shipment.status_primary,
      detail: shipment.status_secondary,
      deliveredAt: shipment.delivered_at,
    })),
    invoiceLinks: parseJson(row.invoice_links_json),
    sourceUrl: row.source_url,
    detailFetchedAt: row.detail_fetched_at,
    detailError: row.detail_error,
  };
}
