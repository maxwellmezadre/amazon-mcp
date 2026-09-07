// Pure cookie-jar helpers, no I/O. The cookie shape is Playwright's
// (`context.cookies()` / `storageState`), so the login bootstrap persists
// exactly what it captured — including the HttpOnly authentication cookies that
// `document.cookie` never shows — and the headless transport injects the same
// set back with `addCookies`.
//
// There is no `Cookie:` header builder and no Set-Cookie merger here: every
// request goes through a real browser, which owns cookie handling. The jar is
// the bridge between runs, not the transport.

export type SameSite = "Strict" | "Lax" | "None";

export type Cookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds; -1 = session cookie (Playwright's convention). */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: SameSite;
};

/**
 * The cookies that actually authenticate. They are HttpOnly, so they exist only
 * in the browser's own store — a `document.cookie` dump would look complete and
 * still be useless.
 */
export const AUTH_COOKIES = ["at-main", "sess-at-main", "x-main"] as const;

/**
 * The key Amazon's client-side decryption uses to turn the encrypted order
 * cards into real DOM. Not HttpOnly, and not authentication: a session can be
 * perfectly valid and still render nothing without it.
 */
export const CSD_COOKIE = "csd-key";

const stripDot = (domain: string): string => domain.replace(/^\./, "").toLowerCase();

/**
 * Deliberately liberal: a host-only cookie (`amazon.com.br`) also matches
 * subdomains. The session spans `www.amazon.com.br` and its siblings, and the
 * RFC 6265 host-only rule would drop cookies the browser itself sent for that
 * same registrable domain.
 */
export function hostMatches(host: string, domain: string): boolean {
  const wanted = stripDot(domain);
  const actual = host.toLowerCase();
  return actual === wanted || actual.endsWith(`.${wanted}`);
}

/**
 * Whether a cookie belongs to the site, i.e. its domain is the registrable
 * domain or a subdomain of it. Note the direction: `hostMatches` asks "would
 * this HOST send this cookie", which drops host-only cookies of subdomains
 * (`www.amazon.com.br`) when filtering a whole jar by `amazon.com.br`.
 */
export function inSiteDomain(cookieDomain: string, registrable: string): boolean {
  const domain = stripDot(cookieDomain);
  const site = stripDot(registrable);
  return domain === site || domain.endsWith(`.${site}`);
}

/**
 * Registrable domain of the configured host, used to filter the jar at login.
 *
 * ponytail: drops a leading `www.`, nothing else. A public-suffix list would be
 * a dependency for one host; swap it in if this ever serves more marketplaces
 * than amazon.com.br.
 */
export function registrableDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

export function findCookie(cookies: readonly Cookie[], name: string): Cookie | undefined {
  return cookies.find((cookie) => cookie.name === name);
}

/** Names of the authentication cookies present in the jar. */
export function authCookieNames(cookies: readonly Cookie[]): string[] {
  return AUTH_COOKIES.filter((name) => findCookie(cookies, name) !== undefined);
}

/** A jar without one of these cannot be logged in, whatever else it carries. */
export function hasAuthCookies(cookies: readonly Cookie[]): boolean {
  return authCookieNames(cookies).length > 0;
}

/** Without `csd-key` the order cards stay encrypted even on a valid session. */
export function hasCsdKey(cookies: readonly Cookie[]): boolean {
  return findCookie(cookies, CSD_COOKIE) !== undefined;
}

/**
 * The `session-id` cookie, which has EXACTLY the same shape as an Amazon order
 * number (`139-9338268-4563450`) and appears in dozens of telemetry URLs on
 * every page. The list parser compares against it so a leaked session id can
 * never be stored as if it were an order.
 */
export function sessionIdOf(cookies: readonly Cookie[]): string | undefined {
  return findCookie(cookies, "session-id")?.value;
}

/** Earliest expiry among the persistent cookies, in unix seconds. */
export function soonestExpiry(cookies: readonly Cookie[]): number | undefined {
  const expiries = cookies.map((cookie) => cookie.expires).filter((value) => value > 0);
  return expiries.length > 0 ? Math.min(...expiries) : undefined;
}

/**
 * Identity of a jar for change detection: name=value only, sorted. Expiry-only
 * refreshes deliberately do not count, otherwise every page load would rewrite
 * the session file.
 */
export function cookieSignature(cookies: readonly Cookie[]): string {
  return cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .sort()
    .join(";");
}
