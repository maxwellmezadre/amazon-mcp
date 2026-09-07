import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { LoginError } from "../src/core/errors.js";
import { runLogin } from "../src/session/login.js";
import { deriveKey, userAgentFor } from "../src/session/browser-import.js";
import type { BrowserContextLike, LaunchBrowser, LaunchOptions } from "../src/browser/types.js";
import { READY_MARKER } from "../src/browser/transport.js";
import { cookie, memorySession, silentLogger } from "./helpers.js";
import type { Cookie } from "../src/session/jar.js";

const root = mkdtempSync(join(tmpdir(), "amz-login-"));

/** The polling loop must not actually wait in tests. */
const noSleep = async (): Promise<void> => undefined;

/**
 * A window the user works in: `urls` is what the address bar shows on each
 * poll, `readyAfter` is when the orders list finally renders decrypted.
 */
function fakeWindow(opts: {
  urls?: string[];
  readyAfter?: number;
  cookies?: Cookie[];
  /** Jar per cookies() call; the last entry repeats. */
  cookieReads?: Cookie[][];
}) {
  const state = { launches: [] as LaunchOptions[], closed: 0, polls: 0, urlReads: 0, cookieReads: 0 };
  const launch: LaunchBrowser = async (options) => {
    state.launches.push(options);
    const context: BrowserContextLike = {
      newPage: async () => ({
        goto: async () => null,
        url: () => {
          const urls = opts.urls ?? ["https://www.amazon.com.br/your-orders/orders"];
          const value = urls[Math.min(state.urlReads, urls.length - 1)] as string;
          state.urlReads += 1;
          return value;
        },
        evaluate: async (script: string) => {
          if (script.startsWith(READY_MARKER)) {
            state.polls += 1;
            return { encrypted: 0, ready: state.polls >= (opts.readyAfter ?? 1) };
          }
          return "Mozilla/5.0 (real chrome)";
        },
      }),
      cookies: async () => {
        if (opts.cookieReads) {
          const jar = opts.cookieReads[Math.min(state.cookieReads, opts.cookieReads.length - 1)];
          state.cookieReads += 1;
          return jar as Cookie[];
        }
        state.cookieReads += 1;
        return (opts.cookies ?? [
          cookie({ name: "session-id", value: "139-9338268-4563450" }),
          cookie({ name: "at-main", value: "auth-value", httpOnly: true }),
          cookie({ name: "csd-key", value: "k" }),
          // A third-party cookie that must not be persisted.
          cookie({ name: "NID", value: "x", domain: ".google.com" }),
        ]) as Cookie[];
      },
      addCookies: async () => undefined,
      close: async () => {
        state.closed += 1;
      },
    };
    return context;
  };
  return { state, launch };
}

function loginContext(dir: string) {
  const config = loadConfig({ AMAZON_CONFIG_DIR: dir });
  const session = memorySession(null);
  const ctx = createContext(config, { session, log: silentLogger() });
  return { ctx, session, config };
}

describe("runLogin", () => {
  test("waits for the decrypted orders list, then saves the jar and the real UA", async () => {
    const dir = join(root, "ok");
    const { ctx, session } = loginContext(dir);
    const window = fakeWindow({ readyAfter: 3 });

    const result = await runLogin(ctx, { timeoutMs: 60_000 }, { launch: window.launch, sleep: noSleep });

    expect(window.state.launches[0]).toMatchObject({
      headless: false,
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      profileDir: join(dir, "browser-profile"),
    });
    expect(result).toMatchObject({
      authCookies: ["at-main"],
      hasCsdKey: true,
      userAgent: "Mozilla/5.0 (real chrome)",
      httpOnlyCount: 1,
    });
    // Third-party cookies are dropped; the account ones are kept.
    expect(session.data?.cookies.map((c) => c.name)).toEqual([
      "session-id",
      "at-main",
      "csd-key",
    ]);
    expect(window.state.closed).toBe(1);
  });

  test("keeps waiting while the user is on the sign-in screen", async () => {
    const dir = join(root, "signin");
    const { ctx } = loginContext(dir);
    const window = fakeWindow({
      urls: [
        "https://www.amazon.com.br/ap/signin?openid=1",
        "https://www.amazon.com.br/ap/signin?openid=1",
        "https://www.amazon.com.br/your-orders/orders",
      ],
      readyAfter: 1,
    });
    await runLogin(ctx, { timeoutMs: 60_000 }, { launch: window.launch, sleep: noSleep });
    // The sign-in screens were not probed at all.
    expect(window.state.polls).toBe(1);
  });

  test("a rendered list without authentication cookies is not a login yet", async () => {
    const dir = join(root, "notyet");
    const { ctx, session } = loginContext(dir);
    const signedOut = [cookie({ name: "session-id", value: "139-1-1" })];
    const signedIn = [
      cookie({ name: "session-id", value: "139-1-1" }),
      cookie({ name: "at-main", value: "auth-value", httpOnly: true }),
    ];
    // Amazon serves the time filter to signed-out visitors too, so the page
    // looks "ready" long before the user has typed anything.
    const window = fakeWindow({
      readyAfter: 1,
      cookieReads: [signedOut, signedOut, signedIn],
    });

    await runLogin(ctx, { timeoutMs: 60_000 }, { launch: window.launch, sleep: noSleep });

    expect(window.state.cookieReads).toBeGreaterThan(2);
    expect(session.data?.cookies.map((c) => c.name)).toContain("at-main");
  });

  test("times out with an actionable message and still closes the browser", async () => {
    const dir = join(root, "timeout");
    const { ctx } = loginContext(dir);
    const window = fakeWindow({ readyAfter: 10_000 });
    await expect(
      runLogin(ctx, { timeoutMs: 1 }, { launch: window.launch, sleep: noSleep }),
    ).rejects.toThrow(LoginError);
    expect(window.state.closed).toBe(1);
  });

  test("never finishes while the browser holds no authentication cookies", async () => {
    const dir = join(root, "noauth");
    const { ctx, session } = loginContext(dir);
    const window = fakeWindow({ cookies: [cookie({ name: "session-id", value: "139-1-1" })] });
    // It waits for the user rather than saving a signed-out jar.
    await expect(
      runLogin(ctx, { timeoutMs: 50 }, { launch: window.launch, sleep: noSleep }),
    ).rejects.toThrow(LoginError);
    expect(session.data).toBeNull();
    expect(window.state.closed).toBe(1);
  });

  test("--fresh wipes the automation profile first", async () => {
    const dir = join(root, "fresh");
    const profile = join(dir, "browser-profile");
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "marker"), "stale");
    const { ctx } = loginContext(dir);
    await runLogin(ctx, { timeoutMs: 60_000, fresh: true }, { launch: fakeWindow({}).launch, sleep: noSleep });
    expect(existsSync(join(profile, "marker"))).toBe(false);
    expect(existsSync(profile)).toBe(true);
  });

  test("an unlaunchable browser names the fix", async () => {
    const dir = join(root, "nobrowser");
    const { ctx } = loginContext(dir);
    const launch: LaunchBrowser = async () => {
      throw new Error("Chromium distribution 'chrome' is not found");
    };
    await expect(runLogin(ctx, {}, { launch, sleep: noSleep })).rejects.toThrow(/AMAZON_BROWSER_CHANNEL/);
  });
});

describe("browser cookie import helpers", () => {
  test("derives the Chromium macOS key and a reduced UA", () => {
    expect(deriveKey("password").length).toBe(16);
    expect(userAgentFor("152.0.6367.62")).toContain("Chrome/152.0.0.0");
    expect(userAgentFor("152.0.6367.62")).toContain("Macintosh");
  });
});

// Cleanup last so a failing assertion still leaves the tree inspectable.
test("cleanup", () => {
  rmSync(root, { recursive: true, force: true });
  expect(existsSync(root)).toBe(false);
});
