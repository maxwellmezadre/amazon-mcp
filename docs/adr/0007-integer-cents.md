# ADR-0007: Dinheiro em centavos inteiros

Status: aceito.

## Contexto

A ferramenta soma valores de anos de compras. Ponto flutuante acumula erro, e
o SQLite não tem tipo decimal. A Amazon entrega dinheiro só como texto, e em
mais de uma forma: `R$246,80` no preço acessível, `R$ 246,80` nas linhas de
subtotal (com espaço não separável), `-R$ 0,96` para pontos de recompensa e
promoções, e `Grátis` no frete.

## Decisão

Centavo inteiro em toda a aplicação e no banco. `parseBrl` em
`src/domain/money.ts` é a única leitura de valor, e devolve `null` quando não
consegue ler, nunca zero: "sem preço nesta linha" e "esta linha custa zero"
são fatos diferentes, e só um deles entra na soma. A conversão para decimal
acontece uma vez, na borda da tool (`cache/rows.ts`).

## Consequências

`SUM()` é exato e a identidade `subtotal + frete - promoções - pontos + imposto
= total` fecha nos pedidos reais; o `doctor` confere isso no check
`money_identity`. Descontos e pontos ficam negativos no banco, então a soma dos
subtotais é o total, sem regra especial por rótulo.
