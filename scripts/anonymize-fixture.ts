#!/usr/bin/env bun
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// task/captures (real account) -> test/fixtures (committable).
//
// Deterministic: the same salt maps an id or a word to the same stand-in, so
// the relationships between a list card and its detail page survive and the
// parser tests stay meaningful. Amounts, dates, quantities and UI labels are
// left ALONE, so every financial invariant still holds on the anonymised copy.
//
// Usage: bun run scripts/anonymize-fixture.ts [--write]

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const captures = join(process.cwd(), "task", "captures");
const out = join(process.cwd(), "test", "fixtures");
const saltFile = join(process.cwd(), "task", "anonymize.salt");

if (!existsSync(captures)) {
  console.error("task/captures não existe. Rode scripts/capture-fixtures.ts --write antes.");
  process.exit(1);
}
if (!existsSync(saltFile)) {
  writeFileSync(saltFile, randomUUID(), { mode: 0o600 });
}
const salt = readFileSync(saltFile, "utf8").trim();

const hash = (value: string): string => createHash("sha256").update(salt + value).digest("hex");
const digitsFrom = (hex: string, length: number): string =>
  BigInt(`0x${hex}`).toString(10).padStart(length, "7").slice(-length);

/**
 * Values whose presence in the output IS a leak: identifiers and personal data.
 *
 * Deliberately narrow. Pseudonymising a product title is good hygiene, but
 * policing every noun turns page furniture ("Roupas", "Nova") into false
 * positives and trains you to ignore the guard. What must never survive is an
 * identifier, a person, a place or a credential.
 */
const secrets = new Set<string>();
/**
 * Personal WORDS to substitute globally (names, streets, cities).
 *
 * Kept apart from `secrets` on purpose. `secrets` is the leak guard's watch
 * list and also holds identifiers that are rewritten structurally; feeding
 * those into the global word substitution rewrote an order number as a
 * pronounceable word in the next file processed.
 */
const personal = new Set<string>();
const orderIds = new Set<string>();
const asins = new Set<string>();
const mappedIds = new Set<string>();

/** Order numbers keep their prefix, so 702-/701-/D01- still classify correctly. */
function mapOrderId(id: string): string {
  secrets.add(id);
  const [prefix = "", middle = "", last = ""] = id.split("-");
  const digest = hash(id);
  const mapped = `${prefix}-${digitsFrom(digest, middle.length)}-${digitsFrom(digest.slice(20), last.length)}`;
  mappedIds.add(mapped);
  return mapped;
}

/** ASINs keep the "B0" prefix and the 10-character shape. */
function mapAsin(asin: string): string {
  secrets.add(asin);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  const digest = hash(asin);
  let body = "";
  for (let i = 0; i < 8; i += 1) {
    body += alphabet[Number.parseInt(digest.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  }
  return `B0${body}`;
}

/**
 * UI vocabulary that MUST survive verbatim: the parsers match on these strings,
 * so pseudonymising one would leave the tests passing against meaningless data.
 * Bias towards over-inclusion.
 */
const STOPWORDS = new Set(
  [
    "pedido","pedidos","realizado","realizados","feitos","feito","total","geral","deste","do","da","de","em","e",
    "enviar","para","entregue","entrega","cancelado","cancelada","devolucao","devolução","reembolso","retornado",
    "vendido","por","subtotal","produtos","itens","item","ns","frete","manuseio","promocao","promoção","aplicada",
    "pontos","recompensa","desconto","cupom","imposto","vale","presente","forma","pagamento","terminando",
    "sem","com","juros","vista","parcela","parcelas","assinatura","cobrada","nº","numero","número",
    "janeiro","fevereiro","marco","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro",
    "unidade","unidades","quantidade","resumo","impressao","impressão","fatura","nota","fiscal","exibir","detalhes",
    "comprar","novamente","periodo","período","encerrou","se","nao","não","fez","nenhum","um","você","voce","parece","que",
    "ultimos","últimos","dias","meses","mes","mês","ano","anos","status","enviado","ainda","seus","minha","conta",
    "amazon","com","br","ltda","servicos","serviços","varejo","brasil","mastercard","visa","elo","hipercard","amex",
    "sem","cobrancas","cobranças","atuais","endereco","endereço","cobranca","cobrança","dia","data","hora",
  ].map((word) => word.toLowerCase()),
);

const CONSONANTS = "bcdfghjklmnprstvz";
const VOWELS = "aeiou";

/** A pronounceable stand-in of the same length, so layouts stay realistic. */
function pseudoWord(word: string): string {
  const digest = hash(word.toLowerCase());
  let output = "";
  for (let i = 0; i < word.length; i += 1) {
    const byte = Number.parseInt(digest.slice((i * 2) % 60, ((i * 2) % 60) + 2), 16);
    output += i % 2 === 0 ? CONSONANTS[byte % CONSONANTS.length] : VOWELS[byte % VOWELS.length];
  }
  return output;
}

function applyCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement[0]?.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function mapWord(word: string): string {
  if (word.length < 3) return word;
  if (STOPWORDS.has(word.toLowerCase())) return word;
  if (/^\d+$/.test(word)) return word;
  return applyCase(word, pseudoWord(word));
}

/** Replaces the words of a free-text run, leaving punctuation and numbers. */
const mapText = (value: string): string => value.replace(/[A-Za-zÀ-ÿ]{3,}/g, (word) => mapWord(word));

/**
 * Rewrites only TEXT NODES inside a block, never tags or attributes. Running
 * mapText over raw markup renames `class` and `span` and produces unparseable
 * HTML — which is exactly what the first version of this script did.
 */
const mapTextNodes = (block: string): string =>
  block.replace(/>([^<>]+)</g, (_all, inner: string) =>
    /[A-Za-zÀ-ÿ]{3,}/.test(inner) ? `>${mapText(inner)}<` : `>${inner}<`,
  );

/** Personal names must never survive; they are registered as hard secrets. */
function mapPersonName(value: string): string {
  return value.replace(/[A-ZÀ-Þ][a-zà-ÿ]{2,}/g, (word) => {
    if (STOPWORDS.has(word.toLowerCase())) return word;
    personal.add(word);
    secrets.add(word);
    return applyCase(word, pseudoWord(word));
  });
}

/**
 * Collects the personal values of a capture BEFORE any rewriting.
 *
 * Block-scoped rewriting is not enough on its own: Amazon repeats the shipping
 * address inside a `data-a-popover` JSON attribute, and a text-node pass never
 * reaches it. Whatever is learned here is replaced globally, attributes and all.
 */
function learn(html: string): void {
  const add = (value: string | undefined) => {
    const clean = (value ?? "").replace(/\s+/g, " ").trim();
    if (clean.length >= 3 && !STOPWORDS.has(clean.toLowerCase())) {
      personal.add(clean);
      secrets.add(clean);
    }
  };

  // Recipient name: the <h5> of the list card and the first line of the address.
  for (const match of html.matchAll(/class="yohtmlc-recipient"[\s\S]{0,600}?<h5[^>]*>([^<]+)<\/h5>/g)) {
    for (const word of (match[1] ?? "").split(/\s+/)) add(word);
  }
  for (const match of html.matchAll(/data-component="shippingAddress"([\s\S]{0,1600}?)<\/div>/g)) {
    for (const word of (match[1] ?? "").replace(/<[^>]+>/g, " ").split(/[\s,]+/)) {
      // Capitalised words in an address are names, streets and cities.
      if (/^[A-ZÀ-Þ][a-zà-ÿ]{2,}$/.test(word)) add(word);
    }
  }
  // Identifiers are learned, then replaced as literals. A boundary-anchored
  // regex is not enough: in "asins=B098...%2CB0CS7XK3DX" the URL-encoded comma
  // leaves a "C" glued to the next ASIN, so \b never fires there.
  for (const id of html.match(/[A-Z]?\d{2,3}-\d{7}-\d{7}/g) ?? []) orderIds.add(id);
  for (const asin of html.match(/B0[A-Z0-9]{8}/g) ?? []) asins.add(asin);

  // The navigation greeting carries the account holder's first name.
  for (const match of html.matchAll(/Ol[aá],\s*([^<]{2,40})</g)) add(match[1]);

  // Every postcode shape, with or without the dash.
  for (const cep of html.match(/\b\d{5}-?\d{3}\b/g) ?? []) secrets.add(cep);
}

function anonymize(html: string): string {
  let output = html;

  // Learned personal values go first, everywhere: text, attributes and JSON.
  // Case-insensitively, because the same name appears capitalised in the
  // address and lower-case in the navigation greeting ("Ola, maxwell").
  for (const secret of personal) {
    if (/^\d{5}-?\d{3}$/.test(secret)) continue; // postcodes handled below
    const pattern = new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    output = output.replace(pattern, (found) => applyCase(found, pseudoWord(secret)));
  }
  output = output.replace(/\b\d{5}-\d{3}\b/g, "00000-000").replace(/\b\d{5}\d{3}\b/g, "00000000");

  // Identifiers, as literals so no surrounding character can hide one.
  for (const id of orderIds) output = output.split(id).join(mapOrderId(id));
  for (const asin of asins) output = output.split(asin).join(mapAsin(asin));

  // AWS pre-signed invoice URLs are bearer credentials for that PDF. They are
  // removed outright rather than rewritten.
  output = output.replace(
    /https:\/\/s3\.amazonaws\.com\/generated_invoices[^"'\s]*/g,
    "https://s3.amazonaws.com/generated_invoices_v2/EXEMPLO.pdf?X-Amz-Signature=REDACTED",
  );

  // Product titles and the seller name.
  output = output.replace(
    /(<a[^>]*href="\/dp\/[^"]*"[^>]*>)([^<]+)(<\/a>)/g,
    (_all, open: string, title: string, close: string) => `${open}${mapText(title)}${close}`,
  );
  output = output.replace(/(alt=")([^"]+)(")/g, (_all, o: string, alt: string, c: string) => `${o}${mapText(alt)}${c}`);
  output = output.replace(
    /(Vendido por:\s*)([^<]+)/g,
    (_all, label: string, seller: string) => `${label}${mapText(seller)}`,
  );

  // Shipping address: recipient, street, city. The CEP and the state keep their
  // SHAPE so the address parser is still exercised.
  output = output.replace(/\b\d{5}-\d{3}\b/g, "00000-000");
  output = output.replace(/(data-component="shippingAddress"[\s\S]{0,1600}?<\/div>)/g, (block) =>
    mapTextNodes(block).replace(/>([^<>]+)</g, (_a, t: string) => `>${mapPersonName(t)}<`),
  );
  output = output.replace(/(class="yohtmlc-recipient"[\s\S]{0,2400}?<\/div>)/g, (block) =>
    mapTextNodes(block).replace(/>([^<>]+)</g, (_a, t: string) => `>${mapPersonName(t)}<`),
  );
  // The recipient also shows up in popover payloads and page titles.
  for (const secret of [...personal]) {
    output = output.split(secret).join(applyCase(secret, pseudoWord(secret)));
  }

  // Card digits.
  output = output.replace(
    /(terminando em\s*)(\d{4})/gi,
    (_all, label: string, last4: string) => `${label}${digitsFrom(hash(last4), 4)}`,
  );

  // Tracking parameters carry a session fingerprint.
  output = output.replace(/([?&])(ref_?|pd_rd_[a-z]+|pf_rd_[a-z]+|qid|sr|th|psc)=[^"&'\s]*/g, "$1$2=x");

  // The developer banner on the internal build links to Amazon ticketing.
  output = output.replace(/https:\/\/(t\.corp|sim|tiny)\.amazon\.com[^"'\s]*/g, "https://example.invalid/");

  return output;
}

/** Fails loudly if any real value survived into the output. */
function leaks(output: string): string[] {
  const found = new Set<string>();
  for (const secret of secrets) {
    if (secret.length >= 4 && output.includes(secret)) found.add(secret);
  }
  // Anything shaped like a Brazilian postcode other than the placeholder.
  for (const cep of output.match(/\b\d{5}-\d{3}\b/g) ?? []) {
    if (cep !== "00000-000") found.add(cep);
  }
  for (const run of output.match(/\b[A-Z]?\d{2,3}-\d{7}-\d{7}\b/g) ?? []) {
    if (!mappedIds.has(run)) found.add(run);
  }
  if (/X-Amz-Signature=(?!REDACTED)/.test(output)) found.add("X-Amz-Signature");
  return [...found];
}

const FIXTURES: Array<[source: string, alias: string]> = [
  ["orders-year-2026-p1.html", "orders-with-two.html"],
  ["orders-year-2026-p2.html", "orders-last-page.html"],
  ["orders-year-2025-p1.html", "orders-single.html"],
  ["orders-year-2024-p1.html", "orders-empty-year.html"],
  ["orders-last30-p1.html", "orders-empty-last30.html"],
];

console.error(`amazon-mcp — anonimização ${write ? "(gravando)" : "(dry run)"}`);
if (write) mkdirSync(out, { recursive: true });

let failed = false;
const files = new Map<string, string>();

// Learn every id and word first, so the same order looks the same in the list
// fixture and in its detail fixture.
const { readdirSync: readdir } = await import("node:fs");
for (const file of readdir(captures).filter((f) => f.endsWith(".html"))) {
  learn(readFileSync(join(captures, file), "utf8"));
}
console.error(`  ${secrets.size} valor(es) pessoais aprendidos das capturas`);

for (const [source, alias] of FIXTURES) {
  const path = join(captures, source);
  if (!existsSync(path)) {
    console.error(`  faltando ${source}`);
    continue;
  }
  files.set(alias, anonymize(readFileSync(path, "utf8")));
}
for (const name of ["detail", "popover"]) {
  const { readdirSync } = await import("node:fs");
  let index = 0;
  for (const file of readdirSync(captures).filter((f) => f.startsWith(`${name}-`) && f.endsWith(".html"))) {
    const html = readFileSync(join(captures, file), "utf8");
    // Alias by shape, never by order id.
    const kind = file.includes("-D01-") ? "digital" : `physical-${++index}`;
    files.set(`${name}-${kind}.html`, anonymize(html));
  }
}

for (const [alias, html] of files) {
  const problems = leaks(html);
  if (problems.length > 0) {
    console.error(`  RECUSADO ${alias}: ${problems.length} valor(es) vazaram -> ${problems.slice(0, 12).map((p) => JSON.stringify(p.slice(0, 30))).join(", ")}`);
    failed = true;
    continue;
  }
  console.error(`  ${write ? "gravado" : "geraria"} ${alias} (${html.length} bytes)`);
  if (write) {
    const target = join(out, alias);
    writeFileSync(target, html);
    chmodSync(target, 0o644);
  }
}

if (failed) {
  console.error("\nNada foi gravado com vazamento. Corrija o anonimizador.");
  process.exitCode = 1;
}
