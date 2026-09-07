# Do zero à primeira resposta

## 1. Instalar

```sh
git clone https://github.com/maxwellmezadre/amazon-mcp.git
cd amazon-mcp
bun install
bun run setup
```

Precisa do Bun 1.3 ou mais novo e do Google Chrome. O `setup` compila o
binário, instala em `~/.local/bin/amazon`, registra o servidor MCP no Claude
Code e copia a skill. Outras formas de instalar estão no
[README](../README.md#instalação).

## 2. Entrar na conta

```sh
amazon login                        # abre o Chrome; você digita senha, 2FA e captcha
amazon login --from-browser chrome  # ou importa a sessão de um navegador já logado (macOS)
amazon status                       # confere que a sessão ficou salva
```

Nada é automatizado na tela de login: além do risco para a conta, a Amazon tem
detecção de robô dedicada ali. Detalhes em [LOGIN.md](LOGIN.md).

## 3. Baixar o histórico

```sh
amazon sync --full    # primeira carga completa, ano a ano
amazon doctor         # confirma que todas as camadas respondem
```

O `sync` abre um Chrome headless e carrega uma página por ano mais uma por
pedido, com 2 a 4 segundos entre elas. É a velocidade de quem navega, e ir mais
rápido é o que rende um captcha. O comando repete os blocos sozinho até
terminar.

## 4. Perguntar

Quanto gastei, por ano?

```sh
amazon spending --by year
```

Onde foi parar o dinheiro no ano passado?

```sh
amazon spending --by breakdown --from 2025-01-01 --to 2025-12-31
```

Mostra subtotal, frete, promoções, pontos de recompensa e imposto. Descontos e
pontos aparecem negativos, e a soma fecha com o total.

Quando comprei aquilo, e por quanto?

```sh
amazon search "amaciante"
```

Ignora acentos e maiúsculas: `biblia` encontra `Bíblia`.

Em quantas vezes parcelei?

```sh
amazon order 702-1234567-1234567 --json | jq .payment
```

Quanto vou pagar de parcela nos próximos meses?

```sh
amazon installments --months 6
```

As datas são projetadas: a Amazon informa quantas parcelas e o valor, mas não
os vencimentos. Confira na fatura do cartão.

Me dá a nota fiscal.

```sh
amazon invoice 702-1234567-1234567          # vê se existe NF-e
amazon download-invoice 702-1234567-1234567 # salva o PDF
```

Se o vendedor não emitiu NF-e, `--kind summary` salva o resumo do pedido em PDF.

## 5. Pelo Claude

O `setup` já registrou o servidor. Reinicie o Claude Code e pergunte em
português: "quanto gastei na Amazon este ano?", "quando comprei o amaciante e
por quanto?", "me manda a nota fiscal do último pedido". A skill em
[`SKILL.md`](../SKILL.md) ensina o agente a começar por `auth_status`, a rodar
`sync` quando o cache está vazio e a não insistir num bloqueio anti-bot.

## Manutenção

```sh
amazon sync              # incremental: só o ano corrente, para na primeira página sem novidade
amazon sync --reparse    # reprocessa o cache depois de uma correção de parser, sem rede
amazon export --format csv --scope items
```

A sessão dura semanas. Quando cair, `amazon status` diz, e `amazon login`
resolve; o servidor MCP recarrega a sessão nova sem reiniciar.
