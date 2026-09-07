import { readFileSync } from "node:fs";
import type { LaunchBrowser, LaunchOptions, PageResult, RouteLike } from "../src/browser/types.js";
import { EXTRACT_MARKER, READY_MARKER, type ReadyState } from "../src/browser/transport.js";
import type { Logger } from "../src/core/logger.js";
import type { Cookie } from "../src/session/jar.js";
import { type SessionData, createMemorySessionStore } from "../src/session/store.js";

/**
 * Fake clock: `sleep` records the duration and advances time instead of
 * waiting, so pacing and backoff are asserted in microseconds.
 */
export function fakeClock(start = 1_757_000_000_000) {
  let current = start;
  const slept: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      slept.push(ms);
      current += ms;
    },
    advance: (ms: number) => {
      current += ms;
    },
    slept,
  };
}

export function silentLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (message: string) => {
    lines.push(`[${level}] ${message}`);
  };
  return {
    lines,
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
  };
}

export const cookie = (partial: Partial<Cookie> & Pick<Cookie, "name" | "value">): Cookie => ({
  domain: ".amazon.com.br",
  path: "/",
  expires: -1,
  httpOnly: false,
  secure: true,
  ...partial,
});

export function sessionData(overrides: Partial<SessionData> = {}): SessionData {
  return {
    version: 1,
    cookies: [
      cookie({ name: "session-id", value: "139-9338268-4563450" }),
      cookie({ name: "at-main", value: "auth-secret-value", httpOnly: true }),
      cookie({ name: "csd-key", value: "decrypt-me" }),
    ],
    userAgent: "Mozilla/5.0 (test)",
    savedAt: 1_757_000_000_000,
    ...overrides,
  };
}

export const memorySession = createMemorySessionStore;

export const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** One scripted answer to a navigation. */
export type FakePage = {
  /** Where the browser ends up; a signin/captcha URL is how a redirect is simulated. */
  url?: string;
  /** Readiness answers, consumed one per poll. The last one repeats. */
  ready?: ReadyState[];
  /** Body handed back by the extract script. */
  html?: string;
  title?: string;
  /** When set, `goto` rejects with it. */
  fail?: Error;
};

export type FakeChromeState = {
  launches: LaunchOptions[];
  injected: Cookie[][];
  visited: string[];
  routed: string[];
  blocked: string[];
  allowed: string[];
  readyPolls: number;
  closed: number;
  cookies: Cookie[];
};

/**
 * A browser made of object literals. `evaluate` dispatches on the marker each
 * script carries, which is exactly why the transport builds its scripts with
 * one — no real Chrome, no fixtures of Chrome's behaviour.
 */
export function fakeChrome(pages: FakePage[] = []) {
  const queue = [...pages];
  const state: FakeChromeState = {
    launches: [],
    injected: [],
    visited: [],
    routed: [],
    blocked: [],
    allowed: [],
    readyPolls: 0,
    closed: 0,
    cookies: sessionData().cookies,
  };

  let current: FakePage = { ready: [{ encrypted: 0, ready: true }] };
  let currentUrl = "about:blank";

  const launch: LaunchBrowser = async (opts) => {
    state.launches.push(opts);
    return {
      newPage: async () => ({
        goto: async (url: string) => {
          current = queue.shift() ?? { ready: [{ encrypted: 0, ready: true }] };
          state.visited.push(url);
          if (current.fail) throw current.fail;
          currentUrl = current.url ?? url;
          return null;
        },
        url: () => currentUrl,
        evaluate: async (script: string) => {
          if (script.startsWith(READY_MARKER)) {
            state.readyPolls += 1;
            const answers = current.ready ?? [{ encrypted: 0, ready: true }];
            const index = Math.min(state.readyPolls - 1, answers.length - 1);
            return answers[index];
          }
          if (script.startsWith(EXTRACT_MARKER)) {
            return {
              url: currentUrl,
              title: current.title ?? "Seus pedidos",
              html: current.html ?? "<html><body>ok</body></html>",
            } satisfies PageResult;
          }
          throw new Error(`fake page: unexpected script ${script.slice(0, 40)}`);
        },
      }),
      cookies: async () => state.cookies,
      addCookies: async (cookies: Cookie[]) => {
        state.injected.push(cookies);
      },
      route: async (pattern: string, handler: (route: RouteLike) => unknown) => {
        state.routed.push(pattern);
        // Exercise the handler with one resource of each kind so the test can
        // assert what the transport blocks.
        for (const resourceType of ["image", "font", "media", "script", "document", "xhr"]) {
          await handler({
            request: () => ({ resourceType: () => resourceType }),
            abort: async () => {
              state.blocked.push(resourceType);
            },
            continue: async () => {
              state.allowed.push(resourceType);
            },
          });
        }
      },
      close: async () => {
        state.closed += 1;
      },
    };
  };

  /** Queue more navigations after construction. */
  const enqueue = (...more: FakePage[]) => queue.push(...more);

  return { state, launch, enqueue };
}

/** Cooldown store backed by a plain variable. */
export function memoryCooldown(initial: number | null = null) {
  let until = initial;
  return {
    get: () => until,
    set: (value: number) => {
      until = value;
    },
  };
}
