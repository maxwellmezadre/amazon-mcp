---
name: amazon-mcp
description: >-
  Histórico de compras da Amazon.com.br da conta do usuário via MCP `amazon`:
  pedidos, produtos, preço pago, frete, promoções, pontos de recompensa,
  parcelamento, notas fiscais e resumos de gastos, com cache local. Use para
  perguntas como "quanto gastei na Amazon", "quando comprei X e por quanto",
  "em quantas vezes parcelei", "baixa a nota fiscal do pedido". Triggers:
  amazon, compra, comprei, pedido, quanto gastei, gasto, parcela, parcelamento,
  nota fiscal, NF-e, fatura, frete, pontos de recompensa, vendedor, entrega,
  ASIN, Prime.
---

# Amazon — histórico de compras

MCP `amazon` (`mcp__amazon__*`), 13 tools. Referência completa de parâmetros em
`TOOLS.md`, ao lado deste arquivo. Somente leitura na conta: nada aqui cancela,
devolve ou recompra.

## Leia antes de responder

1. **Comece por `auth_status`.** Sem sessão, toda tool de rede falha; a correção
   é sempre o usuário rodar `amazon login`.
2. **O cache responde quase tudo.** Só `sync`, `get_order` sem detalhe,
   `get_invoice`, `download_invoice` e `raw_get` usam a rede.
3. **`sync` trabalha em blocos.** Se devolver `done: false`, chame de novo até
   `done: true`. A primeira chamada de cada processo abre um Chrome headless e
   leva alguns segundos a mais; cada página leva de 2 a 4 segundos, de propósito.
4. **`status: unknown` é normal em pedidos antigos.** A Amazon remove o texto de
   status de compras de anos anteriores. Não diga que houve erro.
5. **Parcelas são PROJEÇÃO.** A Amazon informa quantas parcelas e o valor, mas
   nunca as datas de vencimento; quem controla é a fatura do cartão. Toda
   resposta de `installments_schedule` vem com `projected: true`. Diga isso.
6. **Cancelados não são gasto** e ficam fora das somas por padrão.
7. **O link da NF-e expira em cerca de 3 minutos** e é uma credencial. Nunca
   repasse a URL; para salvar o arquivo use `download_invoice`.
8. **Pedido `D01-` é digital**: assinatura ou conteúdo, sem endereço, às vezes
   sem cobrança.
9. **Quando algo quebrar, rode `doctor`.** Ele diz qual camada falhou.
10. **Se aparecer bloqueio anti-bot, pare.** Existe um bloqueio de 30 minutos
    gravado em disco; insistir só piora.

## Tools ↔ CLI

| Tool | CLI | Para quê |
|---|---|---|
| `auth_status` | `amazon status` | A sessão está viva? |
| `login` | `amazon login` | Entrar na Amazon (o usuário digita) |
| `doctor` | `amazon doctor` | Qual camada quebrou |
| `sync` | `amazon sync [--full]` | Encher o cache |
| `list_orders` | `amazon orders` | Listar pedidos |
| `get_order` | `amazon order <id>` | Detalhe completo |
| `search_products` | `amazon search <q>` | O que já comprei |
| `spending_summary` | `amazon spending --by <g>` | Quanto gastei |
| `installments_schedule` | `amazon installments` | Parcelas projetadas |
| `get_invoice` | `amazon invoice <id>` | Links de nota fiscal |
| `download_invoice` | `amazon download-invoice <id>` | Salvar a NF-e |
| `export` | `amazon export` | JSON/CSV |
| `raw_get` | `amazon raw <path>` | Redescoberta |

## Receitas

- *"Quanto gastei na Amazon esse ano?"* → `spending_summary` com
  `group_by: "year"`, ou `month` para abrir por mês.
- *"Quanto foi de frete e de imposto?"* → `spending_summary` com
  `group_by: "breakdown"`.
- *"Quando comprei aquele amaciante e por quanto?"* → `search_products`.
- *"Em quantas vezes parcelei o pedido X?"* → `get_order`, campo `payment`.
- *"Quanto vou pagar de parcela nos próximos meses?"* →
  `installments_schedule`, e avise que a data é estimada.
- *"Me manda a nota fiscal do último pedido"* → `list_orders`, depois
  `download_invoice`.

## Avisos

- Cada `sync` completo custa uma página por ano mais uma por pedido. Não rode em
  laço nem em paralelo com um `login`: os dois compartilham o mesmo perfil do
  Chrome.
- O cache guarda endereço, últimos dígitos do cartão e histórico de compras.
- Com `AMAZON_READ_ONLY=1` as tools que escrevem (`login`, `sync`,
  `download_invoice`, `export`) não são registradas.
