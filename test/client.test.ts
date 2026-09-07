import { describe, expect, test } from "bun:test";
import {
  COOLDOWN_MS,
  MAX_ATTEMPTS,
  backoffMs,
  createBrowserClient,
  isRetryable,
} from "../src/browser/client.js";
import type { PageLoader } from "../src/browser/transport.js";
import type { PageResult } from "../src/browser/types.js";
import { AuthError, CaptchaError, CsdError, HttpError, ParseError } from "../src/core/errors.js";
import { fakeClock, memoryCooldown, silentLogger } from "./helpers.js";

const BASE = "https://www.amazon.com.br";
const OPTS = { readySelector: "#time-filter" };

/** A loader made of a script of outcomes: an Error is thrown, anything else resolves. */
function scriptedLoader(outcomes: unknown[]) {
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const loader: PageLoader = {
    running: () => true,
    close: async () => undefined,
    load: async (url) => {
      calls.push(url);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield so overlapping callers would actually overlap.
      await Promise.resolve();
      inFlight -= 1;
      const outcome = outcomes.shift();
      if (outcome instanceof Error) throw outcome;
      return (outcome ?? { url, title: "t", html: "<html></html>" }) as PageResult;
    },
  };
  return { loader, calls, stats: () => ({ maxInFlight }) };
}

function client(outcomes: unknown[], cooldown = memoryCooldown()) {
  const clock = fakeClock();
  const log = silentLogger();
  const scripted = scriptedLoader(outcomes);
  return {
    clock,
    log,
    cooldown,
    scripted,
    client: createBrowserClient(
      {
        loader: scripted.loader,
        baseUrl: BASE,
        minIntervalMs: 2000,
        jitterMs: 2000,
        log,
        cooldown,
      },
      { sleep: clock.sleep, now: clock.now, random: () => 0.5 },
    ),
  };
}

describe("backoff", () => {
  test("doubles from 30s and caps at 10 min", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(9)).toBe(600_000);
    expect(MAX_ATTEMPTS).toBe(3);
  });

  test("only a transport hiccup or a missed decryption is worth retrying", () => {
    expect(isRetryable(new CsdError("x"))).toBe(true);
    expect(isRetryable(new HttpError(0, "x"))).toBe(true);
    expect(isRetryable(new AuthError("x"))).toBe(false);
    expect(isRetryable(new CaptchaError("x"))).toBe(false);
    expect(isRetryable(new ParseError("x"))).toBe(false);
  });
});

describe("pacing", () => {
  test("waits the interval plus jitter between loads", async () => {
    const { client: amazon, clock } = client([{}, {}]);
    await amazon.page("/your-orders/orders", OPTS);
    await amazon.page("/your-orders/orders?page=2", OPTS);
    // 2000 + 0.5 * 2000 = 3000 ms; the first load starts immediately.
    expect(clock.slept).toEqual([3000]);
  });

  test("resolves paths against the base url", async () => {
    const { client: amazon, scripted } = client([{}]);
    await amazon.page("/your-orders/orders?timeFilter=year-2025", OPTS);
    expect(scripted.calls).toEqual([`${BASE}/your-orders/orders?timeFilter=year-2025`]);
  });

  test("never lets two loads overlap, and keeps their order", async () => {
    const { client: amazon, scripted } = client([{}, {}, {}]);
    await Promise.all([
      amazon.page("/a", OPTS),
      amazon.page("/b", OPTS),
      amazon.page("/c", OPTS),
    ]);
    expect(scripted.stats().maxInFlight).toBe(1);
    expect(scripted.calls).toEqual([`${BASE}/a`, `${BASE}/b`, `${BASE}/c`]);
  });

  test("one failure does not deadlock the queue", async () => {
    const { client: amazon, scripted } = client([new ParseError("boom"), {}]);
    await expect(amazon.page("/a", OPTS)).rejects.toThrow(ParseError);
    await amazon.page("/b", OPTS);
    expect(scripted.calls).toHaveLength(2);
  });
});

describe("retries", () => {
  test("retries a missed decryption with exponential backoff", async () => {
    const { client: amazon, clock, scripted } = client([
      new CsdError("not decrypted"),
      new CsdError("still not"),
      {},
    ]);
    await amazon.page("/your-orders/orders", OPTS);
    expect(scripted.calls).toHaveLength(3);
    expect(clock.slept).toContain(30_000);
    expect(clock.slept).toContain(60_000);
  });

  test("gives up after the third attempt and reports the real error", async () => {
    const { client: amazon, scripted } = client([
      new CsdError("a"),
      new CsdError("b"),
      new CsdError("c"),
      {},
    ]);
    await expect(amazon.page("/x", OPTS)).rejects.toThrow(CsdError);
    expect(scripted.calls).toHaveLength(MAX_ATTEMPTS);
  });

  test("an expired session is a verdict, not a hiccup", async () => {
    const { client: amazon, scripted } = client([new AuthError("expired"), {}]);
    await expect(amazon.page("/x", OPTS)).rejects.toThrow(AuthError);
    expect(scripted.calls).toHaveLength(1);
  });

  test("a changed layout is not retried either", async () => {
    const { client: amazon, scripted } = client([new ParseError("layout"), {}]);
    await expect(amazon.page("/x", OPTS)).rejects.toThrow(ParseError);
    expect(scripted.calls).toHaveLength(1);
  });
});

describe("anti-bot breaker", () => {
  test("a captcha trips the breaker and persists a 30 min cooldown", async () => {
    const { client: amazon, clock, cooldown, scripted, log } = client([
      new CaptchaError("waf"),
      {},
    ]);
    await expect(amazon.page("/x", OPTS)).rejects.toThrow(CaptchaError);
    expect(cooldown.get()).toBe(clock.now() + COOLDOWN_MS);
    expect(amazon.state().tripped).toBe(true);
    expect(log.lines.join("\n")).toContain("anti-bot challenge detected");

    // The next call fails without touching the browser at all.
    await expect(amazon.page("/y", OPTS)).rejects.toThrow(CaptchaError);
    expect(scripted.calls).toHaveLength(1);
  });

  test("a cooldown from an earlier process blocks a fresh client without any request", async () => {
    const clock = fakeClock();
    const cooldown = memoryCooldown(clock.now() + 10 * 60_000);
    const { client: amazon, scripted } = client([{}], cooldown);
    await expect(amazon.page("/x", OPTS)).rejects.toThrow(/verificação anti-bot/);
    expect(scripted.calls).toHaveLength(0);
    expect(amazon.cooldownUntil()).toBe(cooldown.get());
  });

  test("an expired cooldown lets requests through again", async () => {
    const clock = fakeClock();
    const cooldown = memoryCooldown(clock.now() - 1);
    const { client: amazon, scripted } = client([{}], cooldown);
    await amazon.page("/x", OPTS);
    expect(scripted.calls).toHaveLength(1);
    expect(amazon.cooldownUntil()).toBeNull();
  });
});

describe("state", () => {
  test("counts successful loads only", async () => {
    const { client: amazon } = client([{}, new AuthError("x")]);
    await amazon.page("/a", OPTS);
    expect(amazon.state().loads).toBe(1);
    await expect(amazon.page("/b", OPTS)).rejects.toThrow();
    expect(amazon.state().loads).toBe(1);
    expect(amazon.state().lastLoadAt).toBeNumber();
  });
});
