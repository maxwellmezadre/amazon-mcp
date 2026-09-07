# Arquitetura

Uma camada só depende das de baixo. O SDK do MCP vive apenas em `src/mcp/`,
o commander apenas em `src/cli/`, e o `playwright-core` apenas em
`src/browser/launch.ts` e `src/session/login.ts`, por import dinâmico — o
caminho do servidor MCP nunca carrega nenhum dos três até precisar.

```
cli/index.ts ─┐
              ├─→ tools/*  →  cache/*  →  domain/*
mcp/server.ts ┘        ↓          ↑
                   browser/*  →  amazon/*
                       ↓
                   session/*  →  core/*
```

| Camada | Arquivos | Responsabilidade |
|---|---|---|
| `core` | `errors`, `logger`, `sqlite` | Tipos de erro, log em stderr com redação, abertura do banco |
| `session` | `jar`, `store`, `login`, `browser-import` | Cookies, sessão cifrada, login interativo |
| `browser` | `types`, `launch`, `transport`, `client` | Chrome, espera da descriptografia, fila e ritmo |
| `amazon` | `selectors`, `list`, `detail`, `popover`, `urls` | HTML → estruturas. **A única camada que conhece seletor** |
| `domain` | `money`, `dates`, `status`, `payment`, `address`, `types` | Texto → valor. Funções puras |
| `cache` | `db`, `repo`, `rows`, `sync` | Esquema, SQL, sincronização em blocos |
| `tools` | `define`, `registry`, e uma por área | Contrato das tools |

## Regras

1. **Nada de rede fora de `browser/client.ts`.** É lá que moram a fila serial, o
   intervalo entre páginas e o disjuntor anti-bot. Uma requisição que escape
   disso fura o contrato inteiro.
2. **Só `amazon/selectors.ts` tem seletor.** Ver
   [ADR-0010](adr/0010-selectors-and-order-id.md).
3. **Dinheiro é centavo inteiro.** A conversão para decimal acontece uma única
   vez, em `cache/rows.ts`, na saída da tool. Ver [ADR-0007](adr/0007-integer-cents.md).
4. **stdout é do JSON-RPC.** Todo log vai para stderr, com os valores de cookie
   redigidos.
5. **Falha de tool vira `isError`**, nunca derruba o servidor.
6. **Nada escreve na conta.** Nem `raw_get`, que aceita apenas uma allowlist de
   caminhos de leitura.
7. **`readOnly: false` significa "escreve em disco ou no cache"**, nunca "escreve
   na Amazon". Com `AMAZON_READ_ONLY=1` essas tools não são sequer registradas.

## Colaboradores injetáveis

`createContext(config, deps)` aceita `launchBrowser`, `loader`, `session`, `log`,
`db`, `sleep`, `now`, `random` e `cooldown`. É o que permite testar a fila, o
backoff e o disjuntor sem esperar de verdade, e rodar os parsers no CI sem
navegador.
