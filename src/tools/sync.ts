import { Type } from "@sinclair/typebox";
import { runSyncChunk } from "../cache/sync.js";
import { defineTool } from "./define.js";

export const sync = defineTool({
  name: "sync",
  description:
    "Atualiza o cache local com os pedidos da Amazon. É a ÚNICA tool que usa a rede; todas as " +
    "consultas respondem do cache. Trabalha em blocos: se devolver done=false, chame de novo até " +
    "done=true. Cada página leva de 2 a 4 segundos (a Amazon é lenta e o ritmo é proposital), e a " +
    "primeira chamada de cada processo abre um Chrome headless, o que leva alguns segundos a mais. " +
    "mode=full varre todos os anos, incremental só o ano corrente, reparse reprocessa o que já está " +
    "em cache sem usar a rede.",
  readOnly: false,
  input: Type.Object({
    mode: Type.Optional(
      Type.Union(
        [Type.Literal("incremental"), Type.Literal("full"), Type.Literal("reparse")],
        {
          description:
            "incremental (default depois do primeiro full) | full (todos os anos) | reparse (sem rede)",
        },
      ),
    ),
    max_requests: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        description: "Teto de páginas carregadas nesta chamada (default 15)",
      }),
    ),
    with_details: Type.Optional(
      Type.Boolean({
        description:
          "Busca a página de detalhe de cada pedido (preço unitário, vendedor, parcelamento). Default true",
      }),
    ),
    year: Type.Optional(
      Type.String({
        pattern: "^(year-\\d{4}|last30|months-3)$",
        description: "Sincroniza só este período, ex.: year-2024",
      }),
    ),
  }),
  run: (args, ctx) =>
    runSyncChunk(ctx, {
      ...(args.mode ? { mode: args.mode } : {}),
      ...(args.max_requests ? { maxRequests: args.max_requests } : {}),
      ...(args.with_details === undefined ? {} : { withDetails: args.with_details }),
      ...(args.year ? { year: args.year } : {}),
    }),
});
