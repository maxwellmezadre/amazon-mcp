import { Type } from "@sinclair/typebox";
import { chmodSync, mkdirSync } from "node:fs";
import { toDecimal } from "../domain/money.js";
import { dayField } from "./fields.js";
import { resolveInside, safeName } from "./invoices.js";
import { defineTool } from "./define.js";

/** RFC 4180: quote when the value carries a comma, a quote or a newline. */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => cell(row[header])).join(",")),
  ].join("\n");
}

export const exportData = defineTool({
  name: "export",
  description:
    "Exporta os pedidos ou os itens do cache para um arquivo JSON ou CSV, dentro de " +
    "AMAZON_EXPORT_DIR. Escreve arquivo local; não usa a rede e não altera a conta.",
  readOnly: false,
  input: Type.Object({
    format: Type.Union([Type.Literal("json"), Type.Literal("csv")], {
      description: "Formato do arquivo",
    }),
    scope: Type.Union([Type.Literal("orders"), Type.Literal("items")], {
      description: "orders = um registro por pedido; items = um registro por produto comprado",
    }),
    from: dayField("Data inicial (YYYY-MM-DD)"),
    to: dayField("Data final (YYYY-MM-DD)"),
    include_cancelled: Type.Optional(
      Type.Boolean({ description: "Inclui cancelados (default false)" }),
    ),
    filename: Type.Optional(Type.String({ description: "Nome do arquivo (sem caminho)" })),
  }),
  run: async (args, ctx) => {
    const cache = ctx.cache();
    const filters = {
      ...(args.from ? { from: args.from } : {}),
      ...(args.to ? { to: args.to } : {}),
      ...(args.include_cancelled === undefined
        ? {}
        : { includeCancelled: args.include_cancelled }),
      limit: 10_000,
    };
    const orders = cache.listOrders(filters);

    const rows: Array<Record<string, unknown>> =
      args.scope === "orders"
        ? orders.map((order) => ({
            orderId: order.order_id,
            type: order.order_type,
            date: order.purchased_at,
            status: order.status,
            total: order.grand_total_cents === null ? null : toDecimal(order.grand_total_cents),
            shipping: order.shipping_cents === null ? null : toDecimal(order.shipping_cents),
            discount: order.discount_cents === null ? null : toDecimal(order.discount_cents),
            rewardPoints:
              order.reward_points_cents === null ? null : toDecimal(order.reward_points_cents),
            paymentMethod: order.payment_method,
            cardBrand: order.card_brand,
            installments: order.installments,
            itemCount: order.item_count,
          }))
        : orders.flatMap((order) =>
            cache.getItems(order.order_id).map((item) => ({
              orderId: order.order_id,
              date: order.purchased_at,
              asin: item.asin,
              title: item.title,
              quantity: item.quantity,
              unitPrice: item.unit_cents === null ? null : toDecimal(item.unit_cents),
              linePrice: item.line_cents === null ? null : toDecimal(item.line_cents),
              seller: item.seller,
            })),
          );

    const day = new Date(ctx.now()).toISOString().slice(0, 10);
    const name = safeName(args.filename, `${args.scope}-${day}`, args.format);
    mkdirSync(ctx.config.exportDir, { recursive: true, mode: 0o700 });
    const path = resolveInside(ctx.config.exportDir, name);
    await Bun.write(path, args.format === "csv" ? toCsv(rows) : JSON.stringify(rows, null, 2));
    chmodSync(path, 0o600);

    return { path, format: args.format, scope: args.scope, rows: rows.length };
  },
});
