# Arquitetura

## Fluxo de uma pergunta

```
cli/index.ts ─┐
              ├─→ tools/*  →  cache/*  →  domain/*
mcp/server.ts ┘        ↓          ↑
                   browser/*  →  amazon/*
                       ↓
                   session/*  →  core/*
```

Uma pergunta entra pelo CLI ou pelo servidor MCP, que resolvem a mesma tool no
mesmo registry e a executam pelo mesmo `runTool`. A tool lê o cache SQLite e
responde. Só `sync`, `get_order --refresh`, `get_invoice`, `download_invoice`,
`doctor` e `raw_get` chegam ao navegador: `browser/client.ts` enfileira o
carregamento, respeita o ritmo, espera a descriptografia e devolve o HTML;
`amazon/*` transforma o HTML em estruturas; `domain/*` transforma texto em
valor; `cache/*` grava tudo em centavos inteiros.

Uma camada só depende das de baixo. O SDK do MCP vive apenas em `src/mcp/`, o
commander apenas em `src/cli/`, e o `playwright-core` apenas em
`src/browser/launch.ts`, por import dinâmico: o caminho do servidor MCP não
carrega nenhum dos três até precisar.

## Regras

1. Nada de rede fora de `browser/client.ts`. É lá que moram a fila serial, o
   intervalo entre páginas e o disjuntor anti-bot. Uma requisição que escape
   disso fura o contrato inteiro.
2. Só `amazon/selectors.ts` tem seletor, e nunca uma classe com hash
   ([ADR-0010](adr/0010-selectors-and-order-id.md)).
3. Dinheiro é centavo inteiro. A conversão para decimal acontece uma única vez,
   em `cache/rows.ts`, na saída da tool ([ADR-0007](adr/0007-integer-cents.md)).
4. stdout é do JSON-RPC. Todo log vai para stderr, com os valores de cookie
   redigidos.
5. Falha de tool vira `isError`, nunca derruba o servidor.
6. Nada escreve na conta. Nem `raw_get`, que aceita apenas uma allowlist de
   caminhos de leitura.
7. `readOnly: false` significa "escreve em disco ou no cache", nunca "escreve
   na Amazon". Com `AMAZON_READ_ONLY=1` essas tools não são sequer registradas.

## O que cada diretório faz

| Diretório | Arquivos | Responsabilidade |
| --- | --- | --- |
| `core` | `errors`, `logger`, `sqlite` | Tipos de erro, log em stderr com redação, abertura do banco |
| `session` | `jar`, `store`, `login`, `browser-import` | Cookies, sessão cifrada, login interativo, importação do Keychain |
| `browser` | `types`, `launch`, `transport`, `client` | Chrome, espera da descriptografia, fila e ritmo |
| `amazon` | `selectors`, `list`, `detail`, `popover`, `urls` | HTML para estruturas. A única camada que conhece seletor |
| `domain` | `money`, `dates`, `status`, `payment`, `address`, `types` | Texto para valor. Funções puras |
| `cache` | `db`, `repo`, `rows`, `sync` | Esquema, SQL, sincronização em blocos |
| `tools` | `define`, `registry`, `fields` e uma por área | Contrato das tools |
| `cli`, `mcp` | `index`, `server` | As duas superfícies, uma tool por comando |

## Testes

`createContext(config, deps)` aceita `launchBrowser`, `loader`, `session`,
`log`, `db`, `sleep`, `now`, `random` e `cooldown`. É o que permite testar a
fila, o backoff e o disjuntor sem esperar de verdade, e rodar os parsers no CI
sem navegador, sobre as fixtures reais anonimizadas de `test/fixtures/`.

Dois testes falam com o mundo e se auto-ignoram quando não podem:
`test/integration/live.real.test.ts` (conta real, com `AMAZON_LIVE=1` e uma
sessão salva) e `test/local/captures.local.test.ts` (as capturas cruas em
`task/captures/`). `scripts/verify.ts` sobe o servidor MCP de verdade, sem
sessão, e confere as invariantes que só aparecem com ele rodando.
