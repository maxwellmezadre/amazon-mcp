// Amazon never ships an ISO date in the page: everything is a pt-BR label, and
// several of them omit the year ("Entregue em 2 de dezembro"). Parsing needs
// the current date, which is injected so the tests stay deterministic.

const MONTHS = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** "22 de dezembro de 2024" and the year-less "2 de dezembro". */
const DATE = /(\d{1,2})\s*(?:º|°)?\s+de\s+([a-zç]+)(?:\s+de\s+(\d{4}))?/i;

const iso = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/**
 * Parses a pt-BR date label into `YYYY-MM-DD`, or `null` when it does not look
 * like one. Never guesses a shape it did not see.
 *
 * When the label carries no year — Amazon drops it for recent deliveries — the
 * year is inferred: a date that would land in the future belongs to last year.
 */
export function parseDateBR(text: string | null | undefined, now: Date): string | null {
  const match = DATE.exec(stripAccents(String(text ?? "")).toLowerCase());
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTHS.indexOf(match[2] as string) + 1;
  if (month === 0 || day < 1 || day > 31) return null;
  if (match[3]) return iso(Number(match[3]), month, day);

  let year = now.getFullYear();
  const ahead =
    month > now.getMonth() + 1 || (month === now.getMonth() + 1 && day > now.getDate());
  if (ahead) year -= 1;
  return iso(year, month, day);
}

/** Unix ms to `YYYY-MM-DD` in UTC. */
export function dayFromEpochMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Adds whole months, clamping the day so 31 Jan + 1 month is the last of February. */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return iso(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(date, lastDay));
}
