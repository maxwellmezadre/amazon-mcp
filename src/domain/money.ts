// Money is INTEGER CENTS everywhere inside the system; the conversion to a
// decimal happens once, at the tool boundary. Summing floats over a purchase
// history drifts, and the drift lands exactly on the totals people check.

/**
 * Amazon writes prices in two places with two spacings: the accessible price
 * (`span.a-offscreen`) has none — `R$246,80` — while the subtotal rows do —
 * `R$ 246,80`. Reward points arrive negative (`-R$ 0,96`).
 */
const MONEY = /(-)?\s*R\$\s*(-)?\s*(\d[\d.]*)(?:,(\d{1,2}))?/;
const FREE = /^(gr[áa]tis|gratuito|free|sem custo)$/i;

/**
 * Parses a Brazilian amount into cents. Returns `null` when nothing parses —
 * NEVER 0, because "no price on this row" and "this row costs nothing" are
 * different facts and only one of them should be summed.
 */
export function parseBrl(text: string | null | undefined): number | null {
  const raw = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (raw === "") return null;
  if (FREE.test(raw)) return 0;

  const match = MONEY.exec(raw);
  if (!match) return null;
  const [, leadingMinus, innerMinus, whole, fraction = ""] = match;
  // "." is the thousands separator in pt-BR; "," is the decimal one.
  const units = Number(whole!.replace(/\./g, ""));
  if (!Number.isFinite(units)) return null;
  const cents = units * 100 + Number(fraction.padEnd(2, "0"));
  return leadingMinus || innerMinus ? -cents : cents;
}

/** Tool-boundary conversion: 24680 -> 246.8. */
export function toDecimal(cents: number): number {
  return Math.round(cents) / 100;
}

export type Money = { amount: number; currency: "BRL" };

export function money(cents: number | null | undefined): Money | null {
  return cents === null || cents === undefined ? null : { amount: toDecimal(cents), currency: "BRL" };
}
