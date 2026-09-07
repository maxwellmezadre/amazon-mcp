# Login

## Como funciona

```bash
amazon login
```

Abre uma janela real do Chrome na página de pedidos. **Você** digita a senha, o
código de verificação e resolve qualquer captcha. Nada disso é automatizado:
além do risco para a conta, a Amazon tem detecção de robô dedicada nessa tela.

O sucesso não é detectado pela URL nem por um cookie isolado, e sim pelo que a
ferramenta realmente precisa: a lista de pedidos renderizada e decifrada, **com**
os cookies de autenticação no navegador. As duas condições juntas, porque a
Amazon serve uma página com o filtro de período mesmo para quem não está logado.

Ao final, os cookies (incluindo os `HttpOnly`, que `document.cookie` nunca
mostra) e o User-Agent real são salvos cifrados em `session.enc`.

## Importando de outro navegador (macOS)

Se você já está logado no Arc, Chrome, Brave, Edge ou Chromium:

```bash
amazon login --from-browser arc
```

Lê o banco de cookies do navegador, decifrando com a chave que o macOS guarda no
Keychain — o sistema pede sua permissão uma vez. Nenhuma senha é armazenada.

Ressalva: a sessão passa a ser **compartilhada** com aquele navegador. Se a
Amazon rotacionar um cookie de um lado, o outro pode expirar; basta importar de
novo.

## Quando algo dá errado

| Sintoma | O que fazer |
|---|---|
| "Nenhuma sessão salva" | `amazon login` |
| Login não conclui e o terminal fica esperando | A sessão pode estar sem os cookies de autenticação; a ferramenta imprime os nomes que encontrou. Feche e rode de novo |
| Verificação anti-bot | Abra a Amazon no seu navegador, resolva, e espere o bloqueio de 30 minutos passar |
| Chrome não abre | Instale o Google Chrome, ou `bunx playwright install chromium` e `AMAZON_BROWSER_CHANNEL=chromium` |

## Ciclo de vida

A sessão dura semanas enquanto for reusada da mesma máquina. O Chrome renova os
cookies sozinho, e o transporte grava a renovação de volta em `session.enc`
sempre que algum valor muda — é isso que mantém a sessão viva sem novo login.

**Não rode `login` e `sync` ao mesmo tempo**: os dois usam o mesmo perfil do
Chrome.
