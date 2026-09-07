# Fixtures

Páginas **reais** da conta do autor, capturadas com `scripts/capture-fixtures.ts`
e anonimizadas por `scripts/anonymize-fixture.ts` antes de entrar no repositório
(que é público).

O que a anonimização preserva de propósito:

- **Valores, datas e quantidades ficam intactos.** É o que mantém as invariantes
  financeiras verdadeiras: `14053 + 890 − 890 − 2647 = 11406` continua fechando,
  e o total do card da lista continua igual ao total geral do detalhe.
- **Os identificadores mantêm a forma e as relações.** Um número de pedido segue
  com o prefixo (`702-`, `701-`, `D01-`), um ASIN segue começando com `B0`, e o
  mesmo pedido tem o mesmo número na lista e no detalhe — então os testes de
  junção continuam significando algo.
- **O vocabulário de interface fica intacto** (`Total geral`, `Vendido por`,
  `sem juros`, meses). Trocar essas palavras deixaria os testes passando contra
  dados sem sentido.

O que é substituído: nome, endereço, cidade, CEP, últimos dígitos do cartão,
parâmetros de rastreamento e a URL pré-assinada da NF-e — que é uma credencial.

| Arquivo | Para que serve |
|---|---|
| `orders-with-two.html` | Dois pedidos: um físico com 3 itens e um digital (`D01-`, sem destinatário) |
| `orders-single.html` | Um pedido físico, com paginação de página única |
| `orders-empty-year.html` | Ano sem pedidos: "não fez **um** pedido em 2024" |
| `orders-empty-last30.html` | Período sem pedidos: "não fez **nenhum** pedido nos últimos 30 dias" |
| `detail-physical-2.html` | 3 itens, frete, promoção, pontos de recompensa, 6x sem juros |
| `detail-physical-1.html` | 1 item, 4x sem juros |
| `detail-digital.html` | Pedido digital gratuito, rótulos próprios ("Total deste pedido"), sem endereço |
| `popover-physical-1.html` | Popover com resumo para impressão **e** link da NF-e |
| `popover-digital.html` | Popover só com o resumo para impressão |
