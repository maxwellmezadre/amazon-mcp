import { Type } from "@sinclair/typebox";
import { parseOrdersPage } from "../amazon/list.js";
import { parseOrderDetail } from "../amazon/detail.js";
import {
  DETAIL_READY,
  ORDERS_READY,
  ORDERS_READY_EXPRESSION,
  YEAR_FILTER,
  orderDetailPath,
  ordersPath,
} from "../amazon/urls.js";
import { AuthError, CaptchaError } from "../core/errors.js";
import { hasAuthCookies, hasCsdKey, sessionIdOf } from "../session/jar.js";
import { defineTool } from "./define.js";

// Layer-by-layer diagnostics. Every check is best-effort and reports rather
// than throws, because the whole point is to say WHICH layer broke. Checks that
// could not run are still reported, with the reason: a silently missing check
// is how a session problem gets misdiagnosed as a parser problem.

type Check = { name: string; ok: boolean; detail: string };

const ORDER: string[] = [
  "config",
  "session",
  "browser",
  "orders_page",
  "order_id_sanity",
  "detail_page",
  "money_identity",
  "cache",
];

export const doctor = defineTool({
  name: "doctor",
  description:
    "Diagnóstico camada a camada: configuração, sessão, navegador, página de pedidos, sanidade do " +
    "número do pedido, página de detalhe, fechamento das contas e cache. Diz QUAL camada quebrou " +
    "quando algo para de funcionar. Gasta até 2 carregamentos de página com deep=true (o padrão).",
  readOnly: true,
  input: Type.Object({
    deep: Type.Optional(
      Type.Boolean({ description: "Também carrega páginas reais da Amazon (default true)" }),
    ),
  }),
  run: async (args, ctx) => {
    const checks: Check[] = [];
    const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
    const deep = args.deep ?? true;

    add("config", true, `configDir ${ctx.config.configDir}, base ${ctx.config.baseUrl}`);

    // --- session ---------------------------------------------------------
    let sessionOk = false;
    let sessionId: string | undefined;
    try {
      const data = ctx.session.load();
      const cookies = data?.cookies ?? [];
      sessionId = sessionIdOf(cookies);
      sessionOk = data !== null && hasAuthCookies(cookies);
      add(
        "session",
        sessionOk,
        data === null
          ? "nenhuma sessão salva; rode `amazon login`"
          : `${cookies.length} cookies, autenticação ${hasAuthCookies(cookies) ? "presente" : "AUSENTE"}, ` +
            `csd-key ${hasCsdKey(cookies) ? "presente" : "AUSENTE (os pedidos não decifram)"}`,
      );
    } catch (error) {
      add("session", false, (error as Error).message);
    }

    // --- browser ---------------------------------------------------------
    // The sibling projects skip this and a missing Chrome shows up as a
    // misleading network error four retries later.
    try {
      await import("playwright-core");
      add("browser", true, `playwright-core resolvido, canal ${ctx.config.browserChannel}`);
    } catch (error) {
      add("browser", false, `playwright-core não resolve: ${(error as Error).message}`);
    }

    const breaker = ctx.amazon.cooldownUntil();
    if (breaker !== null) {
      add("orders_page", false, `bloqueio anti-bot ativo até ${new Date(breaker).toISOString()}`);
    }

    if (deep && sessionOk && breaker === null) {
      const year = new Date(ctx.now()).getFullYear();
      let firstOrder: string | undefined;
      try {
        const page = await ctx.amazon.page(ordersPath(YEAR_FILTER(year)), {
          readySelector: ORDERS_READY,
          readyExpression: ORDERS_READY_EXPRESSION,
        });
        const parsed = parseOrdersPage(
          page.html,
          { now: new Date(ctx.now()), sessionId },
          ctx.config.baseUrl,
        );
        firstOrder = parsed.orders[0]?.orderId;
        add(
          "orders_page",
          true,
          `${parsed.orders.length} pedido(s) em ${year}, ${parsed.filters.length} períodos disponíveis`,
        );
        add(
          "order_id_sanity",
          parsed.orders.every((order) => order.orderId !== sessionId),
          // The session-id cookie has the exact shape of an order number.
          parsed.orders.length === 0
            ? "nenhum pedido em " + year + " para conferir"
            : "nenhum número de pedido colide com o cookie session-id",
        );
      } catch (error) {
        if (error instanceof AuthError || error instanceof CaptchaError) {
          checks[1] = { name: "session", ok: false, detail: (error as Error).message };
        }
        add("orders_page", false, (error as Error).message);
      }

      if (firstOrder) {
        try {
          const page = await ctx.amazon.page(orderDetailPath(firstOrder), {
            readySelector: DETAIL_READY,
          });
          const parsed = parseOrderDetail(
            page.html,
            { now: new Date(ctx.now()), sourceUrl: page.url },
            ctx.config.baseUrl,
          );
          add(
            "detail_page",
            parsed.items.length > 0,
            `${parsed.items.length} item(ns), ${Object.keys(parsed.subtotals.raw).length} rótulos, ` +
              `pagamento ${parsed.payment?.method ?? "não lido"}`,
          );
          add(
            "money_identity",
            parsed.warnings.length === 0,
            parsed.warnings.length === 0 ? "as contas fecham" : parsed.warnings.join("; "),
          );
        } catch (error) {
          add("detail_page", false, (error as Error).message);
        }
      }
    }

    // --- cache -----------------------------------------------------------
    try {
      const stats = ctx.cache().stats();
      add(
        "cache",
        true,
        `${stats.orders} pedidos, ${stats.items} itens, ${stats.withDetail} com detalhe, ` +
          `${stats.pendingDetail} pendentes, ${stats.detailErrors} com erro`,
      );
    } catch (error) {
      add("cache", false, (error as Error).message);
    }

    // Checks that never ran are reported with the reason, never omitted.
    for (const name of ["orders_page", "order_id_sanity", "detail_page", "money_identity"]) {
      if (checks.some((check) => check.name === name)) continue;
      add(
        name,
        false,
        !deep ? "pulado: deep=false" : !sessionOk ? "pulado: sem sessão válida" : "pulado",
      );
    }

    checks.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
    return { ok: checks.every((check) => check.ok), checks };
  },
});
