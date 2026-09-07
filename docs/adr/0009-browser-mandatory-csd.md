# ADR-0009 — Navegador obrigatório por causa do CSD

- **Status:** Aceito
- **Contexto:** A Amazon.com.br entrega o histórico de pedidos **cifrado no
  HTML**. Cada card chega como `<div class="csd-encrypted-sensitive">` mais um
  payload, e só o JavaScript da própria página — com a chave no cookie
  `csd-key` — transforma aquilo em DOM. Medido na conta real: um `fetch` com a
  sessão perfeita devolve os contêineres e **nada dentro deles**.

## Decisão

Toda leitura passa por um Chrome de verdade (Playwright, `channel: "chrome"`,
perfil persistente). O transporte carrega a página, **espera a descriptografia**
e devolve o HTML já decifrado, sem `<script>`. O parsing acontece em **Node**,
com `node-html-parser`, sobre essa string.

`playwright-core` é dependência normal, não opcional: sem navegador o projeto
não faz nada.

## Consequências

- A primeira chamada de cada processo custa alguns segundos (subir o Chrome);
  as seguintes, o tempo da página mais o ritmo de 2 a 4 segundos.
- **Por que não extrair dentro do navegador** (`page.$$eval`): o parser ficaria
  impossível de testar sem Chrome, o CI não rodaria, e não haveria como
  reprocessar uma página antiga quando um seletor mudasse. Com o HTML pós-CSD
  guardado em `raw_html`, `sync --reparse` conserta o passado sem rede.
- **Por que `node-html-parser`**: `HTMLRewriter` é streaming e não faz
  `querySelector` com ancestral, que é justamente o que os seletores da Amazon
  exigem. A alternativa pesada (jsdom) traria um DOM inteiro sem necessidade.
- Esperar a descriptografia não pode ser `networkidle`: a telemetria da Amazon
  nunca para. Espera-se o conteúdo.
