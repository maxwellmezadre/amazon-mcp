# A superfície interna da Amazon

Não é uma API: são as páginas de pedidos que o navegador de um comprador
carrega, lidas por um Chrome de verdade e interpretadas fora dele. Tudo abaixo
foi medido na conta real em setembro de 2026.

## Por que não existe caminho oficial

A Amazon tem duas APIs públicas e nenhuma serve: a SP-API é para vendedores e
a Product Advertising API é para afiliados. O histórico da própria conta só
existe nas páginas de "Seus pedidos", atrás da sessão do navegador. A
alternativa oficial é "Solicite seus dados", um export assíncrono por e-mail,
fora do escopo deste projeto.

## Autenticação

Os cookies que provam a sessão são `at-acbbr` e `sess-at-acbbr`, com o sufixo
do marketplace (não `at-main`, como em outros países). Os cookies `x-` e
`ubid-` sobrevivem ao logout e não provam nada. Além deles, o `csd-key` é
obrigatório: é a chave com que a página decifra os pedidos (ver abaixo).

Todos são `HttpOnly`, então só saem do contexto do navegador, e são renovados
pelo servidor a cada visita. O transporte grava a renovação de volta em
`session.enc` sempre que um valor muda.

Uma sessão inválida não devolve 401: a Amazon serve a página com o filtro de
período e sem pedidos, ou redireciona para o login. O sinal confiável é a
ausência dos cookies de autenticação junto com uma página que não diz que o
período está vazio.

## Páginas

| Página | Caminho | O que traz |
| --- | --- | --- |
| Lista de pedidos | `/your-orders/orders?timeFilter=<filtro>&page=<n>` | 10 cards por página: número, data, total, destinatário, itens com título e imagem, status do envio. `/gp/css/order-history` redireciona para cá |
| Resumo para impressão | `/gp/css/summary/print.html?orderID=<id>` | A melhor fonte de detalhe: itens com preço unitário e vendedor, todos os subtotais, pagamento com parcelamento, endereço. Sem carrosséis, então menos para decifrar |
| Popover de nota fiscal | `/your-orders/invoice/popover?orderId=<id>` | Os links reais: o resumo para impressão (sempre) e o PDF da NF-e quando o vendedor emitiu |

Os filtros de período (`last30`, `months-3`, `year-2025`...) são lidos do
`<select id="time-filter">` da própria página; a lista real depende da conta.
O `sync --full` percorre um ano por vez, página a página, e depois o resumo de
cada pedido. Com `deep`, o `doctor` carrega a lista do ano corrente e o resumo
do primeiro pedido.

## Armadilhas confirmadas

- Os pedidos chegam cifrados no HTML. Cada card é um
  `<div class="csd-encrypted-sensitive">` com um payload que só o JavaScript da
  página, com a chave do `csd-key`, transforma em DOM. Um `fetch` com a sessão
  perfeita recebe os contêineres vazios. Por isso um navegador é obrigatório, e
  por isso o transporte espera o conteúdo em vez de `networkidle` (a telemetria
  da Amazon nunca para).
- O filtro de período faz parte do esqueleto estático. Tratá-lo como prova de
  que a página carregou faz um ano inteiro de compras virar "zero pedidos" em
  silêncio. Zero só é aceito quando a página diz, e ela diz de duas formas:
  "não fez um pedido em 2024" e "não fez nenhum pedido nos últimos 30 dias".
- O contador "N pedidos feitos em" não é do filtro selecionado. Um ano vazio
  exibia "6 pedidos" ao lado da própria mensagem de que não havia nenhum.
- O cookie `session-id` tem exatamente a forma de um número de pedido
  (`139-1234567-1234567`) e aparece em dezenas de URLs de telemetria. Um regex
  sobre a página inteira coleta o session-id como se fosse compra. O número só
  é lido de `.yohtmlc-order-id`, e ainda comparado com o cookie.
- Na página de detalhe, os atributos `data-component` (`itemTitle`,
  `unitPrice`, `quantity`, `chargeSummary`, `shippingAddress`) são estáveis.
  As classes do widget de pagamento carregam um hash por deploy
  (`pmts-portal-root-…`, `pmts-class-…`) e mudaram entre dois pedidos da mesma
  sessão. Um meta-teste proíbe classe com hash nos seletores.
- Rótulos chegam em caixa normal; a caixa alta na tela é CSS. `"TOTAL"` nunca
  casa.
- Preços vêm de duas formas: `R$246,80` no preço acessível e `R$ 246,80` nas
  linhas de subtotal, com espaço não separável. Pontos e promoções vêm
  negativos (`-R$ 0,96`), frete grátis vem como texto.
- A quantidade não é renderizada quando é 1 (`data-component="quantity"` vazio).
- O CEP vem sem hífen.
- O link da NF-e é uma URL pré-assinada que expira em cerca de 3 minutos
  (`X-Amz-Expires=179`). É tratado como credencial: buscado na hora do
  download, nunca devolvido por `get_invoice` nem gravado em log.
- A Amazon remove o texto de status de pedidos de anos anteriores, então eles
  nunca aparecem como "entregue". O parser deixa `unknown`, e a idade da compra
  decide se vale rebuscar o detalhe.
- Pedidos `D01-` são digitais: assinatura ou conteúdo, sem endereço, às vezes
  sem cobrança, e com rótulos próprios no resumo ("Total deste pedido").
- Ir mais rápido que 2 a 4 segundos por página rende um desafio anti-bot. O
  cliente para na hora e grava um cooldown de 30 minutos que sobrevive ao
  processo.
