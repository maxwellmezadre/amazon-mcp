import type { Config } from "../config.js";
import { AuthError, CaptchaError, CsdError, HttpError, ParseError } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import { cookieSignature, hostMatches } from "../session/jar.js";
import type { SessionData, SessionStore } from "../session/store.js";
import type { BrowserContextLike, LaunchBrowser, PageLike, PageResult, RouteLike } from "./types.js";

// Why a browser at all: Amazon BR ships the order history encrypted. Every card
// arrives as `<div class="csd-encrypted-sensitive">` plus a script payload, and
// only the page's own JavaScript (keyed by the `csd-key` cookie) turns it into
// DOM. A plain fetch with perfect cookies gets the containers and nothing
// inside them, so a real browser executing the page is a requirement, not an
// optimisation.
//
// What this module owns: one Chrome context per process, one page, navigation,
// the wait for decryption, and handing back inert HTML. Pacing, retries and the
// anti-bot breaker live in client.ts; parsing lives in amazon/*.

export const READY_MARKER = "/*amazon-mcp ready ";
export const EXTRACT_MARKER = "/*amazon-mcp extract */";

const READY_POLL_MS = 500;
const DEFAULT_IDLE_MS = 5 * 60_000;
/** Aborted on every navigation: they cost seconds and carry no data. Scripts are NEVER blocked. */
const BLOCKED_RESOURCES = new Set(["image", "font", "media"]);

/** What the readiness probe reports back from inside the page. */
export type ReadyState = { encrypted: number; ready: boolean };

export type LoadOptions = {
  /** CSS selector that proves the page finished rendering. */
  readySelector: string;
  /**
   * Overrides the selector check with a full expression returning
   * {@link ReadyState}. Needed when "rendered" is not a single element: the
   * orders list must distinguish "cards arrived" from "this filter really is
   * empty", and its static shell (the period filter) is present either way —
   * accepting that as proof extracts the page before the orders exist.
   */
  readyExpression?: string;
};

export type PageLoader = {
  load(url: string, opts: LoadOptions): Promise<PageResult>;
  /** True once a browser is up; `doctor` and `auth_status` report it without launching one. */
  running(): boolean;
  close(): Promise<void>;
};

export type PageLoaderOptions = {
  session: SessionStore;
  launch: LaunchBrowser;
  config: Pick<
    Config,
    | "baseUrl"
    | "browserChannel"
    | "browserProfileDir"
    | "csdTimeoutMs"
    | "headless"
    | "locale"
    | "pageTimeoutMs"
    | "timezone"
  >;
  log: Logger;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Close the browser after this long without a page load; 0 disables. */
  idleMs?: number;
};

/**
 * Readiness probe. Reports the two facts that tell apart the three outcomes:
 * decrypted (ready), still encrypted (CSD failed), and rendered-but-different
 * (the layout changed).
 */
export function readyScript(selector: string): string {
  const request = JSON.stringify({ selector });
  return `${READY_MARKER}${request} */
(() => {
  const request = ${request};
  return {
    encrypted: document.querySelectorAll(".csd-encrypted-sensitive").length,
    ready: document.querySelector(request.selector) !== null,
  };
})()`;
}

/**
 * Snapshot of the decrypted document with everything executable or decorative
 * removed. The parsers get inert HTML, which is also exactly what gets stored
 * as a fixture and as `raw_html` for offline reparsing.
 */
export const extractScript = `${EXTRACT_MARKER}
(() => {
  const clone = document.documentElement.cloneNode(true);
  for (const node of clone.querySelectorAll("script,style,svg,noscript,link,iframe,meta")) {
    node.remove();
  }
  return { url: location.href, title: document.title, html: clone.outerHTML };
})()`;

export function createPageLoader(opts: PageLoaderOptions): PageLoader {
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? (() => Date.now());
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  const { config, log } = opts;
  const host = new URL(config.baseUrl).hostname;

  let context: BrowserContextLike | null = null;
  let page: PageLike | null = null;
  let jar: SessionData | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  async function close(): Promise<void> {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const current = context;
    context = null;
    page = null;
    if (current) await current.close().catch(() => undefined);
  }

  function touch(): void {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleMs <= 0) return;
    idleTimer = setTimeout(() => void close(), idleMs);
    // Never let the idle timer keep a CLI process alive.
    (idleTimer as { unref?: () => void }).unref?.();
  }

  async function ensurePage(): Promise<PageLike> {
    if (page) return page;
    jar = opts.session.load();
    if (!jar) throw new AuthError("Nenhuma sessão da Amazon salva.");
    log.info(
      `starting ${config.headless ? "headless" : "windowed"} browser for Amazon page loads`,
    );
    context = await opts.launch({
      channel: config.browserChannel,
      profileDir: config.browserProfileDir,
      headless: config.headless,
      userAgent: jar.userAgent,
      locale: config.locale,
      timezoneId: config.timezone,
    });
    try {
      await context.addCookies(jar.cookies);
      // Blocking images/fonts/media roughly halves the load time. Blocking
      // scripts would break decryption and leave every card empty.
      await context.route?.("**/*", (route: RouteLike) =>
        BLOCKED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue(),
      );
      const fresh = await context.newPage();
      page = fresh;
      return fresh;
    } catch (error) {
      await close();
      throw error;
    }
  }

  /** Chrome renews cookies itself; mirror them into the encrypted jar when they change. */
  async function persistCookies(): Promise<void> {
    if (!context || !jar) return;
    const cookies = (await context.cookies()).filter((cookie) => hostMatches(host, cookie.domain));
    if (cookies.length === 0 || cookieSignature(cookies) === cookieSignature(jar.cookies)) return;
    jar = { ...jar, cookies, savedAt: now() };
    try {
      opts.session.save(jar);
    } catch (error) {
      log.warn(
        `could not persist renewed cookies: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Where Amazon sends us instead of the page we asked for. */
  function classifyLanding(landed: string): void {
    if (landed.includes("/ap/signin")) {
      throw new AuthError("A Amazon não aceitou a sessão salva e pediu login.");
    }
    if (landed.includes("validateCaptcha") || landed.includes("/errors/")) {
      throw new CaptchaError(
        "A Amazon exigiu verificação anti-bot (captcha do WAF) ao abrir a página.",
      );
    }
  }

  async function waitForDecryption(
    current: PageLike,
    url: string,
    selector: string,
    expression?: string,
  ): Promise<void> {
    const script = expression ? `${READY_MARKER}{} */\n${expression}` : readyScript(selector);
    const deadline = now() + config.csdTimeoutMs;
    let encrypted = 0;
    for (;;) {
      const state = (await current.evaluate(script)) as ReadyState;
      if (state?.ready) return;
      encrypted = state?.encrypted ?? 0;
      if (now() >= deadline) break;
      await sleep(READY_POLL_MS);
    }
    if (encrypted > 0) {
      throw new CsdError(
        `A Amazon entregou ${encrypted} bloco(s) ainda cifrado(s) em ${url}: a descriptografia da página não rodou. ` +
          "Verifique se o cookie csd-key está na sessão e rode `amazon login` se necessário.",
      );
    }
    throw new ParseError(`A página ${url} carregou mas não trouxe "${selector}".`);
  }

  return {
    running: () => context !== null,
    close,

    async load(url, options) {
      const current = await ensurePage();
      try {
        await current.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: config.pageTimeoutMs,
        });
      } catch (error) {
        throw new HttpError(0, `Falha ao abrir ${url}: ${(error as Error).message}`);
      }
      classifyLanding(current.url());
      // Never wait for networkidle: Amazon's telemetry beacons keep firing and
      // it may never settle. Wait for the decrypted content instead.
      await waitForDecryption(current, url, options.readySelector, options.readyExpression);
      const result = (await current.evaluate(extractScript)) as PageResult;
      await persistCookies();
      touch();
      return result;
    },
  };
}
