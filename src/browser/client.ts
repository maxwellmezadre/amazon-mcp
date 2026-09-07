import { AuthError, CaptchaError, CsdError, HttpError, ParseError } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import type { LoadOptions, PageLoader } from "./transport.js";
import type { PageResult } from "./types.js";

// The single funnel to Amazon. It exists to enforce the anti-bot contract in
// ONE place:
//   - strictly serial: page loads never overlap, even from concurrent tool calls;
//   - a minimum gap plus random jitter between loads;
//   - exponential backoff on transient failures (navigation, timeout, a
//     decryption that did not run this time);
//   - a circuit breaker that stops the process the moment the WAF challenges
//     us, with a cooldown persisted so a retrying agent — or a brand new
//     process — cannot make the block worse.
// Every temporal collaborator (sleep, now, random) is injectable so the tests
// are deterministic without fake timers.

/** Per the spec: 2^n x 30 s, at most 10 min, at most 3 attempts, then stop. */
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 3;
/** After a WAF verdict, no request for this long — even from a new process. */
export const COOLDOWN_MS = 30 * 60_000;

export const CAPTCHA_MESSAGE =
  "A Amazon exigiu verificação anti-bot. Abra www.amazon.com.br no seu navegador, " +
  "resolva o desafio e só então rode de novo — insistir agora aprofunda o bloqueio.";

export type CooldownStore = { get(): number | null; set(until: number): void };

export type ClientState = {
  tripped: boolean;
  loads: number;
  lastLoadAt: number | null;
};

export type BrowserClient = {
  /** Loads one page through the queue. Relative paths resolve against the base url. */
  page(path: string, opts: LoadOptions): Promise<PageResult>;
  /** Renders a page to PDF, through the same queue and breaker. */
  pdf(path: string, opts?: LoadOptions): Promise<Uint8Array>;
  /** Downloads a file with the session's cookies, through the same queue. */
  download(url: string): Promise<Uint8Array>;
  /** Runs `fn` in the queue, so callers that need the browser directly still respect pacing. */
  serial<T>(fn: () => Promise<T>): Promise<T>;
  state(): ClientState;
  /** Active anti-bot cooldown (unix ms) or null. */
  cooldownUntil(): number | null;
  close(): Promise<void>;
};

export type ClientOptions = {
  loader: PageLoader;
  baseUrl: string;
  minIntervalMs: number;
  jitterMs: number;
  log: Logger;
  /** Persisted anti-bot cooldown (unix ms); survives the process. */
  cooldown?: CooldownStore;
};

export type ClientDeps = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

export const backoffMs = (attempt: number): number =>
  Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);

/**
 * Worth another try? A failed navigation, a timeout or a decryption that did
 * not run are all things that pass. An expired session, a captcha and a changed
 * layout are verdicts: retrying them wastes requests and, for the captcha,
 * actively deepens the block.
 */
export const isRetryable = (error: unknown): boolean =>
  error instanceof CsdError || error instanceof HttpError;

export function createBrowserClient(opts: ClientOptions, deps: ClientDeps = {}): BrowserClient {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const { loader, log } = opts;

  let lastLoadAt = Number.NEGATIVE_INFINITY;
  let tripped = false;
  let loads = 0;
  let chain: Promise<unknown> = Promise.resolve();

  /** Strict FIFO: the next load starts only after the previous one settled. */
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const untilLabel = (until: number): string =>
    new Date(until).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  function trip(reason: string): never {
    tripped = true;
    const until = now() + COOLDOWN_MS;
    opts.cooldown?.set(until);
    log.error(
      `anti-bot challenge detected (${reason}); Amazon client disabled for this process, cooldown until ${untilLabel(until)}`,
    );
    throw new CaptchaError(`${CAPTCHA_MESSAGE} Aguarde até ${untilLabel(until)}.`);
  }

  function assertUsable(): void {
    if (tripped) throw new CaptchaError(CAPTCHA_MESSAGE);
    const until = opts.cooldown?.get() ?? null;
    if (until !== null && until > now()) {
      throw new CaptchaError(`${CAPTCHA_MESSAGE} Aguarde até ${untilLabel(until)}.`);
    }
  }

  async function gap(): Promise<void> {
    const wait = lastLoadAt + opts.minIntervalMs + random() * opts.jitterMs - now();
    if (wait > 0) await sleep(wait);
    lastLoadAt = now();
  }

  async function load(path: string, options: LoadOptions): Promise<PageResult> {
    const url = new URL(path, opts.baseUrl).toString();
    for (let attempt = 1; ; attempt += 1) {
      await gap();
      try {
        const result = await loader.load(url, options);
        loads += 1;
        return result;
      } catch (error) {
        if (error instanceof CaptchaError) trip("raised by the transport");
        if (error instanceof AuthError || error instanceof ParseError) throw error;
        if (isRetryable(error) && attempt < MAX_ATTEMPTS) {
          const wait = backoffMs(attempt);
          log.warn(
            `${(error as Error).name} on ${url} (attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${Math.round(wait / 1000)}s`,
          );
          await sleep(wait);
          continue;
        }
        throw error;
      }
    }
  }

  return {
    serial,
    page: (path, options) =>
      serial(async () => {
        assertUsable();
        return load(path, options);
      }),
    pdf: (path, options) =>
      serial(async () => {
        assertUsable();
        await gap();
        return loader.pdf(new URL(path, opts.baseUrl).toString(), options ?? { readySelector: "body" });
      }),
    download: (url) =>
      serial(async () => {
        assertUsable();
        await gap();
        return loader.download(url);
      }),
    state: () => ({
      tripped,
      loads,
      lastLoadAt: Number.isFinite(lastLoadAt) ? lastLoadAt : null,
    }),
    cooldownUntil: () => {
      const until = opts.cooldown?.get() ?? null;
      return until !== null && until > now() ? until : null;
    },
    close: () => loader.close(),
  };
}
