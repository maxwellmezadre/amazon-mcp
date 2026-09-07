import { mkdirSync, rmSync } from "node:fs";
import { ORDERS_READY_EXPRESSION, YEAR_FILTER, ordersPath } from "../amazon/urls.js";
import { launchWithPlaywright } from "../browser/launch.js";
import { READY_MARKER, type ReadyState } from "../browser/transport.js";
import type { BrowserContextLike, LaunchBrowser, PageLike } from "../browser/types.js";
import type { Ctx } from "../context.js";
import { LoginError } from "../core/errors.js";
import {
  authCookieNames,
  hasCsdKey,
  identityCookieNames,
  inSiteDomain,
  registrableDomain,
} from "./jar.js";

// Interactive login. A real window opens and the USER types the password, the
// OTP and solves any captcha. Nothing about that is automated: besides being
// the fastest way to get an account flagged, Amazon runs dedicated bot
// detection on the sign-in screen.
//
// Success is not detected by URL and not by a cookie either. It is detected by
// the thing the tool actually needs: the orders list rendered and decrypted.
// That survives the 2FA interstitials and post-login redirects, and it proves
// in one shot that the session works AND that the decryption key is in place.

export const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 2_000;
const REPORT_EVERY_MS = 30_000;

export type LoginOptions = {
  timeoutMs?: number;
  /** Wipe the automation profile first, so Amazon sees a brand-new device. */
  fresh?: boolean;
  report?: (message: string) => void;
};

export type LoginDeps = { launch?: LaunchBrowser; sleep?: (ms: number) => Promise<void> };

export type LoginResult = {
  cookieCount: number;
  httpOnlyCount: number;
  authCookies: string[];
  hasCsdKey: boolean;
  userAgent: string;
  savedAt: string;
};

export async function runLogin(
  ctx: Ctx,
  opts: LoginOptions = {},
  deps: LoginDeps = {},
): Promise<LoginResult> {
  const report = opts.report ?? ((message: string) => ctx.log.info(message));
  const { config } = ctx;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;

  if (opts.fresh) rmSync(config.browserProfileDir, { recursive: true, force: true });
  mkdirSync(config.browserProfileDir, { recursive: true, mode: 0o700 });

  let context: BrowserContextLike;
  try {
    context = await (deps.launch ?? launchWithPlaywright)({
      channel: config.browserChannel,
      profileDir: config.browserProfileDir,
      // Always a real window: this is where the human works.
      headless: false,
      locale: config.locale,
      timezoneId: config.timezone,
    });
  } catch (error) {
    throw new LoginError(
      `Não consegui abrir o navegador (${config.browserChannel}): ${(error as Error).message}\n` +
        "Instale o Google Chrome, ou rode `bunx playwright install chromium` e use AMAZON_BROWSER_CHANNEL=chromium.",
    );
  }

  try {
    const page = await context.newPage();
    const url = `${config.baseUrl}${ordersPath(YEAR_FILTER(new Date(ctx.now()).getFullYear()))}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.pageTimeoutMs });
    report(
      "Faça login na janela do navegador (senha, verificação em duas etapas, captcha). " +
        "Estou esperando a lista de pedidos aparecer.",
    );

    await waitForOrders(ctx, context, page, timeoutMs, report, deps.sleep ?? sleep);

    const site = registrableDomain(new URL(config.baseUrl).hostname);
    const cookies = (await context.cookies()).filter((cookie) =>
      inSiteDomain(cookie.domain, site),
    );
    // context.cookies() is browser-level, so the HttpOnly authentication
    // cookies come along — a document.cookie dump never sees them.
    // The wait loop already proved the browser holds authentication cookies;
    // this catches the narrower case where they exist under a domain the site
    // filter drops, which would persist a jar that cannot authenticate.
    const auth = authCookieNames(cookies);
    if (auth.length === 0) {
      throw new LoginError(
        `A sessão tem cookies de autenticação, mas nenhum sob ${site}. Verifique AMAZON_BASE_URL e tente de novo.`,
      );
    }
    const userAgent = String(await page.evaluate("navigator.userAgent"));
    const savedAt = ctx.now();
    ctx.session.save({ version: 1, cookies, userAgent, savedAt });
    report(`Sessão salva (${cookies.length} cookies, autenticação por ${auth.join(", ")}).`);

    return {
      cookieCount: cookies.length,
      httpOnlyCount: cookies.filter((cookie) => cookie.httpOnly).length,
      authCookies: auth,
      hasCsdKey: hasCsdKey(cookies),
      userAgent,
      savedAt: new Date(savedAt).toISOString(),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Polls until the orders page is reachable, decrypted AND backed by real
 * authentication cookies.
 *
 * The cookie check is not belt-and-braces: signed out, Amazon still serves a
 * page carrying the time filter, so "the list rendered" alone reports success
 * before the user has typed anything. Both conditions together are what
 * actually means "logged in".
 */
async function waitForOrders(
  ctx: Ctx,
  context: BrowserContextLike,
  page: PageLike,
  timeoutMs: number,
  report: (message: string) => void,
  wait: (ms: number) => Promise<void>,
): Promise<void> {
  // Same rule as the transport: the static shell is not proof of a login.
  const script = `${READY_MARKER}{} */\n${ORDERS_READY_EXPRESSION}`;
  const deadline = ctx.now() + timeoutMs;
  let lastReport = ctx.now();
  let warned = false;

  for (;;) {
    const url = page.url();
    // While the user is on the sign-in or verification screens there is nothing
    // to probe; just keep waiting for them.
    if (!url.includes("/ap/signin") && !url.includes("/errors/")) {
      const state = (await page.evaluate(script).catch(() => null)) as ReadyState | null;
      if (state?.ready) {
        const cookies = await context.cookies();
        if (authCookieNames(cookies).length > 0) return;
        // The page is rendered but no access-token cookie is in the jar. Say so
        // once, with the cookie NAMES only, so a marketplace naming this tool
        // does not know is a one-line report instead of a silent hang.
        if (!warned) {
          warned = true;
          const identity = identityCookieNames(cookies);
          report(
            `A lista renderizou, mas nenhum cookie de autenticação foi encontrado. ` +
              `Cookies de identidade presentes: ${identity.join(", ") || "nenhum"}. ` +
              `Nomes no jar: ${cookies.map((cookie) => cookie.name).sort().join(", ") || "nenhum"}.`,
          );
        }
      }
    }
    if (ctx.now() >= deadline) {
      throw new LoginError(
        `Login não concluído em ${Math.round(timeoutMs / 1000)}s. Rode \`amazon login\` de novo.`,
      );
    }
    if (ctx.now() - lastReport >= REPORT_EVERY_MS) {
      lastReport = ctx.now();
      report("Ainda esperando a lista de pedidos…");
    }
    await wait(POLL_MS);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
