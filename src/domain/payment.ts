import { parseBrl } from "./money.js";

// The payment block is rendered by Amazon's payments widget, whose class names
// carry a per-deploy hash (`pmts-portal-root-cvTieIfEt8fS`, `pmts-class-49e45ab6`).
// Two orders in the same session came back with different hashes, so the parser
// reads TEXT and never those classes.
//
// Text observed on a real order:
//   Forma de pagamento
//   Mastercard  terminando em 1234
//   Em 6x de R$ 40,99 sem juros

export const PAYMENT_METHODS = [
  "credit_card",
  "pix",
  "boleto",
  "gift_card",
  "points",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PaymentInfo = {
  method: PaymentMethod | null;
  brand: string | null;
  last4: string | null;
  /** Number of instalments; 1 when paid outright. */
  installments: number | null;
  /** Value of ONE instalment, in cents. */
  installmentCents: number | null;
  interestFree: boolean | null;
  /** The block as read, kept so a wrong parse is auditable. */
  raw: string;
};

const BRANDS = /(Mastercard|Visa|Elo|American Express|Amex|Hipercard|Diners)/i;
const INSTALMENTS = /(\d{1,2})\s*x\s*de\s*R\$\s*[\d.]+,\d{2}/i;

export function parsePayment(blockText: string | null | undefined): PaymentInfo {
  const raw = String(blockText ?? "")
    .replace(/\s+/g, " ")
    .trim();

  const instalment = INSTALMENTS.exec(raw);
  const outright = /[àa]\s*vista|em\s+1x/i.test(raw);
  const interestFree = /sem\s+juros/i.test(raw)
    ? true
    : /com\s+juros/i.test(raw)
      ? false
      : null;

  const brand = BRANDS.exec(raw)?.[1] ?? null;
  const last4 =
    /terminad[oa]\s+em\s+(\d{4})/i.exec(raw)?.[1] ??
    /terminando\s+em\s+(\d{4})/i.exec(raw)?.[1] ??
    /final(?:izado)?\s+(\d{4})/i.exec(raw)?.[1] ??
    null;

  let method: PaymentMethod | null = null;
  if (brand !== null || last4 !== null || /cart[ãa]o\s+de\s+cr[ée]dito/i.test(raw)) {
    method = "credit_card";
  } else if (/\bpix\b/i.test(raw)) {
    method = "pix";
  } else if (/boleto/i.test(raw)) {
    method = "boleto";
  } else if (/vale[- ]presente|gift\s?card/i.test(raw)) {
    method = "gift_card";
  } else if (/pontos/i.test(raw)) {
    method = "points";
  } else if (raw !== "") {
    method = "other";
  }

  return {
    method,
    brand,
    last4,
    installments: instalment ? Number(instalment[1]) : outright ? 1 : null,
    installmentCents: instalment ? parseBrl(instalment[0]) : null,
    interestFree,
    raw,
  };
}
