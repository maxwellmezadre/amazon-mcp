# ADR-0010 — Seletores centralizados e o número do pedido

- **Status:** Aceito
- **Contexto:** Três armadilhas medidas na página real.

## Decisão

**1. Um arquivo só.** Todo seletor vive em `src/amazon/selectors.ts`. Quando o
layout mudar, conserta-se um arquivo.

**2. Nunca uma classe com hash.** O widget de pagamento renderiza como
`pmts-portal-root-EHM5esZuGO9x` e `pmts-class-49e45ab6`, e o hash muda entre
deploys. Um meta-teste falha se um seletor casar `HASHED_CLASS`. No lugar,
usa-se `data-component`, que a Amazon expõe de forma semântica na página de
detalhe (`itemTitle`, `unitPrice`, `quantity`, `chargeSummary`), e texto.

**3. O número do pedido só sai de dentro do card.** O cookie `session-id` tem
**exatamente** a forma de um número de pedido (`139-9338268-4563450`) e aparece
em dezenas de URLs de telemetria. Um regex sobre a página inteira coleta o
session-id como se fosse compra. O parser lê só de `.yohtmlc-order-id`, e ainda
compara com o cookie: se baterem, é erro, não dado.

## Consequências

- Rótulos são comparados em caixa normal: a caixa alta na tela é CSS.
  `"TOTAL"` nunca casa.
- Zero pedidos só é aceito quando a página **diz** que o período está vazio, em
  qualquer uma das duas redações que a Amazon usa. O filtro de período faz parte
  do esqueleto estático e não prova nada — aceitá-lo como prova já custou um ano
  inteiro de histórico sumindo em silêncio.
