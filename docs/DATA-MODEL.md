# Modelo de dados

SQLite em `~/.config/amazon-mcp/cache.db`, modo WAL, arquivo `0600`. Migrações
são um array append-only indexado por `PRAGMA user_version`: uma versão já
publicada nunca é editada.

## Dinheiro

Todo valor monetário é INTEGER em centavos. A conversão para decimal acontece
uma única vez, na saída da tool. `parseBrl` devolve `null` quando não consegue
ler um valor, nunca zero: "sem preço nesta linha" e "esta linha custa zero" são
fatos diferentes.

Descontos, promoções e pontos de recompensa ficam negativos no banco, então a
identidade `subtotal + frete - promoções - pontos + imposto = total` é uma soma
simples, e o `doctor` a confere contra um pedido real.

## `orders`

Uma linha por pedido, chave `order_id`.

| Grupo | Colunas |
| --- | --- |
| Identidade | `order_id`, `order_type` (`physical`/`digital`), `purchased_at`, `purchased_at_text` |
| Da listagem | `total_cents`, `recipient_name`, `status`, `status_text`, `item_count` |
| Do detalhe | `items_subtotal_cents`, `shipping_cents`, `discount_cents`, `reward_points_cents`, `gift_card_cents`, `tax_cents`, `grand_total_cents`, `subtotals_json` |
| Pagamento | `payment_method`, `card_brand`, `card_last4`, `installments`, `installment_cents`, `interest_free`, `payment_text` |
| Entrega | `address_json` |
| Proveniência | `source_url`, `list_seen_at`, `detail_fetched_at`, `detail_error`, `raw_html`, `parser_version`, `warnings`, `updated_at` |

Três decisões que importam:

- A listagem nunca sobrescreve o que veio do detalhe. O card não tem preço
  unitário, pagamento nem endereço; se pudesse sobrescrever, um `sync` apagaria
  o que a página de detalhe preencheu.
- `subtotals_json` guarda o mapa cru de rótulos, inclusive os que esta versão
  não conhece. Um rótulo novo aparece na resposta em vez de sumir.
- `raw_html` é a página já descriptografada, comprimida. É o que permite
  `sync --reparse` corrigir o passado sem rede.

## `order_items`

Chave `(order_id, position)`: `asin`, `title`, `quantity`, `unit_cents`,
`line_cents`, `seller`, `product_url`, `image_url`, `return_window_text`.

## `shipments`

Chave `(order_id, position)`: `status_primary`, `status_secondary`,
`delivered_at`. Substituída por inteiro a cada leitura do detalhe.

## `order_items_fts`

Tabela FTS5 sobre título e vendedor, com `unicode61 remove_diacritics 2`. É o
que faz `cafe` encontrar `café`. Reconstruída ao fim de cada `sync`.

## `meta`

Chave-valor: `sync.cursor` (ponto de retomada), `sync.last_completed_at`,
`sync.last_full_at`, `sync.filters` e `antibot.cooldown_until`.

## O que não existe

- Não há tabela de parcelas. A Amazon informa quantas parcelas e o valor de
  cada uma, mas nunca as datas de vencimento. O cronograma é derivado na
  leitura e sempre marcado como projeção (`projected: true`).
- Não há status confiável para pedidos antigos. A Amazon remove o texto de
  status das compras de anos anteriores, então eles ficam `unknown`, e isso não
  é erro.
- Não há histórico além do ano mais antigo do seletor de período da página.
  Para ir além, o caminho é "Solicite seus dados" na própria Amazon, fora do
  escopo.
