# Configuração

Tudo vem do ambiente, com o prefixo `AMAZON_`. Nenhum arquivo `.env` é lido.
Um valor inválido não é ignorado em silêncio: o processo falha listando **todos**
os problemas de uma vez.

| Variável | Default | Descrição |
|---|---|---|
| `AMAZON_CONFIG_DIR` | `~/.config/amazon-mcp` | Raiz de tudo que é persistido |
| `AMAZON_EXPORT_DIR` | `~/Downloads/amazon-export` | Único diretório onde `export` e `download_invoice` podem escrever |
| `AMAZON_SESSION_KEY` | — | Chave AES em base64 de 32 bytes. Sem ela, uma chave é gerada em `session.key` |
| `AMAZON_READ_ONLY` | `0` | `1` não registra `login`, `sync`, `download_invoice` e `export` |
| `AMAZON_COMPACT` | `0` | `1` faz as tools devolverem só o essencial |
| `AMAZON_LOG_FILE` | — | Espelha o log (que já vai para stderr) num arquivo |
| `AMAZON_HEADLESS` | `1` | `0` abre a janela do navegador nas leituras |
| `AMAZON_BROWSER_CHANNEL` | `chrome` | `chrome`, `chromium` ou `msedge` |
| `AMAZON_IMPORT_BROWSER` | — | Importa a sessão deste navegador (macOS) |
| `AMAZON_MIN_INTERVAL_MS` | `2000` | Intervalo mínimo entre páginas |
| `AMAZON_JITTER_MS` | `2000` | Variação aleatória somada ao intervalo |
| `AMAZON_PAGE_TIMEOUT_MS` | `45000` | Tempo máximo de navegação |
| `AMAZON_CSD_TIMEOUT_MS` | `20000` | Espera pela descriptografia da página |
| `AMAZON_LOCALE` | `pt-BR` | Idioma do navegador |
| `AMAZON_TIMEZONE` | `America/Sao_Paulo` | Fuso do navegador |
| `AMAZON_BASE_URL` | `https://www.amazon.com.br` | Host (útil em testes) |
| `AMAZON_LIVE` | — | `1` destrava os testes de integração |

## Arquivos

Todos derivados de `AMAZON_CONFIG_DIR`, com o diretório em `0700`:

| Caminho | O que é |
|---|---|
| `session.enc` | Cookies cifrados com AES-256-GCM, `0600` |
| `session.key` | Chave gerada, `0600`, quando não há `AMAZON_SESSION_KEY` |
| `cache.db` | SQLite com os pedidos, `0600` (mais `-wal` e `-shm`) |
| `browser-profile/` | Perfil do Chrome, compartilhado por `login` e pelas leituras |

**Não rode `login` e `sync` ao mesmo tempo**: os dois usam esse perfil.

## Ritmo e bloqueio

O padrão é de 2 a 4 segundos por página, sempre uma de cada vez. Se a Amazon
apresentar um desafio anti-bot, o cliente para e grava um bloqueio de 30 minutos
no próprio cache, de modo que nem um processo novo consegue insistir.

## Segurança

`session.enc` e `browser-profile/` equivalem à conta inteira, incluindo o cookie
`csd-key`. O `cache.db` guarda endereço, últimos quatro dígitos do cartão e todo
o histórico. Nunca cole esses arquivos em uma issue.
