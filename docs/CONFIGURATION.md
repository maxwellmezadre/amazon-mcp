# Configuração

Tudo vem do ambiente, com o prefixo `AMAZON_`. Nenhum arquivo `.env` é lido.
Um valor inválido não é ignorado em silêncio: o processo falha listando todos
os problemas de uma vez. Nada é obrigatório; sem sessão, os comandos falham na
hora da chamada com uma mensagem que diz o que fazer, não no boot.

## Variáveis

| Variável | Default | Descrição |
| --- | --- | --- |
| `AMAZON_CONFIG_DIR` | `~/.config/amazon-mcp` | Raiz de tudo que é persistido |
| `AMAZON_SESSION_KEY` | gerada em `session.key` | Chave AES em base64 de 32 bytes (`openssl rand -base64 32`) |
| `AMAZON_EXPORT_DIR` | `~/Downloads/amazon-export` | Único diretório onde `export` e `download_invoice` podem escrever |
| `AMAZON_READ_ONLY` | `0` | `1` não registra `login`, `sync`, `download_invoice` e `export` |
| `AMAZON_COMPACT` | `0` | `1` faz as tools devolverem só o essencial por padrão |
| `AMAZON_BROWSER_CHANNEL` | `chrome` | `chrome`, `chromium` ou `msedge` |
| `AMAZON_IMPORT_BROWSER` | unset | `arc`, `chrome`, `chromium`, `brave` ou `edge`: `login` importa a sessão deste navegador (macOS) |
| `AMAZON_HEADLESS` | `1` | `0` abre a janela do navegador nas leituras (depuração, bloqueio) |
| `AMAZON_MIN_INTERVAL_MS` | `2000` | Intervalo mínimo entre páginas |
| `AMAZON_JITTER_MS` | `2000` | Variação aleatória somada ao intervalo |
| `AMAZON_PAGE_TIMEOUT_MS` | `45000` | Tempo máximo de navegação de uma página |
| `AMAZON_CSD_TIMEOUT_MS` | `20000` | Espera pela descriptografia da página |
| `AMAZON_LOCALE` | `pt-BR` | Idioma do navegador |
| `AMAZON_TIMEZONE` | `America/Sao_Paulo` | Fuso do navegador |
| `AMAZON_BASE_URL` | `https://www.amazon.com.br` | Host (útil em testes) |
| `AMAZON_LOG_FILE` | unset | Espelha o log (que já vai para stderr) num arquivo |
| `AMAZON_LIVE` | unset | `1` destrava o teste de integração contra a conta real |

Idioma e fuso precisam ser os mesmos do login: mudam o formato de data e de
moeda nas páginas, e uma impressão digital que oscila entre execuções é um
sinal clássico de robô.

## Arquivos em disco

Todos derivados de `AMAZON_CONFIG_DIR`, com o diretório em `0700`:

| Caminho | O que é |
| --- | --- |
| `session.enc` | Cookies cifrados com AES-256-GCM, `0600` |
| `session.key` | Chave gerada, `0600`, quando não há `AMAZON_SESSION_KEY` |
| `cache.db` | SQLite com os pedidos, `0600` (mais `-wal` e `-shm`) |
| `browser-profile/` | Perfil do Chrome, compartilhado por `login` e pelas leituras |

Não rode `login` e `sync` ao mesmo tempo: os dois usam esse perfil.

## Registro no Claude Code

`bun run setup` registra o servidor no escopo de usuário com o caminho
absoluto do binário. À mão:

```sh
# escopo de usuário (vale em todo projeto)
claude mcp add -s user amazon -- ~/.local/bin/amazon mcp

# variante somente leitura, para um agente menos confiável
claude mcp add -s user amazon --env AMAZON_READ_ONLY=1 -- ~/.local/bin/amazon mcp
```

Outros clientes que leem `mcpServers` (Claude Desktop, por exemplo):

```json
{
  "mcpServers": {
    "amazon": {
      "type": "stdio",
      "command": "/Users/voce/.local/bin/amazon",
      "args": ["mcp"],
      "env": { "AMAZON_IMPORT_BROWSER": "chrome" }
    }
  }
}
```

Use o caminho absoluto: clientes MCP não herdam o `PATH` do shell.

## Ritmo e anti-bot

O padrão é de 2 a 4 segundos por página, sempre uma de cada vez, mesmo com
chamadas concorrentes. Falhas transitórias (navegação, timeout, uma
descriptografia que não rodou) recebem backoff exponencial, no máximo três
tentativas. Se a Amazon apresentar um desafio anti-bot, o cliente para e grava
um bloqueio de 30 minutos no próprio cache, de modo que nem um processo novo
consegue insistir. `amazon status` mostra o `cooldownUntil`.
