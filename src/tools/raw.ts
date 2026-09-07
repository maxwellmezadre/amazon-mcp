import { Type } from "@sinclair/typebox";
import { defineTool } from "./define.js";

// Escape hatch for rediscovery when Amazon changes something (see
// docs/REDISCOVERY.md). It rides the same browser, pacing and breaker as every
// other page load, and it is fenced in two ways:
//   - the path must be one of the buyer-facing order surfaces;
//   - the account is never written to, so only GET navigations happen here.

/**
 * Read-only order surfaces. Anything outside this list is refused rather than
 * guessed at: an open-ended fetcher pointed at an authenticated Amazon session
 * is a much bigger tool than this project wants to be.
 */
export const ALLOWED_PATHS = [
  "/your-orders/",
  "/gp/css/",
  "/gp/your-account/order-history",
  "/gp/orc/returns",
  "/your-returns",
  "/pay/history",
] as const;

export const MAX_RAW_BYTES = 64 * 1024;

export function isAllowedPath(path: string): boolean {
  if (!path.startsWith("/") || path.includes("..")) return false;
  const clean = path.split("?")[0] ?? "";
  return ALLOWED_PATHS.some((prefix) => clean.startsWith(prefix));
}

export const rawGet = defineTool({
  name: "raw_get",
  description:
    "Abre uma página da Amazon no navegador e devolve o HTML já descriptografado, sem interpretar. " +
    "Serve para redescobrir um seletor quando o site muda; use com parcimônia e nunca em rajada. " +
    "Só caminhos de leitura de pedidos (/your-orders/, /gp/css/, /your-returns, /pay/history); " +
    "qualquer outro é recusado, porque este servidor nunca altera a conta.",
  readOnly: true,
  input: Type.Object({
    path: Type.String({
      description:
        "Caminho a partir de www.amazon.com.br, ex.: /your-orders/orders?timeFilter=year-2025",
    }),
    ready_selector: Type.Optional(
      Type.String({
        description:
          "Seletor CSS que prova que a página terminou de descriptografar (default: body)",
      }),
    ),
    max_bytes: Type.Optional(
      Type.Integer({
        minimum: 1024,
        maximum: MAX_RAW_BYTES,
        description: `Corta o HTML neste tamanho (default ${MAX_RAW_BYTES})`,
      }),
    ),
  }),
  run: async (args, ctx) => {
    const path = args.path.trim();
    if (!isAllowedPath(path)) {
      throw new Error(
        `Caminho fora do escopo: "${path}". Só são aceitos caminhos de leitura de pedidos: ${ALLOWED_PATHS.join(", ")}.`,
      );
    }

    const page = await ctx.amazon.page(path, {
      readySelector: args.ready_selector ?? "body",
    });

    const limit = args.max_bytes ?? MAX_RAW_BYTES;
    const truncated = page.html.length > limit;
    return {
      url: page.url,
      title: page.title,
      bytes: page.html.length,
      truncated,
      html: truncated ? `${page.html.slice(0, limit)}…` : page.html,
    };
  },
});
