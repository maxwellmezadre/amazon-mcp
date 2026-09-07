import { stripAccents } from "./dates.js";

// Amazon writes the status as prose ("Entregue em 2 de dezembro", "Pedido
// cancelado"), and it varies by shipment, by age and by order type. Matching on
// stems rather than exact strings is what survives that: "cancel" catches
// "Cancelado", "cancelada" and "Você cancelou o pedido" alike.

export const ORDER_STATUSES = [
  "delivered",
  "shipped",
  "processing",
  "cancelled",
  "returned",
  "unknown",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** First match wins, so the order of this list is the precedence. */
const PATTERNS: [RegExp, OrderStatus][] = [
  [/reembols|devolv|retorn/, "returned"],
  [/cancel/, "cancelled"],
  [/entregue|entrega concluida/, "delivered"],
  [/a caminho|enviado|despachado|saiu para entrega|chegando/, "shipped"],
  [/preparando|em separacao|nao despachado|processando|pagamento pendente|previsto/, "processing"],
];

export function parseStatus(text: string | null | undefined): OrderStatus {
  const normalised = stripAccents(String(text ?? "")).toLowerCase();
  if (normalised.trim() === "") return "unknown";
  for (const [pattern, status] of PATTERNS) {
    if (pattern.test(normalised)) return status;
  }
  return "unknown";
}

/**
 * A finished order cannot change, so its detail page is cached forever and the
 * sync never spends a request on it again.
 */
export function isFinalStatus(status: OrderStatus): boolean {
  return status === "delivered" || status === "cancelled" || status === "returned";
}

/** Cancelled and returned orders are money that was not spent. */
export function isCancelledStatus(status: OrderStatus): boolean {
  return status === "cancelled";
}
