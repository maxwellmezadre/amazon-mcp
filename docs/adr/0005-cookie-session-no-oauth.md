# ADR-0005: Sessão por cookie, capturada pelo navegador

Status: aceito.

## Contexto

A Amazon não tem API de comprador. A SP-API atende vendedores e a Product
Advertising API atende afiliados; nenhuma das duas dá acesso ao histórico da
própria conta. Não existe OAuth, access token nem refresh token para esse caso.

## Decisão

Autenticar pelos cookies da sessão do navegador do próprio usuário. Eles são
capturados por um login interativo numa janela real do Chrome (a ferramenta
nunca vê a senha) ou importados do banco de cookies de um navegador Chromium
no macOS. O sucesso do login é detectado pela lista de pedidos renderizada e
decifrada, com os cookies de autenticação presentes, não pela URL.

Os cookies são lidos do contexto do navegador porque os que autenticam são
`HttpOnly`: `document.cookie` não os enxerga, e um jar montado dali não
autentica nada.

## Consequências

O usuário faz login à mão de vez em quando. Não há como renovar sozinho: quando
a sessão cai, a ferramenta devolve um erro acionável e não tenta logar por
conta própria. Os cookies equivalem à conta inteira, daí a cifragem em repouso
(ADR-0006).
