import { type BrowserClient, type CooldownStore, createBrowserClient } from "./browser/client.js";
import { launchWithPlaywright } from "./browser/launch.js";
import { type PageLoader, createPageLoader } from "./browser/transport.js";
import type { LaunchBrowser } from "./browser/types.js";
import { type Config, loadConfig } from "./config.js";
import { type Logger, createLogger } from "./core/logger.js";
import { type SessionStore, createSessionStore } from "./session/store.js";

// Explicit dependency container. No framework and no module-level singletons:
// every collaborator a test wants to replace is a parameter, and everything
// expensive (browser, database) is created on first use so `auth_status` never
// starts Chrome.

export type ContextDeps = {
  launchBrowser?: LaunchBrowser;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  session?: SessionStore;
  log?: Logger;
  loader?: PageLoader;
  cooldown?: CooldownStore;
};

export type Ctx = {
  config: Config;
  log: Logger;
  now: () => number;
  session: SessionStore;
  /** Page loads, paced and guarded. Starts a browser on first use. */
  amazon: BrowserClient;
  /** Releases the browser (and later the database). Safe to call more than once. */
  dispose: () => Promise<void>;
};

export function createContext(config: Config, deps: ContextDeps = {}): Ctx {
  const now = deps.now ?? (() => Date.now());
  const session = deps.session ?? createSessionStore(config);
  // The secrets source is a FUNCTION so redaction follows cookie rotation
  // instead of freezing the jar we happened to load at startup.
  const log =
    deps.log ??
    createLogger({
      ...(config.logFile ? { logFile: config.logFile } : {}),
      secrets: () => session.peekSecrets(),
    });

  const loader =
    deps.loader ??
    createPageLoader({
      session,
      launch: deps.launchBrowser ?? launchWithPlaywright,
      config,
      log,
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      now,
    });

  const amazon = createBrowserClient(
    {
      loader,
      baseUrl: config.baseUrl,
      minIntervalMs: config.minIntervalMs,
      jitterMs: config.jitterMs,
      log,
      ...(deps.cooldown ? { cooldown: deps.cooldown } : {}),
    },
    {
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      now,
      ...(deps.random ? { random: deps.random } : {}),
    },
  );

  return {
    config,
    log,
    now,
    session,
    amazon,
    dispose: async () => {
      await amazon.close();
    },
  };
}

export const contextFromEnv = (): Ctx => createContext(loadConfig());
