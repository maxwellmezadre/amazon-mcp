# Quando a Amazon mudar o layout

Vai acontecer. Este é o roteiro.

## 1. Descobrir qual camada quebrou

```bash
amazon doctor --json
```

Ele testa, em ordem: configuração, sessão, navegador, página de pedidos,
sanidade do número do pedido, página de detalhe, fechamento das contas e cache.
Um check pulado é **reportado com o motivo**, nunca omitido.

| Check que falhou | Onde olhar |
|---|---|
| `session` | `amazon login` |
| `browser` | Chrome instalado? `AMAZON_BROWSER_CHANNEL` |
| `orders_page` | `src/amazon/list.ts` e o seletor de prontidão em `urls.ts` |
| `order_id_sanity` | `src/amazon/selectors.ts`, campo `orderId` |
| `detail_page` | `src/amazon/detail.ts` |
| `money_identity` | O mapa de rótulos em `parseSubtotals` |

## 2. Ver a página como ela está hoje

```bash
amazon raw "/your-orders/orders?timeFilter=year-2026" --ready "body" --json > /tmp/page.json
```

`raw_get` devolve o HTML **já descriptografado**. Só aceita caminhos de leitura
de pedidos; qualquer outro é recusado.

Para inspecionar a estrutura, prefira os atributos `data-component` da página de
detalhe (`itemTitle`, `unitPrice`, `quantity`, `chargeSummary`,
`shippingAddress`, `viewPaymentPlanSummaryWidget`). Eles são semânticos e
sobrevivem a mudanças de estilo, ao contrário das classes.

## 3. Consertar

1. Ajuste **apenas** `src/amazon/selectors.ts` quando for troca de seletor.
2. Recapture o corpus: `bun run scripts/capture-fixtures.ts --write`.
3. Regenere as fixtures: `bun run scripts/anonymize-fixture.ts --write`.
4. Escreva o teste antes da correção, em `test/parsers.test.ts`.
5. Incremente `PARSER_VERSION` em `src/cache/sync.ts`.
6. `amazon sync --reparse` reprocessa tudo que já está em cache, **sem rede**.

## Limitações medidas

| Limitação | Evidência | Mitigação |
|---|---|---|
| O histórico só vai até o ano mais antigo do seletor de período | `<select id="time-filter">` na conta real | Para ir além, "Solicite seus dados" na Amazon (fora do escopo) |
| O contador "N pedidos feitos em" **não** é do filtro selecionado | Um ano vazio mostrava "6 pedidos" junto de "você não fez um pedido em 2024" | Nunca usado como checagem |
| O texto de status some em pedidos antigos | Todos os pedidos de 2025 e 2026 da conta vieram sem status | `status` fica `unknown`; a idade da compra é que decide se o detalhe pode ser rebuscado |
| O link da NF-e expira | `X-Amz-Expires=179` na URL assinada | Buscado na hora do download, nunca cacheado |
| A quantidade não é renderizada quando é 1 | `data-component="quantity"` vem vazio | Default 1 |
| `.od-item-view-qty` não existe | Zero ocorrências nas três páginas de detalhe | Usa-se `data-component="quantity"` |
