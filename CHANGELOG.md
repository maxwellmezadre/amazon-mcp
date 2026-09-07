# Changelog

Segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
[SemVer](https://semver.org/lang/pt-BR/).

## [Unreleased]

## [0.1.1] - 2026-09-07

### Added

- `docs/INTERNAL-API.md`: a superfície interna da Amazon (páginas, autenticação
  e as armadilhas confirmadas na conta real), no mesmo formato dos outros MCPs.

### Changed

- README, SKILL e `docs/` reorganizados no padrão comum dos cinco MCPs de
  histórico de compras (amazon, mercadolivre, shein, shopee, aliexpress):
  mesmas seções, mesma tabela de tools com o custo em rede, mesma tabela de
  troubleshooting.
- ADRs no formato comum (`Contexto`, `Decisão`, `Consequências`) e com os fatos
  conferidos contra o código: 0001, 0002, 0005 e 0007 traziam trechos copiados
  do aliexpress-mcp (`src/core/http.ts`, `src/domain/normalize.ts`, Open
  Platform, `formatPriceInfo`) que não existem aqui.
- `scripts/install.ts` no formato comum: `--prefix=`, `--skip-build`,
  `--dry-run` e `--import-browser=`.
- `scripts/verify.ts` também confere que `raw_get` recusa uma superfície de
  escrita e um caminho com `..`, e que o log sai no stderr.
- `docs/TOOLS.md` gerado no formato comum: índice com âncoras e o marcador de
  escrita em cada tool.
- Workflows de CI e release, templates de issue e PR, `.gitignore` e código de
  conduta no formato comum.
- `package.json`: `bin` na forma canônica que o npm grava.

### Fixed

- CONTRIBUTING citava `src/core/http.ts` e `src/domain/normalize.ts`, arquivos
  do aliexpress-mcp; agora aponta para `src/browser/client.ts` e
  `src/amazon/selectors.ts`, que são os que existem.
- O exemplo de cookie `session-id` na documentação e nos comentários deixou de
  usar um valor real.

## [0.1.0] - 2026-09-07

### Added

- CLI `amazon` e servidor MCP `amazon-mcp` sobre um núcleo compartilhado, com
  13 tools e um comando de CLI para cada uma.
- Leitura por navegador com espera da descriptografia da Amazon, fila serial,
  ritmo de 2 a 4 segundos, backoff e disjuntor anti-bot com bloqueio de 30
  minutos persistido.
- Sessão cifrada com AES-256-GCM; login interativo e importação de cookies de
  Arc, Chrome, Brave, Edge e Chromium no macOS.
- Cache SQLite com busca textual sem acentos, valores em centavos inteiros e o
  HTML guardado para reprocessar sem rede.
- Pedidos, detalhe com todos os subtotais, busca, gastos por mês, ano, vendedor,
  forma de pagamento, tipo e composição, parcelas projetadas, notas fiscais em
  PDF, exportação JSON/CSV e diagnóstico camada a camada.

### Notas

Coisas que só apareceram contra a conta real, e que contrariam o que a
documentação de engenharia reversa inicial supunha:

- A Amazon.com.br entrega os pedidos **cifrados no HTML**. Um cliente HTTP com a
  sessão perfeita recebe os contêineres vazios; um navegador é obrigatório.
- Os cookies de autenticação são `at-acbbr` e `sess-at-acbbr`, com o sufixo do
  marketplace, não `at-main`. Os cookies `x-` e `ubid-` sobrevivem ao logout e
  não provam sessão nenhuma.
- O filtro de período faz parte do esqueleto estático da página. Tratá-lo como
  prova de que a página carregou fazia um ano inteiro de compras virar "zero
  pedidos" silenciosamente. Zero só é aceito quando a página diz, e ela diz de
  duas formas diferentes.
- O contador "N pedidos feitos em" não é do filtro selecionado: um ano vazio
  exibia "6 pedidos" ao lado da própria mensagem de que não havia nenhum.
- A página de detalhe expõe atributos `data-component` semânticos, muito mais
  estáveis que as classes do widget de pagamento, que carregam um hash por
  deploy.
- O cookie `session-id` tem exatamente a forma de um número de pedido, e aparece
  em dezenas de URLs de telemetria.
- O link da NF-e é uma URL pré-assinada que expira em cerca de 3 minutos.
- A Amazon remove o texto de status de pedidos antigos, então eles nunca
  aparecem como "entregue".
- Preços vêm com espaço não separável, e o CEP vem sem hífen.

[Unreleased]: https://github.com/maxwellmezadre/amazon-mcp/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/maxwellmezadre/amazon-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/maxwellmezadre/amazon-mcp/releases/tag/v0.1.0
