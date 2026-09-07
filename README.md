# amazon-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.3-black)](https://bun.sh)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-blue)](tsconfig.json)

CLI + servidor MCP para o seu histórico de compras na **Amazon.com.br**:
pedidos, produtos, preço pago, frete, promoções, pontos de recompensa,
parcelamento, notas fiscais e resumos de gastos — com cache local em SQLite.

> **Somente leitura na conta.** Nenhuma tool cancela pedido, devolve, recompra
> ou altera qualquer coisa na Amazon.

```console
$ amazon spending --by year
key   orders  items  total
----  ------  -----  ----------
2026  2       4      BRL 114.06
2025  1       1      BRL 210.99
```

## Por que precisa de um navegador

A Amazon.com.br entrega o histórico de pedidos **cifrado dentro do HTML**. Cada
card chega como um `<div class="csd-encrypted-sensitive">` com um payload, e só
o JavaScript da própria página o transforma em conteúdo. `curl` e `fetch` com a
sessão perfeita recebem os contêineres **vazios**.

Por isso toda leitura passa por um Chrome de verdade: ele carrega a página,
espera a descriptografia e devolve o HTML já legível, que é então interpretado
em Node. Não é conveniência, é requisito. Veja
[ADR-0009](docs/adr/0009-browser-mandatory-csd.md).

## Instalação

Precisa de [Bun](https://bun.sh) ≥ 1.3 e do Google Chrome instalado.

```bash
git clone https://github.com/maxwellmezadre/amazon-mcp
cd amazon-mcp
bun install
bun run setup      # compila, instala em ~/.local/bin, registra o MCP e a skill
```

## Login

```bash
amazon login       # abre o Chrome; você digita senha, 2FA e captcha
amazon status      # confirma que a sessão está viva
```

O login é sempre manual. Nada de senha ou código automatizado: além do risco
para a conta, a Amazon tem detecção dedicada nessa tela.

Alternativa no macOS, se você já está logado em outro navegador:

```bash
amazon login --from-browser arc     # ou chrome, brave, edge, chromium
```

## Uso

```bash
amazon sync --full                  # primeira carga (em blocos, ~3s por página)
amazon orders                       # pedidos do cache
amazon order 702-1234567-1234567    # detalhe completo
amazon search "amaciante"           # o que já comprei
amazon spending --by breakdown      # frete, promoções, pontos, imposto
amazon installments                 # parcelas projetadas
amazon invoice 702-1234567-1234567  # links de nota fiscal
amazon download-invoice 702-...     # salva o PDF da NF-e
amazon export --format csv --scope items
amazon doctor                       # qual camada quebrou
```

Todo comando aceita `--json`.

Como servidor MCP, o binário responde em `amazon mcp` (stdio). O `bun run setup`
já o registra no Claude Code.

## Variáveis de ambiente

| Variável | Default | Para quê |
|---|---|---|
| `AMAZON_CONFIG_DIR` | `~/.config/amazon-mcp` | Sessão, cache e perfil do Chrome |
| `AMAZON_EXPORT_DIR` | `~/Downloads/amazon-export` | Único diretório onde se escreve |
| `AMAZON_SESSION_KEY` | — | Chave da sessão (base64 de 32 bytes) |
| `AMAZON_READ_ONLY` | `0` | Esconde as tools que escrevem |
| `AMAZON_HEADLESS` | `1` | `0` mostra a janela (depuração, bloqueio) |
| `AMAZON_BROWSER_CHANNEL` | `chrome` | `chrome`, `chromium` ou `msedge` |
| `AMAZON_MIN_INTERVAL_MS` | `2000` | Ritmo entre páginas |
| `AMAZON_JITTER_MS` | `2000` | Variação aleatória do ritmo |
| `AMAZON_COMPACT` | `0` | Respostas enxutas por padrão |

A lista completa está em [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Como funciona

1. `login` guarda os cookies da sessão cifrados com AES-256-GCM.
2. `sync` percorre a lista de pedidos ano a ano e depois a página de detalhe de
   cada pedido, em blocos retomáveis, gravando tudo em SQLite com valores em
   **centavos inteiros**.
3. Todas as consultas respondem do cache, sem rede.
4. O HTML já descriptografado fica guardado, então uma correção de parser
   reprocessa o passado com `amazon sync --reparse`, sem novas requisições.

## Troubleshooting

- **"Nenhuma sessão salva"** → `amazon login`.
- **Pedidos não aparecem / `status: unknown`** → normal em compras antigas: a
  Amazon remove o texto de status delas.
- **Verificação anti-bot** → existe um bloqueio de 30 minutos gravado em disco.
  Abra a Amazon no seu navegador, resolva o desafio e espere. Insistir piora.
- **Chrome não abre** → instale o Google Chrome, ou
  `bunx playwright install chromium` e `AMAZON_BROWSER_CHANNEL=chromium`.
- **Layout mudou** → `amazon doctor` diz qual camada quebrou;
  [docs/REDISCOVERY.md](docs/REDISCOVERY.md) diz como remapear.

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [docs/TOOLS.md](docs/TOOLS.md) | Referência das 13 tools (gerada) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Camadas e regras |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Todas as variáveis |
| [docs/REDISCOVERY.md](docs/REDISCOVERY.md) | Quando a Amazon mudar |
| [docs/adr/](docs/adr/) | Decisões de arquitetura |

## Licença

MIT
