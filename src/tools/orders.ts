import { Type } from "@sinclair/typebox";
import { DETAIL_READY, orderDetailPath } from "../amazon/urls.js";
import { parseOrderDetail } from "../amazon/detail.js";
import { PARSER_VERSION } from "../cache/sync.js";
import { itemOut, orderDetailOut, orderOut } from "../cache/rows.js";
import type { OrderFilters } from "../cache/repo.js";
import { ORDER_STATUSES } from "../domain/status.js";
import { compactField, dayField, limitField, offsetField, orderIdField } from "./fields.js";
import { defineTool } from "./define.js";

const NO_CACHE = "O cache está vazio. Rode `sync` (ou a tool sync) primeiro.";

function filtersFrom(args: Record<string, unknown>): OrderFilters {
  return {
    ...(args.from ? { from: args.from as string } : {}),
    ...(args.to ? { to: args.to as string } : {}),
    ...(args.status ? { status: args.status as OrderFilters["status"] } : {}),
    ...(args.type ? { type: args.type as OrderFilters["type"] } : {}),
    ...(args.seller ? { seller: args.seller as string } : {}),
    ...(args.min_total ? { minTotalCents: Math.round((args.min_total as number) * 100) } : {}),
    ...(args.max_total ? { maxTotalCents: Math.round((args.max_total as number) * 100) } : {}),
    ...(args.has_installments === undefined
      ? {}
      : { hasInstallments: args.has_installments as boolean }),
    ...(args.include_cancelled === undefined
      ? {}
      : { includeCancelled: args.include_cancelled as boolean }),
  };
}

export const listOrders = defineTool({
  name: "list_orders",
  description:
    "Lista os pedidos da Amazon a partir do cache local, do mais novo para o mais antigo, com os " +
    "itens de cada um. Não usa a rede. Pedidos cancelados ficam de fora por padrão. Atenção: a " +
    "Amazon remove o texto de status de pedidos antigos, então `status` costuma vir `unknown` em " +
    "compras de anos anteriores; isso não quer dizer que algo deu errado.",
  readOnly: true,
  input: Type.Object({
    from: dayField("Data inicial (YYYY-MM-DD)"),
    to: dayField("Data final (YYYY-MM-DD)"),
    status: Type.Optional(
      Type.Union(
        ORDER_STATUSES.map((status) => Type.Literal(status)),
        { description: "Filtra por situação" },
      ),
    ),
    type: Type.Optional(
      Type.Union([Type.Literal("physical"), Type.Literal("digital")], {
        description: "physical = produto entregue; digital = assinatura ou conteúdo",
      }),
    ),
    seller: Type.Optional(Type.String({ description: "Filtra por vendedor (busca parcial)" })),
    min_total: Type.Optional(Type.Number({ description: "Valor mínimo do pedido, em reais" })),
    max_total: Type.Optional(Type.Number({ description: "Valor máximo do pedido, em reais" })),
    has_installments: Type.Optional(Type.Boolean({ description: "Só pedidos parcelados" })),
    include_cancelled: Type.Optional(
      Type.Boolean({ description: "Inclui cancelados (default false)" }),
    ),
    sort: Type.Optional(
      Type.Union(
        [
          Type.Literal("date_desc"),
          Type.Literal("date_asc"),
          Type.Literal("total_desc"),
          Type.Literal("total_asc"),
        ],
        { description: "Ordenação (default date_desc)" },
      ),
    ),
    limit: limitField(200, 50),
    offset: offsetField,
    compact: compactField,
  }),
  run: (args, ctx) => {
    const cache = ctx.cache();
    const filters: OrderFilters = {
      ...filtersFrom(args as Record<string, unknown>),
      ...(args.sort ? { sort: args.sort } : {}),
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    };
    const rows = cache.listOrders(filters);
    const total = cache.countOrders(filters);
    return {
      total,
      orders: rows.map((row) => orderOut(row, cache.getItems(row.order_id), args.compact === true)),
      ...(total === 0 && cache.stats().orders === 0 ? { note: NO_CACHE } : {}),
    };
  },
});

export const getOrder = defineTool({
  name: "get_order",
  description:
    "Detalhe completo de um pedido: itens com preço unitário e vendedor, todos os subtotais (frete, " +
    "promoção, pontos de recompensa, imposto), forma de pagamento com parcelamento, endereço e " +
    "links de nota fiscal. Responde do cache; só usa a rede (1 página) se o detalhe ainda não tiver " +
    "sido buscado, ou com refresh=true.",
  readOnly: true,
  input: Type.Object({
    order_id: orderIdField,
    refresh: Type.Optional(
      Type.Boolean({ description: "Busca a página de novo mesmo se já estiver em cache" }),
    ),
  }),
  run: async (args, ctx) => {
    const cache = ctx.cache();
    let row = cache.getOrder(args.order_id);
    if (!row) {
      throw new Error(
        `Pedido ${args.order_id} não está no cache. Rode \`sync\` ou confira o número.`,
      );
    }

    if (args.refresh || row.detail_fetched_at === null) {
      const page = await ctx.amazon.page(orderDetailPath(args.order_id), {
        readySelector: DETAIL_READY,
      });
      const detail = parseOrderDetail(
        page.html,
        { now: new Date(ctx.now()), sourceUrl: page.url },
        ctx.config.baseUrl,
      );
      cache.upsertDetail(
        { ...detail, orderId: args.order_id },
        Bun.gzipSync(Buffer.from(page.html)),
        PARSER_VERSION,
      );
      row = cache.getOrder(args.order_id) ?? row;
    }

    return orderDetailOut(row, cache.getItems(args.order_id), cache.getShipments(args.order_id));
  },
});

export const searchProducts = defineTool({
  name: "search_products",
  description:
    "Busca por texto em tudo que já foi comprado (título e vendedor), respondendo do cache, sem " +
    "rede. Ignora acentos e maiúsculas. Responde perguntas como \"quando comprei X e por quanto\".",
  readOnly: true,
  input: Type.Object({
    query: Type.String({ minLength: 2, description: "Termo de busca" }),
    from: dayField("Data inicial (YYYY-MM-DD)"),
    to: dayField("Data final (YYYY-MM-DD)"),
    limit: limitField(200, 30),
  }),
  run: (args, ctx) => {
    const cache = ctx.cache();
    const rows = cache.searchItems(args.query, {
      ...(args.from ? { from: args.from } : {}),
      ...(args.to ? { to: args.to } : {}),
      limit: args.limit ?? 30,
    });
    return {
      total: rows.length,
      items: rows.map((row) => ({
        ...itemOut(row),
        orderId: row.order_id,
        date: row.purchased_at,
        status: row.status,
      })),
      ...(rows.length === 0 && cache.stats().orders === 0 ? { note: NO_CACHE } : {}),
    };
  },
});
