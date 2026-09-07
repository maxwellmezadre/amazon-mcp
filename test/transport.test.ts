import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";
import { AuthError, CaptchaError, CsdError, HttpError, ParseError } from "../src/core/errors.js";
import {
  EXTRACT_MARKER,
  READY_MARKER,
  createPageLoader,
  extractScript,
  readyScript,
} from "../src/browser/transport.js";
import { fakeChrome, fakeClock, memorySession, sessionData, silentLogger } from "./helpers.js";

const config = loadConfig({ AMAZON_CONFIG_DIR: "/tmp/amz-transport" });
const ORDERS = "https://www.amazon.com.br/your-orders/orders?timeFilter=year-2025";
const READY_SELECTOR = ".yohtmlc-order-id, #time-filter";

function loader(chrome: ReturnType<typeof fakeChrome>, session = memorySession(sessionData())) {
  const clock = fakeClock();
  const log = silentLogger();
  return {
    clock,
    log,
    session,
    loader: createPageLoader({
      session,
      launch: chrome.launch,
      config,
      log,
      sleep: clock.sleep,
      now: clock.now,
      idleMs: 0,
    }),
  };
}

describe("createPageLoader", () => {
  test("launches once with the session's fingerprint and injects the jar", async () => {
    const chrome = fakeChrome([{ ready: [{ encrypted: 0, ready: true }] }]);
    const { loader: pages } = loader(chrome);
    await pages.load(ORDERS, { readySelector: READY_SELECTOR });

    expect(chrome.state.launches).toEqual([
      {
        channel: "chrome",
        profileDir: "/tmp/amz-transport/browser-profile",
        headless: true,
        userAgent: "Mozilla/5.0 (test)",
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
      },
    ]);
    expect(chrome.state.injected[0]?.map((c) => c.name)).toEqual([
      "session-id",
      "at-main",
      "csd-key",
    ]);
    expect(chrome.state.visited).toEqual([ORDERS]);
    expect(pages.running()).toBe(true);
  });

  test("reuses the context and page across loads", async () => {
    const chrome = fakeChrome([{}, {}]);
    const { loader: pages } = loader(chrome);
    await pages.load(ORDERS, { readySelector: READY_SELECTOR });
    await pages.load(`${ORDERS}&page=2`, { readySelector: READY_SELECTOR });
    expect(chrome.state.launches).toHaveLength(1);
    expect(chrome.state.visited).toHaveLength(2);
  });

  test("blocks images, fonts and media but never scripts (the decryption needs them)", async () => {
    const chrome = fakeChrome([{}]);
    const { loader: pages } = loader(chrome);
    await pages.load(ORDERS, { readySelector: READY_SELECTOR });
    expect(chrome.state.blocked.sort()).toEqual(["font", "image", "media"]);
    expect(chrome.state.allowed).toContain("script");
    expect(chrome.state.allowed).toContain("document");
  });

  test("waits for the decryption, polling until the content shows up", async () => {
    const chrome = fakeChrome([
      {
        ready: [
          { encrypted: 10, ready: false },
          { encrypted: 10, ready: false },
          { encrypted: 0, ready: true },
        ],
      },
    ]);
    const { loader: pages, clock } = loader(chrome);
    await pages.load(ORDERS, { readySelector: READY_SELECTOR });
    expect(chrome.state.readyPolls).toBe(3);
    expect(clock.slept).toEqual([500, 500]);
  });

  test("returns the extracted post-decryption html", async () => {
    const chrome = fakeChrome([{ html: "<html><body>decifrado</body></html>", title: "Pedidos" }]);
    const { loader: pages } = loader(chrome);
    const result = await pages.load(ORDERS, { readySelector: READY_SELECTOR });
    expect(result.html).toContain("decifrado");
    expect(result.title).toBe("Pedidos");
    expect(result.url).toBe(ORDERS);
  });

  test("a signin redirect is an auth failure, not a parse failure", async () => {
    const chrome = fakeChrome([{ url: "https://www.amazon.com.br/ap/signin?openid=..." }]);
    const { loader: pages } = loader(chrome);
    expect(pages.load(ORDERS, { readySelector: READY_SELECTOR })).rejects.toThrow(AuthError);
  });

  test("a captcha redirect is its own verdict", async () => {
    const chrome = fakeChrome([{ url: "https://www.amazon.com.br/errors/validateCaptcha?x=1" }]);
    const { loader: pages } = loader(chrome);
    expect(pages.load(ORDERS, { readySelector: READY_SELECTOR })).rejects.toThrow(CaptchaError);
  });

  test("still-encrypted cards are a CsdError, never zero orders", async () => {
    const chrome = fakeChrome([{ ready: [{ encrypted: 10, ready: false }] }]);
    const { loader: pages, clock } = loader(chrome);
    let caught: unknown;
    try {
      await pages.load(ORDERS, { readySelector: READY_SELECTOR });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CsdError);
    expect((caught as Error).message).toContain("csd-key");
    // It polled for the whole csd budget before giving up.
    expect(clock.slept.length).toBeGreaterThan(30);
  });

  test("decrypted but without the selector is a layout change, not a csd failure", async () => {
    const chrome = fakeChrome([{ ready: [{ encrypted: 0, ready: false }] }]);
    const { loader: pages } = loader(chrome);
    expect(pages.load(ORDERS, { readySelector: READY_SELECTOR })).rejects.toThrow(ParseError);
  });

  test("a failed navigation becomes an HttpError", async () => {
    const chrome = fakeChrome([{ fail: new Error("net::ERR_TIMED_OUT") }]);
    const { loader: pages } = loader(chrome);
    expect(pages.load(ORDERS, { readySelector: READY_SELECTOR })).rejects.toThrow(HttpError);
  });

  test("no session is an actionable auth error and launches nothing", async () => {
    const chrome = fakeChrome([{}]);
    const { loader: pages } = loader(chrome, memorySession(null));
    expect(pages.load(ORDERS, { readySelector: READY_SELECTOR })).rejects.toThrow(
      /Nenhuma sessão da Amazon salva/,
    );
    expect(chrome.state.launches).toHaveLength(0);
  });

  test("persists rotated cookies, and only when they actually changed", async () => {
    const chrome = fakeChrome([{}, {}]);
    const session = memorySession(sessionData());
    const { loader: pages } = loader(chrome, session);
    await pages.load(ORDERS, { readySelector: READY_SELECTOR });
    const unchanged = session.mtimeMs();

    chrome.state.cookies = [...chrome.state.cookies, { ...chrome.state.cookies[0]!, value: "new" }];
    await pages.load(ORDERS, { readySelector: READY_SELECTOR });
    expect(session.mtimeMs()).toBeGreaterThan(unchanged as number);
  });

  test("close shuts the browser and the next load relaunches", async () => {
    const chrome = fakeChrome([{}, {}]);
    const { loader: pages } = loader(chrome);
    await pages.load(ORDERS, { readySelector: READY_SELECTOR });
    await pages.close();
    expect(chrome.state.closed).toBe(1);
    expect(pages.running()).toBe(false);
    await pages.load(ORDERS, { readySelector: READY_SELECTOR });
    expect(chrome.state.launches).toHaveLength(2);
  });
});

describe("in-page scripts", () => {
  test("the readiness probe runs and reports both facts", () => {
    const script = readyScript(".yohtmlc-order-id, #time-filter");
    expect(script.startsWith(READY_MARKER)).toBe(true);
    const seen: string[] = [];
    const document = {
      querySelectorAll: (selector: string) => {
        seen.push(selector);
        return { length: 10 };
      },
      querySelector: (selector: string) => {
        seen.push(selector);
        return null;
      },
    };
    const result = new Function("document", `return (${script})`)(document) as {
      encrypted: number;
      ready: boolean;
    };
    expect(result).toEqual({ encrypted: 10, ready: false });
    expect(seen).toEqual([".csd-encrypted-sensitive", ".yohtmlc-order-id, #time-filter"]);
  });

  test("the extract script strips everything executable", () => {
    expect(extractScript.startsWith(EXTRACT_MARKER)).toBe(true);
    const removed: string[] = [];
    const clone = {
      querySelectorAll: (selector: string) => {
        removed.push(selector);
        return [{ remove: () => undefined }];
      },
      outerHTML: "<html>clean</html>",
    };
    const document = {
      documentElement: { cloneNode: () => clone },
      title: "Seus pedidos",
    };
    const result = new Function(
      "document",
      "location",
      `return (${extractScript})`,
    )(document, { href: "https://www.amazon.com.br/your-orders/orders" }) as {
      html: string;
      title: string;
      url: string;
    };
    expect(removed).toEqual(["script,style,svg,noscript,link,iframe,meta"]);
    expect(result.html).toBe("<html>clean</html>");
    expect(result.url).toBe("https://www.amazon.com.br/your-orders/orders");
  });
});
