# Login

## Por que precisa de um navegador

Os cookies que autenticam (`at-acbbr` e `sess-at-acbbr`) são `HttpOnly`:
`document.cookie` não os enxerga, e um jar montado dali não autentica nada. E
mesmo com eles, a lista de pedidos chega cifrada no HTML; só a página, com a
chave do cookie `csd-key`, transforma aquilo em conteúdo
([ADR-0009](adr/0009-browser-mandatory-csd.md)). Então tanto o login quanto as
leituras passam por um Chrome de verdade.

## O caminho normal

```sh
amazon login
```

Abre uma janela real do Chrome na página de pedidos. Você digita a senha, o
código de verificação e resolve qualquer captcha. Nada disso é automatizado:
além do risco para a conta, a Amazon tem detecção de robô dedicada nessa tela.

O sucesso não é detectado pela URL nem por um cookie isolado, e sim pelo que a
ferramenta realmente precisa: a lista de pedidos renderizada e decifrada, com
os cookies de autenticação no navegador. As duas condições juntas, porque a
Amazon serve uma página com o filtro de período mesmo para quem não está logado.

`--fresh` apaga o perfil de automação antes, para a Amazon ver um dispositivo
novo. `--timeout <s>` muda os 5 minutos de espera.

## Importando de um navegador já logado (macOS)

Se você já está logado no Arc, Chrome, Brave, Edge ou Chromium:

```sh
amazon login --from-browser arc
```

Lê o banco de cookies do navegador, decifrando com a chave que o macOS guarda no
Keychain; o sistema pede sua permissão uma vez. Nenhuma senha é armazenada.
`AMAZON_IMPORT_BROWSER` torna isso o padrão do `login`, inclusive da tool.

Ressalva: a sessão passa a ser compartilhada com aquele navegador. Se a Amazon
rotacionar um cookie de um lado, o outro pode expirar; basta importar de novo.

## O que é gravado, e onde

Os cookies (inclusive os `HttpOnly`) e o User-Agent real do navegador vão para
`~/.config/amazon-mcp/session.enc`, cifrados com AES-256-GCM, arquivo `0600`.
A chave fica em `AMAZON_SESSION_KEY` ou em `session.key` ao lado, `0600`,
gerada na primeira gravação ([ADR-0006](adr/0006-encrypted-session-at-rest.md)).

O perfil do Chrome em `browser-profile/` também guarda a sessão logada, em
claro: é um perfil de navegador. Trate os dois arquivos como a senha.

## Ciclo de vida

A sessão dura semanas enquanto for reusada da mesma máquina. O Chrome renova os
cookies sozinho, e o transporte grava a renovação de volta em `session.enc`
sempre que algum valor muda. É isso que mantém a sessão viva sem novo login.

Quando ela cai, as tools devolvem uma mensagem dizendo para rodar
`amazon login`. O servidor MCP recarrega a sessão nova sem reiniciar.

Não rode `login` e `sync` ao mesmo tempo: os dois usam o mesmo perfil do
Chrome.

## Revogando

```sh
rm ~/.config/amazon-mcp/session.enc
rm -rf ~/.config/amazon-mcp/browser-profile
```

Isso apaga a cópia local. Para invalidar do lado da Amazon, saia da conta em
todos os dispositivos nas configurações de segurança do site.
