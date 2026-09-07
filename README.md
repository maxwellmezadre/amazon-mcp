# amazon-mcp

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.3-black.svg)](https://bun.sh)
[![TypeScript: strict](https://img.shields.io/badge/typescript-strict-3178c6.svg)](tsconfig.json)
[![CI](https://github.com/maxwellmezadre/amazon-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/maxwellmezadre/amazon-mcp/actions/workflows/ci.yml)

CLI + servidor MCP para o histórico de compras da sua conta na Amazon.com.br:
pedidos, produtos, preço pago, frete, promoções, pontos de recompensa,
parcelamento, notas fiscais e resumos de gastos, com cache local em SQLite
para você perguntar quanto gastou sem bater na Amazon a cada pergunta.

A Amazon não tem API de comprador. A SP-API é para vendedores e a Product
Advertising API é para afiliados; nenhuma dá acesso ao histórico da sua própria
conta. Este projeto lê as mesmas páginas de pedidos que o seu navegador lê,
autenticado pelos cookies da sua sessão. E precisa de um Chrome de verdade para
isso: a Amazon.com.br entrega cada pedido cifrado dentro do HTML, e só o
JavaScript da própria página o decifra ([ADR-0009](docs/adr/0009-browser-mandatory-csd.md)).
Somente leitura: nenhuma operação de escrita na conta é implementada, e o
escape hatch recusa qualquer caminho fora das páginas de pedidos.

```console
$ amazon spending --by year
key   orders  items  total
----  ------  -----  ----------
2026  2       4      BRL 114.06
2025  1       1      BRL 210.99
```

## Sumário

- [Instalação](#instalação)
- [Login](#login)
- [Uso — CLI](#uso--cli)
- [Uso — MCP](#uso--mcp)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Tools](#tools)
- [Como funciona](#como-funciona)
- [Troubleshooting](#troubleshooting)
- [Documentação](#documentação)
- [Licença](#licença)

## Instalação

Requer [Bun](https://bun.sh) 1.3 ou mais novo (o cache usa `bun:sqlite`) e o
Google Chrome instalado.

### Tudo de uma vez (Claude Code)

```sh
git clone https://github.com/maxwellmezadre/amazon-mcp.git
cd amazon-mcp
bun install
bun run setup
```

`setup` compila o binário para `~/.local/bin/amazon`, registra o servidor MCP
`amazon` no seu `~/.claude.json` e instala a skill em `~/.claude/skills/`.
Rode de novo para atualizar.

### npm

```sh
npm i -g @maxwellmezadre/amazon-mcp   # instala `amazon` e `amazon-mcp` no PATH
amazon --version
```

O pacote roda com o Bun (por causa do `bun:sqlite`), então o Bun precisa estar
instalado.

### Binário único

```sh
bun run build:binary   # gera ./amazon, sem precisar de runtime instalado
./amazon --version
```

O binário faz tudo, inclusive o `login`: o `playwright-core` vai embutido, e o
Chrome vem do sistema.

## Login

A senha nunca passa por aqui. Dois caminhos:

```sh
amazon login                        # abre o Chrome para você entrar
amazon login --from-browser chrome  # importa a sessão de um navegador já logado (macOS)
```

O segundo é o mais rápido se você já usa a Amazon no Chrome, no Arc, no Brave
ou no Edge: ele lê os cookies pelo Keychain (o macOS pede permissão uma vez) e
não abre janela nenhuma. A sessão é gravada cifrada com AES-256-GCM em
`~/.config/amazon-mcp/session.enc` (0600). Detalhes em [`docs/LOGIN.md`](docs/LOGIN.md).

## Uso — CLI

```sh
amazon status --verify              # a Amazon ainda aceita a sessão?
amazon sync --full                  # primeira carga (em blocos, 2 a 4 s por página)
amazon orders                       # pedidos do cache, do mais novo para o mais antigo
amazon order 702-1234567-1234567    # um pedido inteiro, com todos os subtotais
amazon search "amaciante"           # entre os produtos que você já comprou
amazon spending --by breakdown      # quanto foi produto, frete, promoção, pontos, imposto
amazon installments                 # parcelas projetadas, mês a mês
amazon invoice 702-1234567-1234567  # links de nota fiscal
amazon download-invoice 702-1234567-1234567   # salva o PDF da NF-e
amazon export --format csv --scope items      # para planilha
amazon doctor                       # qual camada quebrou
```

`--json` funciona em qualquer comando e imprime exatamente o que o cliente MCP
receberia. Referência completa em [`docs/CLI.md`](docs/CLI.md).

## Uso — MCP

```sh
claude mcp add -s user amazon -- ~/.local/bin/amazon mcp
```

Ou, à mão, em `~/.claude.json`:

```json
{
  "mcpServers": {
    "amazon": { "type": "stdio", "command": "/Users/voce/.local/bin/amazon", "args": ["mcp"] }
  }
}
```

Use o caminho absoluto: clientes MCP não herdam o `PATH` do seu shell. Depois é
só perguntar: "quanto gastei na Amazon este ano?", "em quantas vezes parcelei
o último pedido?", "me manda a nota fiscal daquele livro".

## Variáveis de ambiente

Todas opcionais. A tabela completa está em
[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

| Variável | Default | Para quê |
| --- | --- | --- |
| `AMAZON_CONFIG_DIR` | `~/.config/amazon-mcp` | Onde ficam sessão, chave, cache e o perfil do Chrome |
| `AMAZON_EXPORT_DIR` | `~/Downloads/amazon-export` | O único diretório onde `export` e `download_invoice` escrevem |
| `AMAZON_SESSION_KEY` | gerada em `session.key` | Chave AES em base64 de 32 bytes |
| `AMAZON_READ_ONLY` | `0` | Não registra as tools que escrevem em disco |
| `AMAZON_HEADLESS` | `1` | `0` mostra a janela do Chrome nas leituras |
| `AMAZON_BROWSER_CHANNEL` | `chrome` | `chrome`, `chromium` ou `msedge` |
| `AMAZON_IMPORT_BROWSER` | unset | `arc`, `chrome`, `chromium`, `brave` ou `edge` |
| `AMAZON_MIN_INTERVAL_MS` | `2000` | Intervalo mínimo entre páginas |
| `AMAZON_JITTER_MS` | `2000` | Variação aleatória somada ao intervalo |

## Tools

São 13, iguais no MCP e no CLI. Referência gerada:
[`docs/TOOLS.md`](docs/TOOLS.md).

| Tool | Comando | Rede |
| --- | --- | --- |
| `auth_status` | `amazon status [--verify]` | 0 (1 página com `--verify`) |
| `login` | `amazon login [--from-browser]` | abre o navegador |
| `doctor` | `amazon doctor` | ≤ 2 páginas |
| `sync` | `amazon sync [--full\|--reparse]` | em blocos, 1 página por ano mais 1 por pedido |
| `list_orders` | `amazon orders` | 0 |
| `get_order` | `amazon order <id>` | 0 (1 com `--refresh`) |
| `search_products` | `amazon search <termo>` | 0 |
| `spending_summary` | `amazon spending --by …` | 0 |
| `installments_schedule` | `amazon installments` | 0 |
| `get_invoice` | `amazon invoice <id>` | 1 |
| `download_invoice` | `amazon download-invoice <id>` | 1 a 2 |
| `export` | `amazon export` | 0 |
| `raw_get` | `amazon raw <path>` | 1 |

## Como funciona

1. `login` guarda os cookies da sessão cifrados com AES-256-GCM, inclusive os
   `HttpOnly` e o `csd-key`, a chave que a página usa para decifrar os pedidos.
2. `sync` abre um Chrome headless, percorre a lista de pedidos ano a ano e
   depois a página de detalhe de cada pedido, em blocos retomáveis. O
   transporte espera a descriptografia terminar e guarda o HTML já legível.
3. Tudo é normalizado para um modelo com dinheiro em centavos inteiros e gravado
   em SQLite. As perguntas depois disso são SQL local, sem rede.
4. Como o HTML descriptografado fica guardado, uma correção de parser
   reprocessa o passado com `amazon sync --reparse`, sem novas requisições.

Três regras vieram da conta real e são a espinha do projeto:

- O número do pedido só é lido de dentro do card. O cookie `session-id` tem a
  mesma forma e aparece em dezenas de URLs da página
  ([ADR-0010](docs/adr/0010-selectors-and-order-id.md)).
- Zero pedidos só vale quando a página diz que o período está vazio. O filtro
  de período existe mesmo numa página que ainda não carregou.
- As parcelas são projeção: a Amazon informa quantas e de quanto, nunca as
  datas. `installments_schedule` marca isso em toda resposta.

## Troubleshooting

| Sintoma | O que fazer |
| --- | --- |
| `Nenhuma sessão salva` | `amazon login` ou `amazon login --from-browser chrome` |
| A sessão expirou | `amazon login` de novo; o servidor MCP recarrega sozinho |
| `status: unknown` num pedido | Normal em compras antigas: a Amazon remove o texto de status delas |
| Verificação anti-bot | Pare. Abra a Amazon no seu navegador, resolva o desafio e espere o bloqueio de 30 minutos passar |
| Chrome não abre | Instale o Google Chrome, ou `bunx playwright install chromium` e `AMAZON_BROWSER_CHANNEL=chromium` |
| O cache está vazio | `amazon sync --full` |
| Alguma coisa mudou no site | `amazon doctor` diz qual camada quebrou; [`docs/REDISCOVERY.md`](docs/REDISCOVERY.md) diz como remapear |

## Documentação

| Arquivo | Conteúdo |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Camadas, fluxo e as regras que as separam |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | Todas as variáveis e os arquivos em disco |
| [`docs/USAGE.md`](docs/USAGE.md) | Do zero à primeira resposta |
| [`docs/CLI.md`](docs/CLI.md) | Todos os comandos |
| [`docs/TOOLS.md`](docs/TOOLS.md) | Referência das tools (gerada) |
| [`docs/LOGIN.md`](docs/LOGIN.md) | Como o login funciona, o que grava, como revogar |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | O modelo, as regras de dinheiro e o que não existe |
| [`docs/INTERNAL-API.md`](docs/INTERNAL-API.md) | A superfície interna: páginas, cifragem, armadilhas |
| [`docs/REDISCOVERY.md`](docs/REDISCOVERY.md) | O que fazer quando a Amazon mudar |
| [`docs/adr/`](docs/adr) | As decisões de projeto e por quê |

## Licença

[MIT](LICENSE). Uso pessoal, somente leitura, sobre a sua própria conta. Não
redistribua os dados nem use isto como serviço multiusuário.
