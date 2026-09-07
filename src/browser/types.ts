import type { BrowserChannel } from "../config.js";
import type { Cookie } from "../session/jar.js";

// The smallest slice of Playwright this project uses. Declaring it here instead
// of importing Playwright's types buys two things: the MCP cold path never
// loads the driver, and the tests fake a browser with a plain object literal.

export type GotoOptions = {
  waitUntil?: "domcontentloaded" | "load" | "networkidle";
  timeout?: number;
};

export type PageLike = {
  goto(url: string, opts?: GotoOptions): Promise<unknown>;
  url(): string;
  /**
   * Takes a script SOURCE STRING, not a function. Playwright accepts both, and
   * a string is what lets the fake browser in the tests recognise which script
   * it was handed by its leading marker comment.
   */
  evaluate(script: string): Promise<unknown>;
  /** Chromium headless only; used to save an order summary as PDF. */
  pdf?(opts: { format?: string; printBackground?: boolean }): Promise<Uint8Array>;
};

export type BrowserContextLike = {
  newPage(): Promise<PageLike>;
  cookies(): Promise<Cookie[]>;
  addCookies(cookies: Cookie[]): Promise<void>;
  /** Resource blocking: images, fonts and media are aborted; scripts never are. */
  route?(pattern: string, handler: (route: RouteLike) => unknown): Promise<void>;
  /**
   * Shares the context's cookies, which is what lets a signed invoice URL be
   * fetched as the logged-in user without rebuilding a Cookie header by hand.
   */
  request?: { get(url: string): Promise<{ ok(): boolean; status(): number; body(): Promise<Uint8Array> }> };
  close(): Promise<void>;
};

export type RouteLike = {
  request(): { resourceType(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
};

export type LaunchOptions = {
  channel: BrowserChannel;
  profileDir: string;
  headless: boolean;
  /** The UA captured at login; never let headless Chrome announce itself. */
  userAgent?: string;
  locale: string;
  timezoneId: string;
};

export type LaunchBrowser = (opts: LaunchOptions) => Promise<BrowserContextLike>;

/** One decrypted page, as handed to the parsers. */
export type PageResult = {
  /** Final URL after redirects. */
  url: string;
  title: string;
  /** Post-CSD HTML with scripts and styling stripped. */
  html: string;
};
