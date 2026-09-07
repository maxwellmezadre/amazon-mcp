import { Type } from "@sinclair/typebox";
import { chmodSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseInvoicePopover } from "../amazon/popover.js";
import {
  DETAIL_READY,
  POPOVER_READY,
  invoicePopoverPath,
  orderDetailPath,
} from "../amazon/urls.js";
import type { InvoiceLinks } from "../domain/types.js";
import { orderIdField } from "./fields.js";
import { defineTool } from "./define.js";

// The "Baixar nota fiscal" button on the details page is driven by JavaScript
// and has no href, so the popover fragment is the only place the real links
// appear.

/**
 * The NF-e link is an AWS pre-signed URL that expires in about three minutes
 * (`X-Amz-Expires=179` on the live account). It is a bearer credential for that
 * file, so it is fetched fresh at download time and never cached or logged.
 */
export const NFE_LINK_TTL_MS = 150_000;

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export function safeName(name: string | undefined, stem: string, extension: string): string {
  if (name === undefined) return `${stem}.${extension}`;
  if (!SAFE_NAME.test(name) || name.startsWith(".")) {
    throw new Error(
      `Nome de arquivo inválido "${name}": use letras, dígitos, ponto, hífen e sublinhado, sem separadores de caminho.`,
    );
  }
  return name;
}

/** Resolves inside `dir` or refuses; a model chooses these names. */
export function resolveInside(dir: string, name: string): string {
  const target = resolve(join(dir, name));
  if (!target.startsWith(`${resolve(dir)}/`)) {
    throw new Error(`Caminho fora do diretório permitido (${dir}).`);
  }
  return target;
}

async function fetchLinks(ctx: {
  amazon: { page: (path: string, opts: { readySelector: string }) => Promise<{ html: string }> };
  config: { baseUrl: string };
}, orderId: string): Promise<InvoiceLinks> {
  const page = await ctx.amazon.page(invoicePopoverPath(orderId), {
    readySelector: POPOVER_READY,
  });
  return parseInvoicePopover(page.html, ctx.config.baseUrl);
}

export const getInvoice = defineTool({
  name: "get_invoice",
  description:
    "Devolve os links de nota fiscal de um pedido: o resumo para impressão (sempre) e o PDF da NF-e " +
    "quando o vendedor emitiu uma. O link da NF-e é assinado e EXPIRA em poucos minutos, então é " +
    "buscado na hora e não deve ser guardado nem repassado; para salvar o arquivo use download_invoice.",
  readOnly: true,
  input: Type.Object({
    order_id: orderIdField,
    refresh: Type.Optional(
      Type.Boolean({ description: "Ignora o que está em cache e busca de novo" }),
    ),
  }),
  run: async (args, ctx) => {
    const cache = ctx.cache();
    const links = await fetchLinks(ctx, args.order_id);
    cache.setInvoiceLinks(args.order_id, { printSummary: links.printSummary });
    return {
      orderId: args.order_id,
      printSummary: links.printSummary,
      hasNfe: links.nfePdf !== null,
      // Deliberately not returned: a pre-signed URL is a credential, and it is
      // dead in about three minutes anyway.
      note:
        links.nfePdf === null
          ? "Este pedido não tem NF-e no popover; só o resumo para impressão."
          : "A NF-e existe. Use `download_invoice` para salvar o PDF (o link expira em ~3 minutos).",
    };
  },
});

export const downloadInvoice = defineTool({
  name: "download_invoice",
  description:
    "Salva a nota fiscal de um pedido em disco, dentro de AMAZON_EXPORT_DIR. kind=nfe baixa o PDF " +
    "da NF-e emitida pelo vendedor; kind=summary imprime o resumo do pedido em PDF. Escreve arquivo " +
    "local; nunca altera nada na conta.",
  readOnly: false,
  input: Type.Object({
    order_id: orderIdField,
    kind: Type.Optional(
      Type.Union([Type.Literal("nfe"), Type.Literal("summary")], {
        description: "nfe = PDF da nota fiscal (default) | summary = resumo do pedido impresso",
      }),
    ),
    filename: Type.Optional(
      Type.String({ description: "Nome do arquivo (sem caminho); default nfe-<pedido>.pdf" }),
    ),
  }),
  run: async (args, ctx) => {
    const kind = args.kind ?? "nfe";
    const dir = ctx.config.exportDir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = resolveInside(dir, safeName(args.filename, `nfe-${args.order_id}`, "pdf"));

    if (kind === "summary") {
      // Rendering the printable summary is the only way to get a PDF for an
      // order whose seller issued no NF-e.
      const bytes = await ctx.amazon.pdf(orderDetailPath(args.order_id), {
        readySelector: DETAIL_READY,
      });
      await Bun.write(path, bytes);
      chmodSync(path, 0o600);
      return { orderId: args.order_id, kind, path, bytes: bytes.length };
    }

    const links = await fetchLinks(ctx, args.order_id);
    if (!links.nfePdf) {
      throw new Error(
        `O pedido ${args.order_id} não tem NF-e disponível. Use kind="summary" para salvar o resumo do pedido.`,
      );
    }
    const bytes = await ctx.amazon.download(links.nfePdf);
    // Amazon has been observed lying about the content-type of invoice
    // downloads, so the file is confirmed by its magic bytes instead.
    if (!Buffer.from(bytes.subarray(0, 5)).toString("latin1").startsWith("%PDF")) {
      throw new Error("O download da NF-e não retornou um PDF. Tente de novo em alguns segundos.");
    }
    await Bun.write(path, bytes);
    chmodSync(path, 0o600);
    return { orderId: args.order_id, kind, path, bytes: bytes.length };
  },
});
