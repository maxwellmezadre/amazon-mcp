import { parse } from "node-html-parser";
import type { InvoiceLinks } from "../domain/types.js";
import { POPOVER } from "./selectors.js";

// The small fragment behind the "Fatura" button. It is the only place the real
// NF-e link appears: the button on the details page is driven by JavaScript and
// has no href to read.

/**
 * The NF-e link is an AWS pre-signed URL that expires in about three minutes
 * (`X-Amz-Expires=179`). It must be fetched immediately before a download and
 * never cached or logged — it is a bearer credential for that file.
 */
export const NFE_URL = /generated_invoices|\.pdf(\?|$)/i;

export function parseInvoicePopover(html: string, baseUrl = "https://www.amazon.com.br"): InvoiceLinks {
  const root = parse(html);
  const scope = root.querySelector(POPOVER.list) ?? root;
  let printSummary: string | null = null;
  let nfePdf: string | null = null;

  for (const link of scope.querySelectorAll(POPOVER.link)) {
    const href = link.getAttribute("href");
    if (!href) continue;
    const absolute = href.startsWith("http") ? href : new URL(href, baseUrl).toString();
    if (href.includes("summary/print.html")) printSummary ??= absolute;
    else if (NFE_URL.test(href)) nfePdf ??= absolute;
  }
  return { printSummary, nfePdf };
}
