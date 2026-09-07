# Segurança

## O modelo de ameaça

O jar de cookies é a conta inteira. Quem o tiver entra sem senha e sem segundo
fator. O mesmo vale para `browser-profile/`, o perfil do Chrome, que guarda a
sessão logada em claro. Todo o resto deste documento decorre disso.

| Proteção | Como |
| --- | --- |
| Sessão em repouso | AES-256-GCM, arquivo `0600`, escrita atômica. A chave vem do ambiente ou de um `session.key` `0600` |
| Sessão em log | Todo valor de cookie é redigido em toda linha de log, por um provedor que acompanha as renovações. Headers nunca são logados |
| Sessão em resposta de tool | `auth_status` devolve contagens e validade, nunca um valor de cookie |
| Cache | `cache.db` `0600`, com o `umask` forçado na criação. Contém endereço e histórico de consumo |
| Escrita em disco | Só `export` e `download_invoice`, e só dentro de `AMAZON_EXPORT_DIR`. O nome do arquivo é higienizado e o caminho resolvido é conferido contra o diretório |
| Escrita na conta | Não existe. Nenhuma tool submete formulário nem clica em botão |
| Superfície de leitura | `raw_get` só aceita uma allowlist de caminhos de pedidos (`/your-orders/`, `/gp/css/`, `/your-returns`, `/pay/history`); qualquer outro é recusado, `..` incluído |
| Link de nota fiscal | A URL da NF-e é pré-assinada e expira em cerca de 3 minutos: é tratada como credencial, buscada na hora e nunca devolvida por `get_invoice` nem gravada em log |
| Anti-bot | Uma página por vez, com intervalo. Um desafio trava o cliente e grava um cooldown de 30 minutos que sobrevive ao processo, para que um agente reiniciando não aprofunde o bloqueio |
| Fixtures | Anonimização determinística com leak guard, mais uma varredura independente que procura os valores reais das capturas dentro de `test/fixtures/` |

Relatos que contornem qualquer uma dessas proteções são especialmente
bem-vindos.

## Nunca faça

- Não cole `session.enc`, `session.key`, `cache.db`, `browser-profile/` nem um
  header `Cookie` numa issue, num log ou num prompt.
- Não commite nada de `task/`. É onde ficam as capturas cruas e o salt.
- Não rode este projeto contra a conta de outra pessoa.
- Não reduza `AMAZON_MIN_INTERVAL_MS` a zero. O ritmo é o que evita o bloqueio.

## Revogando uma sessão

```sh
rm ~/.config/amazon-mcp/session.enc
rm -rf ~/.config/amazon-mcp/browser-profile
```

Isso apaga a cópia local. Para invalidar do lado da Amazon, saia da conta em
todos os dispositivos nas configurações de segurança do site.

## Reportando

Não abra uma issue pública para uma vulnerabilidade. Reporte por
[GitHub Security Advisories](https://github.com/maxwellmezadre/amazon-mcp/security/advisories/new).
