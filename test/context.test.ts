import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { migrate } from "../src/cache/db.js";
import { loadConfig } from "../src/config.js";
import { COOLDOWN_META, createContext } from "../src/context.js";
import { CaptchaError } from "../src/core/errors.js";
import { fakeChrome, memorySession, sessionData, silentLogger } from "./helpers.js";

const config = loadConfig({ AMAZON_CONFIG_DIR: "/tmp/amz-context" });

function context(db: Database) {
  return createContext(config, {
    db,
    session: memorySession(sessionData()),
    log: silentLogger(),
    launchBrowser: fakeChrome().launch,
    sleep: async () => undefined,
  });
}

function memoryDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

describe("createContext", () => {
  test("does not open the cache until something asks for it", () => {
    const ctx = createContext(config, {
      session: memorySession(sessionData()),
      log: silentLogger(),
      launchBrowser: fakeChrome().launch,
    });
    // A config dir under /tmp that was never created proves nothing was written.
    expect(ctx.config.dbPath).toBe("/tmp/amz-context/cache.db");
    expect(ctx.amazon.state().loads).toBe(0);
  });

  test("memoises the cache repo", () => {
    const ctx = context(memoryDb());
    expect(ctx.cache()).toBe(ctx.cache());
  });

  test("persists the anti-bot cooldown in the cache so a new process still waits", async () => {
    const db = memoryDb();
    const first = context(db);
    // A captcha on the first page load trips the breaker.
    const chrome = fakeChrome([{ url: "https://www.amazon.com.br/errors/validateCaptcha" }]);
    const tripping = createContext(config, {
      db,
      session: memorySession(sessionData()),
      log: silentLogger(),
      launchBrowser: chrome.launch,
      sleep: async () => undefined,
    });
    await expect(
      tripping.amazon.page("/your-orders/orders", { readySelector: "#time-filter" }),
    ).rejects.toThrow(CaptchaError);

    const stored = first.cache().getMeta(COOLDOWN_META);
    expect(Number(stored)).toBeGreaterThan(Date.now());

    // A brand-new context over the same database refuses before any request.
    const second = context(db);
    await expect(
      second.amazon.page("/your-orders/orders", { readySelector: "#time-filter" }),
    ).rejects.toThrow(/verificação anti-bot/);
    expect(second.amazon.cooldownUntil()).toBe(Number(stored));
  });

  test("dispose closes the browser but not a database it was handed", async () => {
    const db = memoryDb();
    const ctx = context(db);
    ctx.cache();
    await ctx.dispose();
    // Still usable: the caller owns an injected database.
    expect(() => db.query("SELECT 1").get()).not.toThrow();
  });
});
