// Shipping addresses come as free text with a variable number of lines. The
// only reliable anchor is the CEP line, which also carries the city and the
// state; everything before it is the recipient plus street lines.

export type Address = {
  recipient: string | null;
  lines: string[];
  city: string | null;
  state: string | null;
  postalCode: string | null;
  raw: string;
};

const CEP = /(\d{5}-?\d{3})/;

export function parseAddress(text: string | null | undefined): Address | null {
  const raw = String(text ?? "").trim();
  if (raw === "") return null;

  const lines = raw
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return null;

  const cepIndex = lines.findIndex((line) => CEP.test(line));
  const cepLine = cepIndex >= 0 ? (lines[cepIndex] as string) : null;

  return {
    recipient: lines[0] ?? null,
    lines: lines.slice(1, cepIndex < 0 ? undefined : cepIndex),
    // "Cidade, RS 95690-000"
    city: cepLine ? (cepLine.split(",")[0]?.trim() ?? null) : null,
    state: cepLine ? (/\b([A-Z]{2})\b/.exec(cepLine)?.[1] ?? null) : null,
    postalCode: cepLine ? (CEP.exec(cepLine)?.[1] ?? null) : null,
    raw,
  };
}

/**
 * The recipient name is rendered twice on the orders page: once in the `<h5>`
 * and once inside the address popover. Dropping the duplicate keeps the address
 * lines honest.
 */
export function dedupeRecipient(address: Address): Address {
  if (address.recipient === null) return address;
  return { ...address, lines: address.lines.filter((line) => line !== address.recipient) };
}
