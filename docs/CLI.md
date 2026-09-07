# CLI

Um comando por tool, com os mesmos nomes de parâmetro. Todo comando aceita
`--json`, que imprime o resultado cru no stdout, exatamente o que um cliente
MCP receberia.

## Sessão e diagnóstico

| Comando | Tool | Opções |
| --- | --- | --- |
| `amazon status` | `auth_status` | `--verify` gasta 1 página para confirmar a sessão |
| `amazon login` | `login` | `--from-browser <arc\|chrome\|chromium\|brave\|edge>`, `--fresh`, `--timeout <s>` |
| `amazon doctor` | `doctor` | `--shallow` não toca a rede |

## Cache

| Comando | Tool | Opções |
| --- | --- | --- |
| `amazon sync` | `sync` | `--full`, `--reparse`, `--year <filtro>`, `--max-requests <n>`, `--no-details` |

O `sync` trabalha em blocos para que uma chamada nunca estoure o timeout de um
cliente MCP. O comando repete os blocos sozinho até terminar, e escreve o
progresso no stderr:

```console
$ amazon sync --full
bloco 1: 12 req, 3 novos, 3 detalhes, faltam 0
```

Na primeira vez use `--full`. Depois, `amazon sync` sozinho basta: ele lê só o
ano corrente e para na primeira página sem novidade.

## Pedidos

| Comando | Tool | Opções |
| --- | --- | --- |
| `amazon orders` | `list_orders` | `--from`, `--to`, `--type physical\|digital`, `--seller`, `--limit` |
| `amazon order <id>` | `get_order` | `--refresh` busca a página de novo |
| `amazon search <termo>` | `search_products` | `--limit` |

## Financeiro e nota fiscal

| Comando | Tool | Opções |
| --- | --- | --- |
| `amazon spending` | `spending_summary` | `--by month\|year\|seller\|payment_method\|type\|breakdown`, `--from`, `--to` |
| `amazon installments` | `installments_schedule` | `--from`, `--months` |
| `amazon invoice <id>` | `get_invoice` | Mostra os links; não baixa nada |
| `amazon download-invoice <id>` | `download_invoice` | `--kind nfe\|summary`, `--filename` |

## Análise

| Comando | Tool | Opções |
| --- | --- | --- |
| `amazon export` | `export` | `--format json\|csv`, `--scope orders\|items`, `--from`, `--to` |

## Redescoberta

| Comando | Tool | Opções |
| --- | --- | --- |
| `amazon raw <path>` | `raw_get` | `--ready <seletor>`, `--max-bytes` |

## Servidor

| Comando | O que faz |
| --- | --- |
| `amazon mcp` | Sobe o servidor MCP no stdio (o binário `amazon-mcp` faz o mesmo) |

## Saída

Sem `--json`, o resultado sai numa tabela ou em pares `chave: valor`. Tudo que
não é resultado (progresso, avisos, erros) vai para o stderr, então `--json`
pode ser canalizado direto para o `jq`.

O código de saída é `1` quando algo falha. O processo nunca é encerrado à
força, para que o stdout termine de escoar.

## Exemplos

```sh
# quanto foi gasto em cada mês de 2026
amazon spending --by month --from 2026-01-01 --to 2026-12-31

# os pedidos de um vendedor
amazon orders --seller "Amazon.com.br" --limit 50

# tudo que já foi comprado, numa planilha
amazon export --format csv --scope items

# redescoberta: a lista de pedidos de um ano, como a página está hoje
amazon raw "/your-orders/orders?timeFilter=year-2026" --json > /tmp/page.json
```
