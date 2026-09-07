# ADR-0002: Bun como runtime único, com `bun:sqlite`

Status: aceito.

## Contexto

O cache precisa de SQLite. As opções em Node custam uma dependência nativa que
compila na instalação. O projeto também quer virar um binário só, sem runtime.

## Decisão

Bun 1.3 ou mais novo como único runtime. `bun:sqlite` (embutido, síncrono,
zero dependência), `bun test` como runner, `bun build --compile` para o
binário. Cinco dependências de runtime: o SDK do MCP, TypeBox, commander,
`node-html-parser` e `playwright-core` (ADR-0009).

## Consequências

Não roda em Node, porque `bun:sqlite` não existe lá. Para quem não tem Bun, a
distribuição é o binário compilado, que não precisa de runtime nenhum. Some
também a etapa de build no desenvolvimento: o Bun executa TypeScript direto.
