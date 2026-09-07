# Tools

> Gerado por `bun run docs:tools` a partir de `src/tools/registry.ts`. Não edite à mão.

O servidor expõe 13 tools. Com `AMAZON_READ_ONLY=1` as 4 que escrevem algo (sessão, cache, arquivo) não são registradas. Nenhuma tool escreve na conta da Amazon.

| Tool | Escreve | O que faz |
| --- | --- | --- |
| [`auth_status`](#auth_status) | não | Diz se há uma sessão da Amazon salva e o que ela cobre (cookies de autenticação, chave de descriptografia dos pedidos, validade, navegador de origem). |
| [`login`](#login) | sim | Abre o Chrome na máquina onde este servidor roda para você entrar na Amazon à mão e salva a sessão criptografada. |
| [`doctor`](#doctor) | não | Diagnóstico camada a camada: configuração, sessão, navegador, página de pedidos, sanidade do número do pedido, página de detalhe, fechamento das contas e cache. |
| [`sync`](#sync) | sim | Atualiza o cache local com os pedidos da Amazon. |
| [`list_orders`](#list_orders) | não | Lista os pedidos da Amazon a partir do cache local, do mais novo para o mais antigo, com os itens de cada um. |
| [`get_order`](#get_order) | não | Detalhe completo de um pedido: itens com preço unitário e vendedor, todos os subtotais (frete, promoção, pontos de recompensa, imposto), forma de pagamento com parcelamento, endereço e links de nota fiscal. |
| [`search_products`](#search_products) | não | Busca por texto em tudo que já foi comprado (título e vendedor), respondendo do cache, sem rede. |
| [`spending_summary`](#spending_summary) | não | Soma quanto foi gasto na Amazon, agrupado por mês, ano, vendedor, forma de pagamento, tipo de pedido, ou aberto por composição (frete, promoção, pontos, imposto). |
| [`installments_schedule`](#installments_schedule) | não | Cronograma PROJETADO das parcelas em aberto, mês a mês. |
| [`get_invoice`](#get_invoice) | não | Devolve os links de nota fiscal de um pedido: o resumo para impressão (sempre) e o PDF da NF-e quando o vendedor emitiu uma. |
| [`download_invoice`](#download_invoice) | sim | Salva a nota fiscal de um pedido em disco, dentro de AMAZON_EXPORT_DIR. |
| [`export`](#export) | sim | Exporta os pedidos ou os itens do cache para um arquivo JSON ou CSV, dentro de AMAZON_EXPORT_DIR. |
| [`raw_get`](#raw_get) | não | Abre uma página da Amazon no navegador e devolve o HTML já descriptografado, sem interpretar. |

## `auth_status`

Diz se há uma sessão da Amazon salva e o que ela cobre (cookies de autenticação, chave de descriptografia dos pedidos, validade, navegador de origem). Não usa a rede por padrão. Com verify=true gasta 1 carregamento de página para confirmar que a Amazon ainda aceita a sessão e que os pedidos descriptografam. Comece por aqui quando outra tool reclamar de sessão.

Escreve em disco ou no cache: não.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `verify` | boolean | não | Também abre a lista de pedidos do ano corrente para confirmar que a sessão é aceita |

## `login`

Abre o Chrome na máquina onde este servidor roda para você entrar na Amazon à mão e salva a sessão criptografada. Nunca automatize o login nem o captcha: quem digita é o usuário. Com from_browser, importa os cookies de um navegador onde você já está logado (só macOS) em vez de abrir uma janela. Use quando auth_status disser que não há sessão ou que ela expirou.

Escreve em disco ou no cache: sim.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `from_browser` | `arc` \| `chrome` \| `chromium` \| `brave` \| `edge` | não | Importa a sessão deste navegador (macOS, via Keychain) em vez de abrir uma janela |
| `timeout_seconds` | integer (≥ 60, ≤ 900) | não | Tempo para concluir o login na janela (default 300) |
| `fresh` | boolean | não | Apaga o perfil de automação antes, para a Amazon ver um dispositivo novo (use se houver bloqueio) |

## `doctor`

Diagnóstico camada a camada: configuração, sessão, navegador, página de pedidos, sanidade do número do pedido, página de detalhe, fechamento das contas e cache. Diz QUAL camada quebrou quando algo para de funcionar. Gasta até 2 carregamentos de página com deep=true (o padrão).

Escreve em disco ou no cache: não.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `deep` | boolean | não | Também carrega páginas reais da Amazon (default true) |

## `sync`

Atualiza o cache local com os pedidos da Amazon. É a ÚNICA tool que usa a rede; todas as consultas respondem do cache. Trabalha em blocos: se devolver done=false, chame de novo até done=true. Cada página leva de 2 a 4 segundos (a Amazon é lenta e o ritmo é proposital), e a primeira chamada de cada processo abre um Chrome headless, o que leva alguns segundos a mais. mode=full varre todos os anos, incremental só o ano corrente, reparse reprocessa o que já está em cache sem usar a rede.

Escreve em disco ou no cache: sim.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `mode` | `incremental` \| `full` \| `reparse` | não | incremental (default depois do primeiro full) \| full (todos os anos) \| reparse (sem rede) |
| `max_requests` | integer (≥ 1, ≤ 100) | não | Teto de páginas carregadas nesta chamada (default 15) |
| `with_details` | boolean | não | Busca a página de detalhe de cada pedido (preço unitário, vendedor, parcelamento). Default true |
| `year` | string (`^(year-\d{4}|last30|months-3)$`) | não | Sincroniza só este período, ex.: year-2024 |

## `list_orders`

Lista os pedidos da Amazon a partir do cache local, do mais novo para o mais antigo, com os itens de cada um. Não usa a rede. Pedidos cancelados ficam de fora por padrão. Atenção: a Amazon remove o texto de status de pedidos antigos, então `status` costuma vir `unknown` em compras de anos anteriores; isso não quer dizer que algo deu errado.

Escreve em disco ou no cache: não.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `from` | string (`^\d{4}-\d{2}-\d{2}$`) | não | Data inicial (YYYY-MM-DD) |
| `to` | string (`^\d{4}-\d{2}-\d{2}$`) | não | Data final (YYYY-MM-DD) |
| `status` | `delivered` \| `shipped` \| `processing` \| `cancelled` \| `returned` \| `unknown` | não | Filtra por situação |
| `type` | `physical` \| `digital` | não | physical = produto entregue; digital = assinatura ou conteúdo |
| `seller` | string | não | Filtra por vendedor (busca parcial) |
| `min_total` | number | não | Valor mínimo do pedido, em reais |
| `max_total` | number | não | Valor máximo do pedido, em reais |
| `has_installments` | boolean | não | Só pedidos parcelados |
| `include_cancelled` | boolean | não | Inclui cancelados (default false) |
| `sort` | `date_desc` \| `date_asc` \| `total_desc` \| `total_asc` | não | Ordenação (default date_desc) |
| `limit` | integer (≥ 1, ≤ 200) | não | Máximo de itens (default 50) |
| `offset` | integer (≥ 0) | não | Itens a pular (paginação) |
| `compact` | boolean | não | Devolve apenas os campos essenciais, para economizar contexto (default AMAZON_COMPACT) |

## `get_order`

Detalhe completo de um pedido: itens com preço unitário e vendedor, todos os subtotais (frete, promoção, pontos de recompensa, imposto), forma de pagamento com parcelamento, endereço e links de nota fiscal. Responde do cache; só usa a rede (1 página) se o detalhe ainda não tiver sido buscado, ou com refresh=true.

Escreve em disco ou no cache: não.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `order_id` | string (`^[A-Z]?\d{2,3}-\d{7}-\d{7}$`) | sim | Número do pedido na Amazon, como aparece em `list_orders` (ex.: 702-1234567-1234567) |
| `refresh` | boolean | não | Busca a página de novo mesmo se já estiver em cache |

## `search_products`

Busca por texto em tudo que já foi comprado (título e vendedor), respondendo do cache, sem rede. Ignora acentos e maiúsculas. Responde perguntas como "quando comprei X e por quanto".

Escreve em disco ou no cache: não.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `query` | string (min 2 chars) | sim | Termo de busca |
| `from` | string (`^\d{4}-\d{2}-\d{2}$`) | não | Data inicial (YYYY-MM-DD) |
| `to` | string (`^\d{4}-\d{2}-\d{2}$`) | não | Data final (YYYY-MM-DD) |
| `limit` | integer (≥ 1, ≤ 200) | não | Máximo de itens (default 30) |

## `spending_summary`

Soma quanto foi gasto na Amazon, agrupado por mês, ano, vendedor, forma de pagamento, tipo de pedido, ou aberto por composição (frete, promoção, pontos, imposto). Responde do cache, sem rede. Pedidos cancelados ficam de fora por padrão, porque não são dinheiro gasto.

Escreve em disco ou no cache: não.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `group_by` | `month` \| `year` \| `seller` \| `payment_method` \| `type` \| `breakdown` | sim | Como agrupar o total |
| `from` | string (`^\d{4}-\d{2}-\d{2}$`) | não | Data inicial (YYYY-MM-DD) |
| `to` | string (`^\d{4}-\d{2}-\d{2}$`) | não | Data final (YYYY-MM-DD) |
| `include_cancelled` | boolean | não | Inclui cancelados (default false) |

## `installments_schedule`

Cronograma PROJETADO das parcelas em aberto, mês a mês. A Amazon informa quantas parcelas e o valor de cada uma, mas NÃO informa as datas de vencimento; quem controla isso é a fatura do cartão. Portanto as datas aqui são estimadas (primeira parcela na data do pedido, as demais a cada mês) e vêm sempre marcadas com projected: true. Nunca apresente como confirmado pela Amazon.

Escreve em disco ou no cache: não.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `from` | string (`^\d{4}-\d{2}-\d{2}$`) | não | Início do cronograma (YYYY-MM-DD, default hoje) |
| `months` | integer (≥ 1, ≤ 36) | não | Quantos meses à frente (default 12) |

## `get_invoice`

Devolve os links de nota fiscal de um pedido: o resumo para impressão (sempre) e o PDF da NF-e quando o vendedor emitiu uma. O link da NF-e é assinado e EXPIRA em poucos minutos, então é buscado na hora e não deve ser guardado nem repassado; para salvar o arquivo use download_invoice.

Escreve em disco ou no cache: não.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `order_id` | string (`^[A-Z]?\d{2,3}-\d{7}-\d{7}$`) | sim | Número do pedido na Amazon, como aparece em `list_orders` (ex.: 702-1234567-1234567) |
| `refresh` | boolean | não | Ignora o que está em cache e busca de novo |

## `download_invoice`

Salva a nota fiscal de um pedido em disco, dentro de AMAZON_EXPORT_DIR. kind=nfe baixa o PDF da NF-e emitida pelo vendedor; kind=summary imprime o resumo do pedido em PDF. Escreve arquivo local; nunca altera nada na conta.

Escreve em disco ou no cache: sim.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `order_id` | string (`^[A-Z]?\d{2,3}-\d{7}-\d{7}$`) | sim | Número do pedido na Amazon, como aparece em `list_orders` (ex.: 702-1234567-1234567) |
| `kind` | `nfe` \| `summary` | não | nfe = PDF da nota fiscal (default) \| summary = resumo do pedido impresso |
| `filename` | string | não | Nome do arquivo (sem caminho); default nfe-<pedido>.pdf |

## `export`

Exporta os pedidos ou os itens do cache para um arquivo JSON ou CSV, dentro de AMAZON_EXPORT_DIR. Escreve arquivo local; não usa a rede e não altera a conta.

Escreve em disco ou no cache: sim.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `format` | `json` \| `csv` | sim | Formato do arquivo |
| `scope` | `orders` \| `items` | sim | orders = um registro por pedido; items = um registro por produto comprado |
| `from` | string (`^\d{4}-\d{2}-\d{2}$`) | não | Data inicial (YYYY-MM-DD) |
| `to` | string (`^\d{4}-\d{2}-\d{2}$`) | não | Data final (YYYY-MM-DD) |
| `include_cancelled` | boolean | não | Inclui cancelados (default false) |
| `filename` | string | não | Nome do arquivo (sem caminho) |

## `raw_get`

Abre uma página da Amazon no navegador e devolve o HTML já descriptografado, sem interpretar. Serve para redescobrir um seletor quando o site muda; use com parcimônia e nunca em rajada. Só caminhos de leitura de pedidos (/your-orders/, /gp/css/, /your-returns, /pay/history); qualquer outro é recusado, porque este servidor nunca altera a conta.

Escreve em disco ou no cache: não.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `path` | string | sim | Caminho a partir de www.amazon.com.br, ex.: /your-orders/orders?timeFilter=year-2025 |
| `ready_selector` | string | não | Seletor CSS que prova que a página terminou de descriptografar (default: body) |
| `max_bytes` | integer (≥ 1024, ≤ 65536) | não | Corta o HTML neste tamanho (default 65536) |
