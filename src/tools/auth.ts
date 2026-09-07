import { Type } from "@sinclair/typebox";
import {
  ORDERS_READY,
  ORDERS_READY_EXPRESSION,
  YEAR_FILTER,
  ordersPath,
} from "../amazon/urls.js";
import { AuthError, CaptchaError, CsdError } from "../core/errors.js";
import {
  authCookieNames,
  hasAuthCookies,
  hasCsdKey,
  soonestExpiry,
} from "../session/jar.js";
import { compactObject, defineTool } from "./define.js";

// Session diagnostics. Free by default: it reads the local session file and
// says nothing that could not be derived from it. `verify: true` spends exactly
// one page load.

export type AuthStatus = {
  loggedIn: boolean;
  verified?: boolean;
  error?: string;
  sessionFile: string;
  cookieCount: number;
  httpOnlyCount: number;
  /** Which of the HttpOnly authentication cookies are present. */
  authCookies: string[];
  /** Without this the cards stay encrypted even on a perfectly valid session. */
  hasCsdKey: boolean;
  userAgent: string | null;
  savedAt: string | null;
  ageDays: number | null;
  soonestExpiry: string | null;
  breaker: "ok" | "tripped";
  cooldownUntil: string | null;
  browserRunning: boolean;
  hint?: string;
};

export const authStatus = defineTool({
  name: "auth_status",
  description:
    "Diz se há uma sessão da Amazon salva e o que ela cobre (cookies de autenticação, chave de " +
    "descriptografia dos pedidos, validade, navegador de origem). Não usa a rede por padrão. Com " +
    "verify=true gasta 1 carregamento de página para confirmar que a Amazon ainda aceita a sessão e " +
    "que os pedidos descriptografam. Comece por aqui quando outra tool reclamar de sessão.",
  readOnly: true,
  input: Type.Object({
    verify: Type.Optional(
      Type.Boolean({
        description:
          "Também abre a lista de pedidos do ano corrente para confirmar que a sessão é aceita",
      }),
    ),
  }),
  run: async (args, ctx): Promise<AuthStatus> => {
    const { session, amazon, config } = ctx;
    let data: ReturnType<typeof session.load> = null;
    let loadError: string | undefined;
    try {
      data = session.load();
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }

    const cookies = data?.cookies ?? [];
    const expiry = soonestExpiry(cookies);
    const cooldown = amazon.cooldownUntil();
    const base: AuthStatus = {
      loggedIn: data !== null && hasAuthCookies(cookies),
      sessionFile: config.sessionPath,
      cookieCount: cookies.length,
      httpOnlyCount: cookies.filter((cookie) => cookie.httpOnly).length,
      authCookies: authCookieNames(cookies),
      hasCsdKey: hasCsdKey(cookies),
      userAgent: data?.userAgent ?? null,
      savedAt: data ? new Date(data.savedAt).toISOString() : null,
      ageDays: data ? Math.floor((ctx.now() - data.savedAt) / 86_400_000) : null,
      soonestExpiry: expiry === undefined ? null : new Date(expiry * 1000).toISOString(),
      breaker: amazon.state().tripped ? "tripped" : "ok",
      cooldownUntil: cooldown === null ? null : new Date(cooldown).toISOString(),
      browserRunning: amazon.state().loads > 0,
    };

    if (loadError) return compactObject({ ...base, loggedIn: false, error: loadError });
    if (data === null) {
      return compactObject({ ...base, hint: "Nenhuma sessão salva. Rode `amazon login`." });
    }
    if (!base.loggedIn) {
      return compactObject({
        ...base,
        hint: "A sessão salva não tem os cookies de autenticação da Amazon. Rode `amazon login`.",
      });
    }
    if (!args.verify) return compactObject(base);

    try {
      const year = new Date(ctx.now()).getFullYear();
      await ctx.amazon.page(ordersPath(YEAR_FILTER(year)), {
        readySelector: ORDERS_READY,
        readyExpression: ORDERS_READY_EXPRESSION,
      });
      return compactObject({ ...base, verified: true });
    } catch (error) {
      // An expired session, a captcha or a decryption that never ran are all
      // *statuses*: this tool exists to report exactly that, not to crash.
      if (
        error instanceof AuthError ||
        error instanceof CaptchaError ||
        error instanceof CsdError
      ) {
        return compactObject({
          ...base,
          loggedIn: false,
          verified: false,
          breaker: amazon.state().tripped ? "tripped" : base.breaker,
          error: error.message,
        });
      }
      throw error;
    }
  },
});
