# Contribuindo

## Ambiente

Requer [Bun](https://bun.sh) 1.3 ou mais novo e o Google Chrome instalado (o
transporte roda num Chrome de verdade, ver [ADR-0009](docs/adr/0009-browser-mandatory-csd.md)).

```sh
bun install
bun run verify
```

`bun run verify` é o portão: type-check estrito, testes e as invariantes do
servidor MCP real sobre stdio, sem sessão e sem rede. Se ele passa, o PR passa.

## Convenções

- Código, comentários, testes e commits em inglês. Documentação, descrições de
  tools, help do CLI e mensagens de erro em pt-BR, porque quem lê essas é o
  usuário.
- Sem linter. O gate é `tsc` estrito (`noUncheckedIndexedAccess`, `noUnused*`,
  `verbatimModuleSyntax`) mais os testes.
- Nenhum arquivo de lógica acima de cerca de 450 linhas.
- Comentários explicam por quê, não o quê. Uma simplificação deliberada leva um
  comentário que diz qual é o teto e qual seria a saída.
- Conventional Commits, sem escopo, uma linha, até 72 caracteres.

## Regras de arquitetura

Estas não são estilo, são o que mantém o projeto consertável quando a Amazon
mudar (veja [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

1. Nenhum carregamento de página fora de `src/browser/client.ts`. É lá que
   moram a fila serial, o ritmo e o disjuntor anti-bot.
2. Só `src/amazon/selectors.ts` conhece um seletor, e só `src/amazon/*` conhece
   a estrutura das páginas. Nunca uma classe com hash.
3. SDK do MCP só em `src/mcp/`; commander só em `src/cli/`; `playwright-core`
   só em `src/browser/launch.ts`, por import dinâmico.
4. Dinheiro em centavo inteiro para dentro; decimal só na borda da tool.
5. stdout é do JSON-RPC. Log só no stderr, com os valores de cookie redigidos.
6. Falha de tool vira `isError`, nunca crash.
7. Nada de escrita na conta. Nem uma tool, nem um caminho no `raw_get`.

## Testes

Escreva o teste antes. Sem framework de mock: os colaboradores (navegador,
relógio, `sleep`, `random`, sessão, banco) são injetados por
`createContext(config, deps)`, então a fila, o backoff e o disjuntor são
testados sem esperar de verdade, e os parsers rodam no CI sem Chrome.

- Use as fixtures reais anonimizadas de `test/fixtures/`. Se precisar de uma
  nova, capture com `scripts/capture-fixtures.ts` e passe por
  `scripts/anonymize-fixture.ts`. Nunca commite dado cru.
- Mudou um parser? Incremente `PARSER_VERSION` em `src/cache/sync.ts`.
- Mudou uma tool? Rode `bun run docs:tools`.
- `test/integration/live.real.test.ts` fala com a conta real e só roda com
  `AMAZON_LIVE=1` e uma sessão salva. `test/local/captures.local.test.ts` roda
  sobre as capturas cruas em `task/captures/`. Os dois se auto-ignoram quando
  não têm o que precisam.

## Publicando

A tag `vX.Y.Z` dispara o release: binários para Linux, macOS e Windows, e o
publish no npm por OIDC (trusted publishing, sem token).

Uma ressalva do npm: a primeira versão de um pacote novo não sai por OIDC. O
npmjs exige que o pacote exista para você configurar o trusted publisher, e
exige o trusted publisher para publicar ([npm/cli#8544](https://github.com/npm/cli/issues/8544)).
A `0.1.0` foi publicada à mão, e o trusted publisher foi configurado depois. O
workflow pula a publicação quando a versão já está no registro, em vez de
falhar.

## Dado pessoal

O repositório é público. O anonimizador recusa gravar uma fixture em que um
valor pessoal das capturas sobreviva, e `test/local/captures.local.test.ts`
faz uma segunda varredura, independente, procurando os valores reais dentro
de `test/fixtures/`. As capturas cruas e o salt ficam em `task/`, que é
gitignored. Nunca tire nada de lá.
