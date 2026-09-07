import { Type } from "@sinclair/typebox";
import { IMPORT_BROWSERS } from "../config.js";
import { importFromBrowser } from "../session/browser-import.js";
import { DEFAULT_LOGIN_TIMEOUT_MS, runLogin } from "../session/login.js";
import { defineTool } from "./define.js";

// Opens a real browser window on the machine running this server and waits for
// the user to sign in. It writes only to the local encrypted session — never to
// the Amazon account.

export const login = defineTool({
  name: "login",
  description:
    "Abre o Chrome na máquina onde este servidor roda para você entrar na Amazon à mão e salva a " +
    "sessão criptografada. Nunca automatize o login nem o captcha: quem digita é o usuário. " +
    "Com from_browser, importa os cookies de um navegador onde você já está logado (só macOS) em vez " +
    "de abrir uma janela. Use quando auth_status disser que não há sessão ou que ela expirou.",
  readOnly: false,
  input: Type.Object({
    from_browser: Type.Optional(
      Type.Union(
        IMPORT_BROWSERS.map((browser) => Type.Literal(browser)),
        {
          description:
            "Importa a sessão deste navegador (macOS, via Keychain) em vez de abrir uma janela",
        },
      ),
    ),
    timeout_seconds: Type.Optional(
      Type.Integer({
        minimum: 60,
        maximum: 900,
        description: `Tempo para concluir o login na janela (default ${DEFAULT_LOGIN_TIMEOUT_MS / 1000})`,
      }),
    ),
    fresh: Type.Optional(
      Type.Boolean({
        description:
          "Apaga o perfil de automação antes, para a Amazon ver um dispositivo novo (use se houver bloqueio)",
      }),
    ),
  }),
  run: async (args, ctx) => {
    const report = (message: string) => ctx.log.info(message);
    // A new session must not keep talking through a browser holding the old
    // one; the next page load starts a fresh context.
    await ctx.dispose();

    const browser = args.from_browser ?? ctx.config.importBrowser;
    if (browser) {
      return importFromBrowser(ctx, {
        browser,
        ...(args.fresh === undefined ? {} : { fresh: args.fresh }),
        report,
      });
    }
    return runLogin(ctx, {
      ...(args.timeout_seconds ? { timeoutMs: args.timeout_seconds * 1000 } : {}),
      ...(args.fresh === undefined ? {} : { fresh: args.fresh }),
      report,
    });
  },
});
