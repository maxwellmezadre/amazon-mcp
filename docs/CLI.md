# CLI

Todo comando aceita `--json`, que imprime o resultado cru no stdout. O que não é
resultado (progresso, avisos, erros) vai para o stderr, então `--json` pode ser
canalizado direto para o `jq`.

O código de saída é `1` quando algo falha; o processo nunca é encerrado à força,
para que o stdout termine de escoar.

| Comando | Tool | Notas |
|---|---|---|
| `amazon login` | `login` | `--from-browser <arc\|chrome\|brave\|edge\|chromium>`, `--fresh`, `--timeout <s>` |
| `amazon status` | `auth_status` | `--verify` gasta 1 página para confirmar a sessão |
| `amazon doctor` | `doctor` | `--shallow` não toca a rede |
| `amazon sync` | `sync` | `--full`, `--reparse`, `--year <filtro>`, `--max-requests <n>`, `--no-details` |
| `amazon orders` | `list_orders` | `--from`, `--to`, `--type`, `--seller`, `--limit` |
| `amazon order <id>` | `get_order` | `--refresh` busca a página de novo |
| `amazon search <q>` | `search_products` | `--limit` |
| `amazon spending` | `spending_summary` | `--by month\|year\|seller\|payment_method\|type\|breakdown` |
| `amazon installments` | `installments_schedule` | `--from`, `--months` |
| `amazon invoice <id>` | `get_invoice` | Mostra os links; não baixa nada |
| `amazon download-invoice <id>` | `download_invoice` | `--kind nfe\|summary`, `--filename` |
| `amazon export` | `export` | `--format json\|csv`, `--scope orders\|items` |
| `amazon raw <path>` | `raw_get` | `--ready <seletor>`, `--max-bytes` |
| `amazon mcp` | — | Sobe o servidor MCP no stdio |

## Sobre o `sync`

O `sync` trabalha em blocos para que uma chamada nunca estoure o timeout de um
cliente MCP. O comando de CLI repete os blocos sozinho até terminar, e escreve o
progresso no stderr:

```console
$ amazon sync --full
bloco 1: 12 req, 3 novos, 3 detalhes, faltam 0
```

Na primeira vez use `--full`. Depois, `amazon sync` sozinho já basta: ele lê só
o ano corrente e para na primeira página sem novidade.
