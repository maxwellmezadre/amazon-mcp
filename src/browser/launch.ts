import type { LaunchBrowser, LaunchOptions } from "./types.js";

// Playwright lives behind a dynamic import so that starting the MCP server, or
// answering from the cache, never pays for loading the driver.

export type PlaywrightLaunchOptions = {
  channel: string;
  headless: boolean;
  userAgent?: string;
  locale: string;
  timezoneId: string;
  viewport: { width: number; height: number };
  args: string[];
  ignoreDefaultArgs: string[];
};

/**
 * Pure so it can be asserted in tests. Three things matter here:
 *
 *  - the UA, locale, timezone and viewport must be the SAME at login and on
 *    every later read. Amazon renders dates and currency from the locale, and a
 *    fingerprint that shifts between runs on one session is a bot signal;
 *  - `--disable-blink-features=AutomationControlled` zeroes `navigator.webdriver`,
 *    which headless Chrome sets even without `--enable-automation`;
 *  - the viewport is fixed rather than `null`: headless has no window to
 *    inherit a size from, and a 0-height viewport changes what Amazon renders.
 */
export function launchOptions(opts: LaunchOptions): PlaywrightLaunchOptions {
  return {
    channel: opts.channel,
    headless: opts.headless,
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    locale: opts.locale,
    timezoneId: opts.timezoneId,
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  };
}

export const launchWithPlaywright: LaunchBrowser = async (opts) => {
  const { chromium } = await import("playwright-core");
  return (await chromium.launchPersistentContext(
    opts.profileDir,
    launchOptions(opts) as never,
  )) as never;
};
