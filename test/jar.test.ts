import { describe, expect, test } from "bun:test";
import {
  AUTH_COOKIE_PATTERN,
  CSD_COOKIE,
  type Cookie,
  authCookieNames,
  cookieSignature,
  findCookie,
  hasAuthCookies,
  hasCsdKey,
  identityCookieNames,
  hostMatches,
  inSiteDomain,
  registrableDomain,
  sessionIdOf,
  soonestExpiry,
} from "../src/session/jar.js";

const cookie = (partial: Partial<Cookie> & Pick<Cookie, "name" | "value">): Cookie => ({
  domain: ".amazon.com.br",
  path: "/",
  expires: -1,
  httpOnly: false,
  secure: true,
  ...partial,
});

describe("hostMatches", () => {
  test("matches the domain itself and its subdomains", () => {
    expect(hostMatches("www.amazon.com.br", ".amazon.com.br")).toBe(true);
    expect(hostMatches("amazon.com.br", "amazon.com.br")).toBe(true);
    expect(hostMatches("www.amazon.com.br", "www.amazon.com.br")).toBe(true);
  });

  test("never matches a different registrable domain", () => {
    expect(hostMatches("www.amazon.com", ".amazon.com.br")).toBe(false);
    expect(hostMatches("evil-amazon.com.br", "amazon.com.br")).toBe(false);
  });
});

describe("inSiteDomain", () => {
  test("keeps host-only cookies of subdomains that hostMatches would drop", () => {
    expect(inSiteDomain("www.amazon.com.br", "amazon.com.br")).toBe(true);
    expect(hostMatches("amazon.com.br", "www.amazon.com.br")).toBe(false);
  });

  test("drops third-party cookies", () => {
    expect(inSiteDomain(".google.com", "amazon.com.br")).toBe(false);
    expect(inSiteDomain("media-amazon.com", "amazon.com.br")).toBe(false);
  });
});

describe("registrableDomain", () => {
  test("drops a leading www", () => {
    expect(registrableDomain("www.amazon.com.br")).toBe("amazon.com.br");
    expect(registrableDomain("amazon.com.br")).toBe("amazon.com.br");
  });
});

describe("account signals", () => {
  test("recognises the access-token cookies of ANY marketplace suffix", () => {
    // amazon.com uses -main, amazon.com.br uses -acbbr; hardcoding either is how
    // detection silently never matches.
    expect(AUTH_COOKIE_PATTERN.test("at-main")).toBe(true);
    expect(AUTH_COOKIE_PATTERN.test("at-acbbr")).toBe(true);
    expect(AUTH_COOKIE_PATTERN.test("sess-at-acbbr")).toBe(true);

    const jar = [cookie({ name: "session-id", value: "139-9338268-4563450" })];
    expect(hasAuthCookies(jar)).toBe(false);
    jar.push(cookie({ name: "at-acbbr", value: "secret", httpOnly: true }));
    expect(hasAuthCookies(jar)).toBe(true);
    expect(authCookieNames(jar)).toEqual(["at-acbbr"]);
  });

  test("identity cookies are not proof of a session: they survive a sign-out", () => {
    // x-acbbr is what lets Amazon greet you by name while logged out.
    const signedOut = [
      cookie({ name: "x-acbbr", value: "remembered" }),
      cookie({ name: "ubid-acbbr", value: "device" }),
      cookie({ name: "session-id", value: "139-1-1" }),
    ];
    expect(hasAuthCookies(signedOut)).toBe(false);
    expect(identityCookieNames(signedOut)).toEqual(["x-acbbr", "ubid-acbbr"]);
  });

  test("csd-key is tracked apart: a valid session without it renders nothing", () => {
    const jar = [cookie({ name: "at-main", value: "secret", httpOnly: true })];
    expect(hasAuthCookies(jar)).toBe(true);
    expect(hasCsdKey(jar)).toBe(false);
    jar.push(cookie({ name: CSD_COOKIE, value: "abc" }));
    expect(hasCsdKey(jar)).toBe(true);
  });

  test("exposes session-id, which has the very shape of an order number", () => {
    const jar = [cookie({ name: "session-id", value: "139-9338268-4563450" })];
    expect(sessionIdOf(jar)).toBe("139-9338268-4563450");
    expect(sessionIdOf(jar)).toMatch(/^\d{3}-\d{7}-\d{7}$/);
    expect(sessionIdOf([])).toBeUndefined();
  });

  test("findCookie and soonestExpiry ignore session cookies", () => {
    const jar = [
      cookie({ name: "a", value: "1", expires: -1 }),
      cookie({ name: "b", value: "2", expires: 2_000 }),
      cookie({ name: "c", value: "3", expires: 1_000 }),
    ];
    expect(findCookie(jar, "b")?.value).toBe("2");
    expect(soonestExpiry(jar)).toBe(1_000);
    expect(soonestExpiry([cookie({ name: "a", value: "1" })])).toBeUndefined();
  });
});

describe("cookieSignature", () => {
  test("is order-independent and ignores expiry-only refreshes", () => {
    const a = [cookie({ name: "x", value: "1" }), cookie({ name: "y", value: "2" })];
    const reordered = [cookie({ name: "y", value: "2" }), cookie({ name: "x", value: "1" })];
    const refreshed = [
      cookie({ name: "x", value: "1", expires: 999 }),
      cookie({ name: "y", value: "2", expires: 888 }),
    ];
    expect(cookieSignature(a)).toBe(cookieSignature(reordered));
    expect(cookieSignature(a)).toBe(cookieSignature(refreshed));
  });

  test("changes when a value rotates", () => {
    const before = [cookie({ name: "x", value: "1" })];
    const after = [cookie({ name: "x", value: "2" })];
    expect(cookieSignature(before)).not.toBe(cookieSignature(after));
  });
});
