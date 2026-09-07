# ADR-0001: Arquitetura em camadas, pragmática

Status: aceito.

## Contexto

O projeto lê uma superfície interna instável (as páginas de pedidos da
Amazon), guarda dados sensíveis e serve duas interfaces, MCP e CLI. Sem
separação, uma mudança de layout espalha edição por todo lado. Com separação
demais, um projeto pessoal vira cerimônia.

## Decisão

Camadas com dependência só para dentro: transporte (`cli/`, `mcp/`), depois
`tools/`, depois `cache/` e `domain/`; por baixo, `browser/` e `amazon/`, e
na base `session/` e `core/`. Sem container de injeção, sem repositório
genérico, sem serviço para cada substantivo. `createContext(loadConfig())` é
a fiação inteira.

Duas regras carregam o peso: todo carregamento de página passa por
`src/browser/client.ts`, e só `src/amazon/selectors.ts` conhece um seletor.

## Consequências

Uma mudança de layout quebra um arquivo, e o `doctor` diz qual. Em troca, é
preciso disciplina: nada de importar o SDK do MCP fora de `src/mcp/`, nem o
commander fora de `src/cli/`.
