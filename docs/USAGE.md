# Uso

## Primeiro dia

```bash
amazon login          # abre o Chrome; você faz o login
amazon status         # confere que a sessão ficou salva
amazon sync --full    # primeira carga completa
amazon doctor         # confirma que todas as camadas respondem
```

## Perguntas do dia a dia

**Quanto gastei, por ano?**

```bash
amazon spending --by year
```

**Onde foi parar o dinheiro no ano passado?**

```bash
amazon spending --by breakdown --from 2025-01-01 --to 2025-12-31
```

Mostra subtotal, frete, promoções, pontos de recompensa e imposto. Descontos e
pontos aparecem negativos, e a soma fecha com o total.

**Quando comprei aquilo, e por quanto?**

```bash
amazon search "amaciante"
```

Ignora acentos e maiúsculas: `biblia` encontra `Bíblia`.

**Em quantas vezes parcelei?**

```bash
amazon order 702-1234567-1234567 --json | jq .payment
```

**Quanto vou pagar de parcela nos próximos meses?**

```bash
amazon installments --months 6
```

As datas são **projetadas**: a Amazon informa quantas parcelas e o valor, mas
não os vencimentos. Confira na fatura do cartão.

**Me dá a nota fiscal.**

```bash
amazon invoice 702-1234567-1234567          # vê se existe NF-e
amazon download-invoice 702-1234567-1234567 # salva o PDF
```

Se o vendedor não emitiu NF-e, `--kind summary` salva o resumo do pedido em PDF.

## Manutenção

```bash
amazon sync              # incremental, rápido
amazon sync --reparse    # reprocessa o cache após uma correção de parser
amazon export --format csv --scope items
```
