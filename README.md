<div align="center">
  <img src="./images/10router.png?1" alt="10router Dashboard" width="800"/>
</div>

# 10router

A local AI routing gateway with a web dashboard. It exposes one OpenAI-compatible
endpoint and routes requests across 40+ upstream providers, translating between
API formats and falling back across models and accounts.

[![npm](https://img.shields.io/npm/v/10router.svg)](https://www.npmjs.com/package/10router)
[![Docker Pulls](https://img.shields.io/docker/pulls/some-du6e/10router.svg?logo=docker&label=Docker%20pulls)](https://hub.docker.com/r/some-du6e/10router)
[![License](https://img.shields.io/npm/l/10router.svg)](https://github.com/some-du6e/10router/blob/main/LICENSE)

_A fork of [decolua/9router](https://github.com/decolua/9router), rebranded as 10router._

## What it does

- **One endpoint** — point any OpenAI-compatible client at `http://localhost:20128/v1`.
- **Format translation** — OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex ↔ Antigravity ↔ Ollama ↔ OpenAI Responses.
- **Combo fallback** — define an ordered list of models; the router advances on quota exhaustion or error.
- **Multi-account** — several accounts per provider, round-robin or priority.
- **Credential management** — OAuth (PKCE) and API keys, with automatic token refresh.
- **Quota and usage tracking** — per provider and model, with reset countdowns.
- **Token savers** — optional request/response compression (see below).
- **Deployment** — localhost, VPS, Docker, or Cloudflare Workers.

## Request flow

```
client (Claude Code, Codex, Cursor, Cline, …)
  → http://localhost:20128/v1
  → 10router: token savers → format translation → account selection
  → upstream provider
  → SSE back to client
```

## Install

```bash
npm install -g 10router
10router
```

Dashboard: `http://localhost:20128/dashboard`. API: `http://localhost:20128/v1`.

### From source

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

Production:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

## Client configuration

```
Endpoint: http://localhost:20128/v1
API Key:  [generate in the dashboard]
Model:    <provider-prefix>/<model>   e.g. cc/claude-opus-4-7
```

### Cursor

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from dashboard]
  Model: cc/claude-opus-4-7
```

### Claude Code

`~/.claude/config.json`:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-10router-api-key"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-10router-api-key"
```

### OpenClaw

Dashboard → CLI Tools → OpenClaw → select model → Apply. Or edit `~/.openclaw/openclaw.json`:

```json
{
  "agents": { "defaults": { "model": { "primary": "10router/kr/claude-sonnet-4.5" } } },
  "models": {
    "providers": {
      "10router": {
        "baseUrl": "http://127.0.0.1:20128/v1",
        "apiKey": "sk_10router",
        "api": "openai-completions",
        "models": [{ "id": "kr/claude-sonnet-4.5", "name": "Claude Sonnet 4.5" }]
      }
    }
  }
}
```

OpenClaw only talks to a local 10router. Use `127.0.0.1`, not `localhost` — `localhost` can resolve to IPv6 and fail.

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [from dashboard]
```

Also works with Antigravity, Copilot, OpenCode, Droid, Roo, Kilo Code, jcode, Grok Build,
Devin CLI, DeepSeek TUI, Qwen Code, OpenDesign, and anything else that accepts a custom
OpenAI base URL.

## Providers

**OAuth:** Claude Code, Antigravity, Codex, GitHub Copilot, Cursor, Kimchi, Kiro, Vertex AI.

**API key (40+):** OpenRouter, GLM, Kimi, MiniMax, OpenAI, Anthropic, Gemini, DeepSeek,
Groq, xAI, Mistral, Perplexity, Together, Fireworks, Cerebras, Cohere, NVIDIA, SiliconFlow,
Nebius, Chutes, Hyperbolic, plus custom OpenAI/Anthropic-compatible endpoints.

**No auth:** OpenCode Free (passthrough proxy, models auto-fetched from `opencode.ai/zen/v1/models`).

Discontinued upstream and no longer usable: iFlow free tier (2026), Qwen Code OAuth free
tier (2026-04-15), Gemini CLI (shut down 2026-06-18).

### Self-hosted providers

For speech and embeddings served from your own machine — whisper.cpp, faster-whisper,
Speaches, Kokoro-FastAPI, openedai-speech, llama.cpp/llama-server, vLLM, Infinity,
text-embeddings-inference, or anything speaking the OpenAI shape.

| Provider | Endpoint used | Typical server |
| --- | --- | --- |
| **Self-hosted STT** | `/v1/audio/transcriptions` | whisper.cpp, faster-whisper |
| **Self-hosted TTS** | `/v1/audio/speech` | Kokoro-FastAPI, openedai-speech |
| **Self-hosted Embedding** | `/v1/embeddings` | llama-server, vLLM, Infinity |

Every other speech provider is a named cloud service with a fixed endpoint. These three
read their address from **each connection**, so one provider can front several machines
and load-balance across them.

Set it on the connection as `providerSpecificData.baseUrl`:

| Provider | Give it | Result |
| --- | --- | --- |
| Self-hosted STT | the full URL — `http://host:8080/v1/audio/transcriptions` | used as-is |
| Self-hosted TTS | the server root — `http://host:8880` | `+ /v1/audio/speech` |
| Self-hosted Embedding | the **OpenAI base**, `/v1` included — `http://host:8080/v1` | `+ /embeddings` |

> **Mind the `/v1` on embeddings.** The adapter appends `/embeddings`, so
> `http://host:8080` resolves to `http://host:8080/embeddings` and misses the OpenAI
> route — llama-server answers **501**. Give it the same base URL an OpenAI client would
> use. A full `.../v1/embeddings` is also accepted.

The API key is not checked by most local servers, but the field must be non-empty: it is
what gives the connection a credentials record, and `baseUrl` lives there. Any placeholder
works.

Self-hosted Embedding has **no cloud fallback by design** — a connection saved without a
`baseUrl` is reported as a configuration error rather than quietly falling back to
`api.openai.com`, which would send your input text and API key to a third party under a
provider named "Self-hosted".

## Token savers

Set the header `X-10Router-Token-Saver: off` to bypass all of them for one request. The
pre-rebrand `X-9Router-Token-Saver` is still accepted for existing clients; if both are
present, the `10Router` one wins.

### RTK (built in, default on)

Compresses `tool_result` content in place before the request reaches the LLM.

- Filters: `git-diff`, `git-status`, `grep`, `find`, `ls`, `tree`, `dedup-log`,
  `smart-truncate`, `read-numbered`, `search-list`.
- Auto-detect: peeks the first 1KB of each `tool_result` and picks a filter. No config.
- Fail-open: if a filter throws or makes output larger, the original text is kept.
- Runs before format translation, so it applies to every client format.
- Toggle in Dashboard → Endpoint settings.

Ported from [rtk-ai/rtk](https://github.com/rtk-ai/rtk).

### Headroom (external, optional)

Calls a local Headroom `/v1/compress` endpoint before routing:

```
client → 10router → Headroom /v1/compress → 10router → provider
```

```bash
pip install "headroom-ai[proxy]"
headroom proxy --port 8787
```

Enable in Dashboard → Endpoint → Token Saver → Headroom. Default URL
`http://localhost:8787`; in Docker use `http://headroom:8787` (same network) or
`http://host.docker.internal:8787` (host). Fails open if Headroom is down.

### Caveman

Injects a terse-output system prompt. Adapted from
[JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman).

### Ponytail

Injects a "lazy senior dev" system prompt biasing toward minimal, YAGNI-first code —
deletion over addition, stdlib over new deps, one-liners over abstractions. Three levels:

- **Lite** — build what's asked, name the lazier alternative.
- **Full** — YAGNI ladder: stdlib → native → existing deps → one-liner → minimal code.
- **Ultra** — deletion first, ship the one-liner, challenge the rest of the requirement.

Never trades away input validation, error handling that prevents data loss, security,
accessibility, or anything explicitly requested. Adapted from
[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail).

## Combos

A combo is a named, ordered list of models. The router tries them in order, advancing when
a model errors or its quota is exhausted.

```
Dashboard → Combos → Create New

Name: premium-coding
  1. cc/claude-opus-4-7
  2. glm/glm-5.1
  3. minimax/MiniMax-M2.7
```

Use the combo name in place of a model id in your client.

## Cost display

The "cost" in Usage Analytics is an estimate of what the same traffic would have cost on
paid APIs directly. It is a tracking figure, not a bill — 10router has no billing system.
You pay providers directly, if at all.

## Cloud sync

Syncs providers, combos, and settings across devices. In production, prefer the
server-side variables:

- `BASE_URL` — internal callback URL used by the sync scheduler.
- `CLOUD_URL` — cloud sync endpoint base.

`NEXT_PUBLIC_BASE_URL` and `NEXT_PUBLIC_CLOUD_URL` still work for compatibility and the UI,
but the server runtime prioritizes `BASE_URL`/`CLOUD_URL`. Sync requests time out and fail
fast so the UI doesn't hang when cloud DNS or network is unavailable.

## Deployment

### VPS

```bash
git clone https://github.com/some-du6e/10router.git
cd 10router
npm install
npm run build

export JWT_SECRET="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"
export DATA_DIR="/var/lib/10router"
export PORT="20128"
export HOSTNAME="0.0.0.0"
export NODE_ENV="production"
export NEXT_PUBLIC_BASE_URL="http://localhost:20128"
export API_KEY_SECRET="endpoint-proxy-api-key-secret"
export MACHINE_ID_SALT="endpoint-proxy-salt"

npm run start
```

With PM2:

```bash
npm install -g pm2
pm2 start npm --name 10router -- start
pm2 save
pm2 startup
```

### Docker

Published multi-platform images (`linux/amd64` + `linux/arm64`):

- Docker Hub: [`some-du6e/10router`](https://hub.docker.com/r/some-du6e/10router)
- GHCR: [`ghcr.io/some-du6e/10router`](https://github.com/some-du6e/10router/pkgs/container/10router)

```bash
docker run -d \
  --name 10router \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  some-du6e/10router:latest
```

Build from source:

```bash
git clone https://github.com/some-du6e/10router.git
cd 10router/app
docker build -t 10router .
docker run -d --name 10router -p 20128:20128 \
  -v "$HOME/.9router:/app/data" -e DATA_DIR=/app/data 10router
```

Container defaults: `PORT=20128`, `HOSTNAME=0.0.0.0`.

Data persists at `$HOME/.9router/db/data.sqlite` on the host (the `.9router` directory name
is retained for compatibility with existing installs) ↔ `/app/data/db/data.sqlite` in the
container.

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `JWT_SECRET` | Auto-generated (`~/.9router/jwt-secret`) | JWT signing secret for the dashboard auth cookie (override to share across instances) |
| `INITIAL_PASSWORD` | `123456` | First login password when no saved hash exists — override this |
| `DATA_DIR` | `~/.9router` | App data location (SQLite at `$DATA_DIR/db/data.sqlite`); the `.9router` name is kept for compatibility |
| `PORT` | framework default | Service port (`20128` in examples) |
| `HOSTNAME` | framework default | Bind host (Docker defaults to `0.0.0.0`) |
| `NODE_ENV` | runtime default | Set `production` for deploy |
| `BASE_URL` | `http://localhost:20128` | Server-side internal base URL used by cloud sync jobs |
| `CLOUD_URL` | `https://9router.com` | Server-side cloud sync endpoint base URL |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | Backward-compatible/public base URL (prefer `BASE_URL`) |
| `NEXT_PUBLIC_CLOUD_URL` | `https://9router.com` | Backward-compatible/public cloud URL (prefer `CLOUD_URL`) |
| `API_KEY_SECRET` | `endpoint-proxy-api-key-secret` | HMAC secret for generated API keys |
| `MACHINE_ID_SALT` | `endpoint-proxy-salt` | Salt for stable machine ID hashing |
| `ENABLE_REQUEST_LOGS` | `false` | Enables request/response logs under `logs/` |
| `AUTH_COOKIE_SECURE` | `false` | Force `Secure` auth cookie (set `true` behind an HTTPS reverse proxy) |
| `REQUIRE_API_KEY` | `false` | Enforce Bearer API key on `/v1/*` (recommended for internet-exposed deploys) |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | empty | Outbound proxy for upstream provider calls |
| `SEARXNG_URL` | `http://localhost:8888/search` | Endpoint for the built-in unauthenticated SearXNG web-search provider |

Notes:

- Lowercase proxy variables also work: `http_proxy`, `https_proxy`, `all_proxy`, `no_proxy`.
- `.env` is not baked into the Docker image (`.dockerignore`) — inject runtime config with
  `--env-file` or `-e`.
- On Windows, `APPDATA` can be used for local storage path resolution.
- `INSTANCE_NAME` appears in older docs and env templates but is not used at runtime.

### Runtime files

- App state: `${DATA_DIR}/db/data.sqlite` (providers, combos, aliases, keys, settings, usage history)
- Auto backups: `${DATA_DIR}/db/backups/`
- Request/translator logs: `<repo>/logs/...` when `ENABLE_REQUEST_LOGS=true`
- In Docker, `${DATA_DIR}` and `~/.9router` resolve to the same location — the symlink
  `/root/.9router -> /app/data` is created at build time.

## Models

<details>
<summary><b>Model ids by provider prefix</b></summary>

**Claude Code (`cc/`)**

- `cc/claude-opus-4-7`
- `cc/claude-opus-4-6`
- `cc/claude-sonnet-4-6`
- `cc/claude-sonnet-4-5-20250929`
- `cc/claude-haiku-4-5-20251001`

**Codex (`cx/`)**

- `cx/gpt-5.5`
- `cx/gpt-5.4`
- `cx/gpt-5.3-codex`
- `cx/gpt-5.2-codex`
- `cx/gpt-5.1-codex-max`

**GitHub Copilot (`gh/`)**

- `gh/gpt-5.4`
- `gh/claude-opus-4.7`
- `gh/claude-sonnet-4.6`
- `gh/gemini-3.1-pro-preview`
- `gh/grok-code-fast-1`

**Cursor (`cu/`)**

- `cu/claude-4.6-opus-max`
- `cu/claude-4.5-sonnet-thinking`
- `cu/gpt-5.3-codex`
- `cu/kimi-k2.5`

**GLM (`glm/`)**

- `glm/glm-5.1`
- `glm/glm-5`
- `glm/glm-4.7`

**MiniMax (`minimax/`)**

- `minimax/MiniMax-M2.7`
- `minimax/MiniMax-M2.5`

**Kimi (`kimi/`)**

- `kimi/kimi-k2.5`
- `kimi/kimi-k2.5-thinking`

**Kiro (`kr/`)**

- `kr/claude-sonnet-4.5`
- `kr/claude-haiku-4.5`
- `kr/glm-5`
- `kr/MiniMax-M2.5`
- `kr/qwen3-coder-next`
- `kr/deepseek-3.2`

**OpenCode (`oc/`)**

- Auto-fetched from `opencode.ai/zen/v1/models`

**Vertex AI (`vertex/`)**

- `vertex/gemini-3.1-pro-preview`
- `vertex/gemini-3-flash-preview`
- `vertex/gemini-2.5-flash`
- `vertex-partner/glm-5-maas`
- `vertex-partner/deepseek-v3.2-maas`
- `vertex-partner/qwen3-next-80b-a3b-thinking-maas`

</details>

## API

### Chat completions

```bash
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer your-api-key
Content-Type: application/json

{
  "model": "cc/claude-opus-4-6",
  "messages": [{"role": "user", "content": "Write a function to..."}],
  "stream": true
}
```

### List models

```bash
GET http://localhost:20128/v1/models
Authorization: Bearer your-api-key
```

Returns all models and combos in OpenAI format.

## Troubleshooting

**"Language model did not provide messages"** — provider quota exhausted. Check the
dashboard quota tracker; add a combo fallback.

**Rate limiting** — subscription quota out. Add a combo, e.g.
`cc/claude-opus-4-7 → glm/glm-5.1 → kr/claude-sonnet-4.5`.

**OAuth token expired** — refreshed automatically. If it persists: Dashboard → Provider → Reconnect.

**Dashboard opens on the wrong port** — set `PORT=20128` and
`NEXT_PUBLIC_BASE_URL=http://localhost:20128`.

**First login fails** — check `INITIAL_PASSWORD` in `.env`; the fallback is `123456`.

**No logs under `logs/`** — set `ENABLE_REQUEST_LOGS=true`.

## Tech stack

- Node.js 20+
- Next.js 16, React 19, Tailwind CSS 4
- SQLite (`bun:sqlite` → `better-sqlite3` → `node:sqlite` → `sql.js` fallback chain)
- Server-Sent Events
- OAuth 2.0 (PKCE) + JWT + API keys

## Acknowledgments

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** — the original Go
  implementation this JavaScript port was based on.
- **[RTK](https://github.com/rtk-ai/rtk)** — Rust token saver; its compression pipeline is
  ported to JS here.
- **[Caveman](https://github.com/JuliusBrussee/caveman)** by
  [@JuliusBrussee](https://github.com/JuliusBrussee) — terse-output prompt.
- **[Ponytail](https://github.com/DietrichGebert/ponytail)** by
  [@DietrichGebert](https://github.com/DietrichGebert) — YAGNI-first prompt.

## License

MIT — see [LICENSE](LICENSE).
