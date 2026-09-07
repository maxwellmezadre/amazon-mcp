import { Type } from "@sinclair/typebox";
import type { SpendingGroup } from "../cache/repo.js";
import { addMonths, dayFromEpochMs } from "../domain/dates.js";
import { money } from "../domain/money.js";
import { dayField } from "./fields.js";
import { defineTool } from "./define.js";

const GROUPS = ["month", "year", "seller", "payment_method", "type", "breakdown"] as const;

const NOTES: Record<SpendingGroup, string> = {
  month: "Totais por mês, do mais recente para o mais antigo.",
  year: "Totais por ano.",
  seller: "Totais por vendedor do primeiro item de cada pedido.",
  payment_method: "Totais por forma de pagamento.",
  type: "physical = produtos entregues; digital = assinaturas e conteúdo.",
  breakdown:
    "Composição do gasto no período: subtotal, frete, promoções, pontos de recompensa e imposto. " +
    "Descontos e pontos aparecem negativos.",
};

export const spendingSummary = defineTool({
  name: "spending_summary",
  description:
    "Soma quanto foi gasto na Amazon, agrupado por mês, ano, vendedor, forma de pagamento, tipo de " +
    "pedido, ou aberto por composição (frete, promoção, pontos, imposto). Responde do cache, sem " +
    "rede. Pedidos cancelados ficam de fora por padrão, porque não são dinheiro gasto.",
  readOnly: true,
  input: Type.Object({
    group_by: Type.Union(
      GROUPS.map((group) => Type.Literal(group)),
      { description: "Como agrupar o total" },
    ),
    from: dayField("Data inicial (YYYY-MM-DD)"),
    to: dayField("Data final (YYYY-MM-DD)"),
    include_cancelled: Type.Optional(
      Type.Boolean({ description: "Inclui cancelados (default false)" }),
    ),
  }),
  run: (args, ctx) => {
    const cache = ctx.cache();
    const filters = {
      ...(args.from ? { from: args.from } : {}),
      ...(args.to ? { to: args.to } : {}),
      ...(args.include_cancelled === undefined
        ? {}
        : { includeCancelled: args.include_cancelled }),
    };
    const rows = cache.spending(args.group_by, filters);
    const grandTotal = rows.reduce((sum, row) => sum + row.totalCents, 0);

    return {
      groupBy: args.group_by,
      period: { from: args.from ?? null, to: args.to ?? null },
      includeCancelled: args.include_cancelled === true,
      rows: rows.map((row) => ({
        key: row.key,
        orders: row.orders,
        ...(args.group_by === "breakdown" ? {} : { items: row.items }),
        total: money(row.totalCents),
      })),
      // A breakdown already contains the total as one of its lines; summing the
      // lines would double-count it.
      grandTotal:
        args.group_by === "breakdown"
          ? (money(rows.find((row) => row.key === "total")?.totalCents ?? null) ?? null)
          : money(grandTotal),
      note: NOTES[args.group_by],
    };
  },
});

export const installmentsSchedule = defineTool({
  name: "installments_schedule",
  description:
    "Cronograma PROJETADO das parcelas em aberto, mês a mês. A Amazon informa quantas parcelas e o " +
    "valor de cada uma, mas NÃO informa as datas de vencimento — quem controla isso é a fatura do " +
    "cartão. Portanto as datas aqui são estimadas (primeira parcela na data do pedido, as demais a " +
    "cada mês) e vêm sempre marcadas com projected: true. Nunca apresente como confirmado pela Amazon.",
  readOnly: true,
  input: Type.Object({
    from: dayField("Início do cronograma (YYYY-MM-DD, default hoje)"),
    months: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 36, description: "Quantos meses à frente (default 12)" }),
    ),
  }),
  run: (args, ctx) => {
    const cache = ctx.cache();
    const from = args.from ?? dayFromEpochMs(ctx.now());
    const months = args.months ?? 12;
    const until = addMonths(from, months);

    const byMonth = new Map<string, { cents: number; orders: Set<string> }>();
    for (const row of cache.listOrders({ hasInstallments: true, limit: 500 })) {
      const count = row.installments ?? 0;
      const amount = row.installment_cents;
      if (count < 2 || amount === null || row.purchased_at === null) continue;
      for (let n = 0; n < count; n += 1) {
        // Projection: first instalment on the order date, then monthly.
        const due = addMonths(row.purchased_at, n);
        if (due < from || due >= until) continue;
        const key = due.slice(0, 7);
        const bucket = byMonth.get(key) ?? { cents: 0, orders: new Set<string>() };
        bucket.cents += amount;
        bucket.orders.add(row.order_id);
        byMonth.set(key, bucket);
      }
    }

    const rows = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, bucket]) => ({
        month,
        amount: money(bucket.cents),
        orders: bucket.orders.size,
      }));

    return {
      projected: true,
      period: { from, months },
      rows,
      total: money(rows.reduce((sum, row) => sum + Math.round((row.amount?.amount ?? 0) * 100), 0)),
      warning:
        "Datas estimadas. A Amazon não expõe o vencimento das parcelas; confira na fatura do cartão.",
      ...(rows.length === 0
        ? { note: "Nenhuma parcela projetada nesse período." }
        : {}),
    };
  },
});
