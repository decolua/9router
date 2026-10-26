<div align="center">
  <img src="./images/9router.png?1" alt="9Router Dashboard" width="800"/>
  
  # 9Router - FREE AI Router & Token Saver
  
  **Never stop coding. Save 20-40% tokens with RTK + auto-fallback to FREE & cheap AI models.**
  
  **Connect All AI Code Tools (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) to 40+ AI Providers & 100+ Models.**
  
  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![Docker Pulls](https://img.shields.io/docker/pulls/decolua/9router.svg?logo=docker&label=Docker%20pulls)](https://hub.docker.com/r/decolua/9router)
  [![GHCR](https://img.shields.io/badge/GHCR-decolua%2F9router-blue?logo=github)](https://github.com/decolua/9router/pkgs/container/9router)
  [![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)

<a href="https://trendshift.io/repositories/22628" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22628" alt="decolua%2F9router | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[🚀 Quick Start](#-quick-start) • [💡 Features](#-key-features) • [📖 Setup](#-setup-guide) • [🌐 Website](https://9router.com)

[🇧🇷 Português (Brasil)](./i18n/README.pt-BR.md) • [🇻🇳 Tiếng Việt](./i18n/README.vi.md) • [🇨🇳 中文](./i18n/README.zh-CN.md) • [🇯🇵 日本語](./i18n/README.ja-JP.md) • [🇷🇺 Русский](./i18n/README.ru.md) • [🇹🇭 ไทย](./i18n/README.th.md) • [🇮🇷 فارسی](./i18n/README.fa_IR.md) • [🇮🇩 Indonesia](./i18n/README.id-ID.md) • [🇪🇸 Español](./i18n/README.es.md) • [🇫🇷 Français](./i18n/README.fr.md)

</div>

---

## 🧩 Federation (this fork)

**This fork adds federation** on top of upstream 9router: deploy the same gateway on
multiple instances across datacenters/hosts and keep them in sync.

- **Edge → central proxying** — edge instances proxy all `/v1/*` traffic and mutating
  dashboard API calls up to the central instance by default.
- **SQLite replication** — edges continuously track/replicate central's database, so a
  central outage leaves edges serving independently; writes during an outage are queued
  locally and reconciled later (eventual consistency).
- **One frontend per host** — each instance serves its own `/dashboard`, backed by its
  local replica or central.
- **Standalone stays the default** — all federation behavior is inert unless
  `FEDERATION_MODE` is set (zero behavior change out of the box).

Enable it with the `FEDERATION_*` environment variables (see the Federation block
in `.env.example`, search `FEDERATION_`): set `FEDERATION_MODE=central` on the
central instance, and `FEDERATION_MODE=edge` with `FEDERATION_CENTRAL_URL` +
`FEDERATION_TOKEN` on edges.

Full design & config reference: [docs/federation-spec.md](docs/federation-spec.md).

## 🤔 Why 9Router?

**Stop wasting money, tokens and hitting limits:**

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls...) burn tokens fast
- ❌ Expensive APIs ($20-50/month per provider)
- ❌ Manual switching between providers

**9Router solves this:**

- ✅ **RTK Token Saver** - Auto-compress tool_result content, save 20-40% tokens per request
- ✅ **Maximize subscriptions** - Track quota, use every bit before reset
- ✅ **Auto fallback** - Subscription → Cheap → Free, zero downtime
- ✅ **Multi-account** - Round-robin or fill-first, configurable per provider
- ✅ **Universal** - Works with Claude Code, Codex, Cursor, Cline, any CLI tool

---

## 🔄 How It Works

```
┌─────────────┐
│  Your CLI   │  (Claude Code, Codex, OpenClaw, Cursor, Cline...)
│   Tool      │
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌─────────────────────────────────────────────┐
│           9Router (Smart Router)            │
│  • RTK Token Saver (cut tool_result tokens) │
│  • Format translation (OpenAI ↔ Claude)     │
│  • Quota tracking                           │
│  • Auto token refresh                       │
└──────┬──────────────────────────────────────┘
       │
       ├─→ [Tier 1: SUBSCRIPTION] Claude Code, Codex, GitHub Copilot
       │   ↓ quota exhausted
       ├─→ [Tier 2: CHEAP] GLM ($0.6/1M), MiniMax ($0.2/1M)
       │   ↓ budget limit
       └─→ [Tier 3: FREE] Kiro, OpenCode Free, Vertex ($300 credits)

Result: Never stop coding, minimal cost + 20-40% token savings via RTK
```

---

## ⚡ Quick Start

**1. Install globally — upstream build only (no federation):**

> ⚠️ **Prerequisite: Node.js ≥ 22.19.0** (a current 22.x LTS) is required before
> running `npm`. The floor is not cosmetic: the app loads `undici` 8, whose
> decompression table is built at module load from `zlib.createZstdDecompress`
> (Node ≥ 22.15), so an older runtime (Node 20.x, or 22.14) aborts
> `npm run build` during page-data collection with
> `TypeError: Cannot read properties of undefined (reading 'bind')` and names no
> cause. `npm run build` now preflights the version and prints the requirement
> instead. On fresh bunker/SSH-only boxes the OS image ships `git` + `docker` but
> **not** `node` or `npm`. Rescue path — download the Node tarball, extract into
> `$HOME` and prepend it to your `PATH`:
>
> ```bash
> # Example (adjust ARCH=x64 or arm64; any 22.x >= 22.19.0 works):
> curl -fsSL https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.xz \
>   | tar -xJ -C $HOME
> export PATH=$HOME/node-v22.23.4-linux-x64/bin:$PATH
> node -v && npm -v  # must print v22.19.0 or newer
> ```
>
> After the toolchain is in place, continue below.

```bash
npm install -g 9router
9router
```

> ⚠️ **Upstream-only:** `npm install -g 9router` installs the published npm
> package — the **upstream** build, which does **not** include this fork's
> federation feature. For federation (edge → central proxying, SQLite
> replication, failover), install this fork from source — see **Run from
> source (this fork)** below.

🎉 Dashboard opens at `http://localhost:20128`

> First boot takes 10–30s (Next.js standalone server startup). If the browser
> shows "connection refused" right after launch, wait a few seconds and retry.

**2. Connect a FREE provider (no signup needed):**

Dashboard → Providers → Connect **Kiro AI** (~50 credits/month free: Claude 4.5 + GLM-5 + MiniMax) or **OpenCode Free** (no auth) → Done!

**3. Use in your CLI tool:**

```
Claude Code/Codex/OpenClaw/Cursor/Cline Settings:
  Endpoint: http://localhost:20128/v1
  API Key: [copy from dashboard]
  Model: kr/claude-sonnet-4.5
```

**That's it!** Start coding with FREE AI models.

> Per-tool setup guides (Claude Code, Cursor, and more):
> [docs/integrations/](docs/integrations/README.md) · API reference:
> [docs/api-reference.md](docs/api-reference.md)

**Run from source (this fork — federation included):**

This fork's package is private (`9router-app`), so source/Docker execution is
the way to run it — and the only way to get the federation feature (the npm
package is upstream-only). The federation work lives on the `federation`
branch (default `master` mirrors upstream):

```bash
git clone https://github.com/totalwindupflightsystems/9router.git
cd 9router
git checkout federation
cp .env.example .env
npm ci   # reproducible install from the tracked package-lock.json (`npm install` also works)
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

> Node.js **≥ 22.19.0** is required for the source path too — `npm run build`
> now preflights it (`scripts/check-node-version.mjs`) and prints the required
> version instead of failing later with the `reading 'bind'` error. See the
> Quick Start prerequisite above for the no-root toolchain recipe.

Restart the server after adding a provider connection — running config is loaded at boot.

> Note (removing an install): stop the dev server first (`pkill next-server` or
> Ctrl-C in its terminal) before deleting the directory. The `bunkerd destroy`
> gate refuses to remove an install with live processes running and names them
> in the error — this is intentional protection, not a failure.

> ⚠️ In a copied or relocated tree `npm run dev` can fail before the server
> starts, with Turbopack complaining `Symlink [project]/node_modules/... points
> out of the filesystem root`. `package.json` already carries the escape hatch:
> `npm run dev:webpack` runs the same dev server on webpack instead of Turbopack
> and is unaffected —
> `PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev:webpack`.

No `DATA_DIR` override is needed: `.env.example` leaves `DATA_DIR` unset, so the
app stores everything under the per-user default `~/.9router` (SQLite at
`~/.9router/db/data.sqlite`; Windows: `%APPDATA%\9router`) — a directory your own
user can always create. To keep data elsewhere, set `DATA_DIR` to a path your user
can create and write (as an env var or a `.env` line); the app fails fast at boot
if it cannot create or write it. Docker is unaffected — compose sets the
container's `DATA_DIR=/app/data`.

### CLI launcher from this fork

`npm install -g 9router` installs the published upstream package. To build and
run this fork's CLI launcher from a source checkout, use the source entrypoint
`cli/cli.js` after packing it. No `DATA_DIR` override is needed — the pack step
resolves the same per-user default (`~/.9router`) as the server, because
`.env.example` no longer points `DATA_DIR` at a system-owned directory:

```bash
npm --prefix cli install   # one-time: CLI build deps (esbuild)
npm run cli:pack
node cli/cli.js --skip-update --no-browser
```

(If your own `.env` sets a `DATA_DIR` the current user cannot write, the pack step
fails fast with the DATA_DIR error — point it at a writable path, or unset it, and
re-run.)

**Port precedence.** The launcher reads the port from, in order: the explicit
`--port/-p` flag, then the `PORT` env var, then the default `20128`. The launcher
does not read `.env` — only the process environment. On a host that already runs
9router on the default port, the quick-start command above therefore needs a port
override, and both spellings work (the launcher refuses an occupied port with an
`EADDRINUSE` message and a non-zero exit rather than starting a doomed child):

```bash
PORT=20129 node cli/cli.js --skip-update --no-browser   # env fallback
node cli/cli.js --skip-update --no-browser -p 20129     # --port overrides PORT
```

A `PORT` that is not a usable port number (empty, non-numeric, `0`, negative,
`>65535`) is ignored with a one-line warning naming the value and the port actually
used, instead of crashing or silently serving somewhere else; an unusable `--port`
argument falls back the same way (unchanged legacy behavior). The occupied-port
refusal names both remedies, and `node cli/cli.js --help` documents `PORT` under
`Environment:`.

The pack command writes `9router-<version>.tgz` at the repository root; it is a
package artifact, not the source launcher to execute. The launcher entrypoint is
`cli/cli.js` (the same file installed as the `9router` executable), not a
compiled `dist` entrypoint. See [cli/README.md](cli/README.md) for foreground,
tray, and shutdown behavior.

> ⚠️ Dev mode (`npm run dev` / `next dev`) does **not** support
> `FEDERATION_MODE=edge`: the edge proxy + DEGRADED intercept live only in
> `custom-server.js`, which the Next.js dev server never loads, so an edge
> dev boot exits FATAL with a clear message. Use the production path
> (`npm run build && npm start`) or `docker compose -p 9router-federation -f
> docker-compose.federation.yml up` to run an edge. Central/standalone dev
> is unaffected.

Production mode:

```bash
# Create Temporary Memory For Build
sudo fallocate -l 2G /swapfile_temp
sudo chmod 600 /swapfile_temp
sudo mkswap /swapfile_temp
sudo swapon /swapfile_temp

npm run build

# Clear temporary swap
sudo swapoff /swapfile_temp
sudo rm /swapfile_temp

PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

`npm run start` boots the standalone server through `custom-server.js` (the
federation-aware wrapper). Edge nodes additionally set `FEDERATION_MODE=edge`
(plus `FEDERATION_TOKEN` / `FEDERATION_CENTRAL_URL` — see
[docs/FEDERATION.md](docs/FEDERATION.md)).

**Docker (docker compose):**

```bash
cp .env.example .env   # REQUIRED before first up — the container reads its
                       # secrets (INITIAL_PASSWORD, JWT_SECRET, API_KEY_SECRET)
                       # from this file; without it the image falls back to
                       # insecure defaults
docker compose up -d
```

> **Port already in use?** `20128` is the default host port. If another
> process (or another 9router instance) holds it, move the host side:
>
> ```bash
> PORT=30128 docker compose up -d
> ```
>
> The container still listens on 20128 internally; only the host-side
> mapping changes. Update your client base URL accordingly
> (`http://localhost:30128/v1`).

> `docker-compose.yml` treats `.env` as optional at config time (so
> `docker compose config` validates on a fresh clone), but you still need it
> for a real deployment — set `INITIAL_PASSWORD` / `JWT_SECRET` /
> `API_KEY_SECRET` before exposing the instance. The optional `env_file`
> syntax requires Docker Compose v2.24+.
>
> Pulling the published images fails on a clean/rootless host? Build 9router
> locally instead (base file unchanged, applied as an override):
>
> ```bash
> # 9router from this checkout; headroom image still pulled if needed
> docker compose -f docker-compose.yml -f docker-compose.local-build.yml up -d --build
>
> # no third-party pulls at all — headroom sidecar omitted (it is optional)
> docker compose -f docker-compose.yml -f docker-compose.local-build.yml \
>   up -d --build --no-deps 9router
> ```
>
> The fallback builds the distinct tag `9router:local` (never overwrites
> `decolua/9router:latest`); details in [DOCKER.md](DOCKER.md).
> Federation deployments use `docker compose -p 9router-federation -f
> docker-compose.federation.yml up` instead (see
> [docs/FEDERATION.md](docs/FEDERATION.md)).

Default URLs:

- Dashboard: `http://localhost:20128/dashboard`
- OpenAI-compatible API: `http://localhost:20128/v1`

### Credential-free headless bring-up (no dashboard)

Every `POST /api/providers` needs a credential — except for `ollama-local`.
Verified in source AND live against a fresh instance (2026-09-17):

- `src/app/api/providers/route.js:119` — `if (!apiKey && provider !== "ollama-local")`
  → `400 {"error":"API Key is required"}`. `ollama-local` is the single create-path
  exemption. Live control: keyless `openai` → `HTTP 400 {"error":"API Key is
  required"}`; keyless `ollama-local` → `HTTP 201` with the connection object.
- `src/app/api/providers/validate/route.js:91-92` is slightly wider — it also
  exempts providers whose registry entry declares `noAuth: true`
  (`const isNoAuth = AI_PROVIDERS[provider]?.noAuth === true;`). That exemption is
  on VALIDATION only, and it is not a key-free registration path.
- Both routes sit behind the deny-by-default `/api/*` policy
  (`src/dashboardGuard.js` `PROTECTED_API_PATHS`), so they need a session cookie or
  the on-host `x-9r-cli-token` header. Without one, both answer
  `401 {"error":"Unauthorized"}` (confirmed live). The dashboard UI is never needed.
- Passwords: with `INITIAL_PASSWORD` unset and no stored password, the built-in
  default is `123456` for a loopback session. `.env.example` ships
  `INITIAL_PASSWORD=change-me-to-a-strong-password`, which replaces that default — posting `123456` then
  answers `401 {"error":"INITIAL_PASSWORD is set — the default password (123456) is
  disabled."}` (`src/app/api/auth/login/route.js:99-106`). Send your
  `INITIAL_PASSWORD` value instead.
- Start the server the way the launcher / `npm start` does (through
  `custom-server.js`): the loopback-locality that login relies on comes from the
  per-process peer token `custom-server.js` stamps
  (`src/lib/auth/trustedPeer.js:5-6`). A bare `node .next/standalone/server.js`
  never stamps it, so every request — loopback included — looks remote, and the
  default-password login is refused with `403 {"success":false,"error":"Default
  password must be changed before remote access…","mustChangePassword":true}`
  (observed live).

```bash
# 1. Start the server on a free port (see the port precedence above)
PORT=20129 node cli/cli.js --skip-update --no-browser -t &
#    from a built tree: PORT=20129 HOSTNAME=0.0.0.0 npm start   (= custom-server.js)

# 2. Log in — the auth_token JWT cookie lands in cookies.txt
curl -s -c cookies.txt -X POST http://localhost:20129/api/auth/login \
  -H "Content-Type: application/json" -d '{"password":"123456"}'
# → 200 {"success":true,"mustChangePassword":false}   (INITIAL_PASSWORD unset —
#    send that value instead when .env sets it, e.g. "change-me-to-a-strong-password")

# 3. Register a local Ollama provider — the one provider that needs no credential
curl -s -b cookies.txt -X POST http://localhost:20129/api/providers \
  -H "Content-Type: application/json" \
  -d '{"provider":"ollama-local","name":"local-ollama"}'
# → 201 {"connection":{"id":"…","provider":"ollama-local","name":"local-ollama",…}}

# 4. Create the API key your CLI tools authenticate with
curl -s -b cookies.txt -X POST http://localhost:20129/api/keys \
  -H "Content-Type: application/json" -d '{"name":"my-tool"}'
# → 201 {"key":"sk-…","name":"my-tool","id":"…","machineId":"…"}
```

#### Restrict an API key to specific combos or models

New keys are unrestricted. To make a key usable only with named combos and/or
models, send the key `id` returned by `POST /api/keys` to the authenticated
update route:

```bash
curl -s -b cookies.txt -X PUT http://localhost:20129/api/keys/<id> \
  -H "Content-Type: application/json" \
  -d '{"access":{"restricted":true,"allow":["Main","openai/model-b"]}}'
```

`allow` entries are exact, case-insensitive combo or resolved model names. An
allowed combo authorizes the models it routes to only when the client calls the
combo; calling one of those members directly requires its own `allow` entry.
Set `{"access":{"restricted":false,"allow":[]}}` to remove the restriction.

A restricted key that requests a target outside its `allow` list receives HTTP
403 before any provider credential lookup. The OpenAI-style error has
`type` and `code` both set to `permission_error`, for example:

```json
{"error":{"message":"This API key is not allowed to use model \"openai/model-a\"","type":"permission_error","code":"permission_error"}}
```

`ollama-local` talks to `http://localhost:11434/api/chat` (the registry default), so
Ollama itself must be running for those models to answer. Every other provider needs
its own real credential in the same `POST /api/providers` call — no keyless
registration path exists for them.

#### Wiring a local OpenAI-compatible endpoint (LM Studio, Ollama `/v1`, llama.cpp…)

**A provider is two objects, not one.** A **provider node**
(`POST /api/provider-nodes`) declares *where* a compatible upstream lives — a
user-defined `prefix`, an `apiType`, and a `baseUrl`. A **provider connection**
(`POST /api/providers`) holds the *credential*. Chat traffic only works when both
exist and the connection's `provider` field is the node's `id`
(`src/app/api/providers/route.js:131-141` copies the node's `prefix` / `apiType` /
`baseUrl` onto the connection; `src/sse/services/model.js:45-49` resolves
`<prefix>/<model>` back to the node id at request time).

Two obvious routes dead-end — worth knowing before you spend time on them:

- `POST /api/providers` with `{"provider":"ollama-local","baseUrl":"http://localhost:1234/v1"}`
  answers **201** but `baseUrl` is only honored by the Ollama-native executor
  (`/api/chat`). An OpenAI-shaped upstream behind `ollama-local` answers HTTP 200
  with **0 tokens** — a silent empty success, not a protocol error. Only use
  `ollama-local` for a real Ollama server; send every OpenAI-shaped upstream
  (LM Studio, llama.cpp, vLLM, Ollama's own `/v1`) through the node flow below.
- `{"provider":"openai-compatible-chat"}` answers
  `404 {"error":"OpenAI Compatible node not found"}` — a compatible provider id
  **is** a node id, so a type or prefix alone is not a provider.

Worked example: LM Studio (or any OpenAI-shaped server) on `http://localhost:1234/v1`.

**1. Create the node** — this call stores no credential:

```bash
curl -s -X POST http://localhost:20128/api/provider-nodes \
  -H "Content-Type: application/json" \
  -d '{"name":"LM Studio Local","prefix":"lmstudio","apiType":"chat","baseUrl":"http://localhost:1234/v1","type":"openai-compatible"}'
# → 201 {"node":{"id":"openai-compatible-chat-412551d5-…","type":"openai-compatible",
#      "name":"LM Studio Local","prefix":"lmstudio","apiType":"chat",
#      "baseUrl":"http://localhost:1234/v1","createdAt":"…","updatedAt":"…"}}
```

The generated `id` is `openai-compatible-<apiType>-<uuid>` — read it out of the
response (`GET /api/provider-nodes` lists every node: `{"nodes":[…]}`). Fields the
route accepts (`src/app/api/provider-nodes/route.js:40-70`):

Two fields look alike and are easy to transpose: **`type` is the node *kind***,
**`apiType` is the *protocol* the node speaks**. Neither is derived from the other —
sending one where the other belongs is rejected, never silently repaired into a
placeholder value.

| Field | Required | Values |
| --- | --- | --- |
| `name` | yes | free text — 400 `Name is required` |
| `prefix` | yes | the model-id namespace, e.g. `lmstudio` → `lmstudio/<model>` — 400 `Prefix is required`. Must not collide with a built-in provider id/alias (`src/sse/services/model.js:12-17`). Always the caller's own string — never defaulted from `type` |
| `type` | no | the node **kind**: `openai-compatible` (default), `anthropic-compatible`, `custom-embedding`. Not the protocol — that is `apiType` |
| `apiType` | for `openai-compatible` | the **protocol**: `chat` (Chat Completions) or `responses` (Responses API). Omitted or anything else: 400 `Invalid apiType "openai" — allowed values: chat, responses (apiType is the protocol; "type" is the node kind)`. Never defaulted |
| `baseUrl` | no | defaults to `https://api.openai.com/v1`; for a local server give the OpenAI base **including `/v1`** |

**2. Add the credential connection** — `provider` is the `id` from step 1:

```bash
curl -s -X POST http://localhost:20128/api/providers \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai-compatible-chat-412551d5-…","apiKey":"lm-studio","name":"LM Studio Local"}'
# → 201 {"connection":{"id":"0db751f6-…","provider":"openai-compatible-chat-412551d5-…",
#      "authType":"apikey","name":"LM Studio Local","priority":1,"isActive":true,
#      "providerSpecificData":{"prefix":"lmstudio","apiType":"chat",
#      "baseUrl":"http://localhost:1234/v1","nodeName":"LM Studio Local",…}}}
```

`apiKey` is required here even for a server that ignores it — the connection is what
gives the provider a credentials record, and any non-empty placeholder works (only
`ollama-local` is exempt, `src/app/api/providers/route.js:119-121`). Repeat this call
with different keys to pool several connections for the same node.

**3. Verify the wiring** — with the API key your CLI tools authenticate with
(`POST /api/keys`):

```bash
curl -s http://localhost:20128/v1/models -H "Authorization: Bearer sk-…"
# → {"object":"list","data":[{"id":"lmstudio/qwen3.5-4b","owned_by":"lmstudio",…}, …]}

curl -s http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer sk-…" -H "Content-Type: application/json" \
  -d '{"model":"lmstudio/qwen3.5-4b","messages":[{"role":"user","content":"ping"}],"max_tokens":16}'
```

The node is live as soon as its models appear as `<prefix>/<model-id>`.

> ⚠️ **`No active credentials for provider: openai-compatible-chat-<uuid>` (HTTP 404).**
> The node exists but has **no credential connection** — step 1 alone is not enough.
> Re-run step 2 with `provider` set to that exact id. Note the 404 shape, not a 401:
> to the client this looks like a missing model, which is why the trap is easy to
> misread as a prefix/typo problem.

#### Account rotation: `fill-first` by default, round-robin per provider on request

With several connections on one provider, 9Router **fills the highest-priority
account first** (`fill-first`) and only moves to the next one when the first is
rate-limited, errored, or out of quota. Every connection created without an
explicit strategy behaves this way — creating a second connection does **not**
put it into rotation.

Round-robin (rotate between accounts after N calls, `stickyRoundRobinLimit`) is
a real, tested feature — it is simply **opt-in, per provider**. Pick it either
from the dashboard or with one API call; both write the same settings key.

**Where the setting lives** — one entry per provider, keyed by the provider id:

```jsonc
// settings.providerStrategies
{
  "<provider-id>": {
    "fallbackStrategy": "round-robin",   // or "fill-first"
    "stickyRoundRobinLimit": 3           // calls per account before switching (default 3)
  }
}
```

**Enable it with one call** — `<provider-id>` is the **provider / node id**
(`GET /api/providers` → `connection.provider`; for a compatible node it is the
`id` returned by `POST /api/provider-nodes`, e.g.
`openai-compatible-chat-412551d5-…` — see the LM Studio walkthrough above):

```bash
curl -s -X PATCH http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{"providerStrategies":{"<provider-id>":{"fallbackStrategy":"round-robin","stickyRoundRobinLimit":3}}}'
```

Turn it back off by setting `"fill-first"`. Note that this replaces the
`providerStrategies` object wholesale, so re-send the other providers' entries
if you have more than one override.

**From the dashboard** (verified in `src/app/(dashboard)/dashboard/`):

| Surface | Control | Source |
| --- | --- | --- |
| A provider's own page — built-in **and** OpenAI/Anthropic-compatible nodes | a `Round Robin` toggle plus a `Sticky` field, next to the connections list | `providers/[id]/page.js:1563` (toggle; reachable for compatible nodes too — gated on `isCompatible`, not on the built-in-only detail card) |
| Settings → **Routing Strategy** | the **global** `fallbackStrategy` toggle (`fill-first` ↔ `round-robin`) for every provider without an override | `profile/page.js:1460` |
| Media providers | a per-combo round-robin toggle | `media-providers/combo/[id]/page.js:87` |

A per-provider entry set from a provider page wins over the global toggle
(`src/sse/services/auth.js:139-140`).

---

## 🧪 Testing

**The suite is NOT all-green by design** — don't chase a red run as a regression.
The baseline is ~3730 pass / ~48 fail / ~95 skip (3874 total, verified 2026-10-06), with every
known-failing test catalogued in [`tests/__baseline__/known-fails.txt`](tests/__baseline__/known-fails.txt).
Live-network tests (`real/*.real.test.js`, `unit/mimo-free.live.test.js`) are **opt-in** via
`RUN_REAL=1` — a default run skips them, and they are deliberately **not** part of the baseline
because a third-party endpoint is not a deterministic property of this repo.

```bash
npm test                          # full vitest suite (runs from tests/, its own npm package)
node tests/__baseline__/verify-no-regression.mjs <vitest-results.json>
```

Run the suite with a JSON reporter to feed the regression gate:

```bash
(cd tests && ./node_modules/.bin/vitest run --reporter=json --outputFile=/tmp/vitest-results.json)
node tests/__baseline__/verify-no-regression.mjs /tmp/vitest-results.json
```

Both lines are repo-root relative and safe to paste into one shell: the subshell
returns to the repo root even though the run ends red by design (exit 1) — the
verify step is the gate.

`tests/` is its own npm package, so `cd tests && npm install` is a one-time
prerequisite before the first run — that is what puts the pinned vitest in
`tests/node_modules` (the root `npm test` entry fails fast and names this when
it is missing).

**Judge regressions with `verify-no-regression.mjs`, never a raw run.** The gate
fails only when a test that PASSED in the baseline now FAILS — new tests are
allowed, new failures are not. A raw `npm test` exit code is meaningless here
because the known-fails baseline means the suite legitimately ends red.

Notes:

- `tests/` is its own npm package — vitest must run from `tests/` (the root
  `npm test` script does this for you); running vitest from the repo root breaks
  the `@/` alias resolution.
- Lint with `npm run lint` from the repo root (full-tree eslint). Lint is **red by design**
  at ~135 errors / ~204 warnings of pre-existing debt — that debt is frozen in
  `scripts/lint-baseline.json`, so judge lint changes with `npm run lint:gate` (fails on
  NEW/INCREASED problems, on STALE baseline entries, and always on parse errors) rather than a
  raw run, and pay debt down with `npm run lint:baseline`.

---

## Video Guides

<div align="center">

<table>
  <tr>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=X69n5Lm06Yw">
        <img src="https://img.youtube.com/vi/X69n5Lm06Yw/maxresdefault.jpg" alt="Tiết kiệm chi phí LLM với 9Router" width="300"/>
      </a><br/>
      <b>🇻🇳 Tiếng Việt</b><br/>
      <sub>Tiết kiệm chi phí LLM cho OpenClaw với 9Router<br/>by <a href="https://www.youtube.com/c/M%C3%ACAIblog">Mì AI</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://youtu.be/VQAw612S27Y">
        <img src="https://img.youtube.com/vi/VQAw612S27Y/maxresdefault.jpg" alt="9Router + Claude Code FREE Unlimited Setup" width="300"/>
      </a><br/>
      <b>🇵🇰 اردو / हिन्दी</b><br/>
      <sub>9Router + Claude Code FREE Unlimited Setup<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=raEyZPg5xE0">
        <img src="https://img.youtube.com/vi/raEyZPg5xE0/maxresdefault.jpg" alt="9Router Setup Tutorial" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>9Router + Claude Code FREE Setup<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://youtu.be/3dF5GIYMrcQ?si=bAyfyiHbARJQAHj_">
        <img src="https://img.youtube.com/vi/3dF5GIYMrcQ/hqdefault.jpg" alt="9Router Setup Tutorial" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>9Router + Claude Code FREE Setup<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=o3qYCyjrFYg">
        <img src="https://img.youtube.com/vi/o3qYCyjrFYg/maxresdefault.jpg" alt="Claude Code FREE Forever" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>Claude Code FREE Forever — Unlimited Models<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=Ttpc26m39Dw">
        <img src="https://img.youtube.com/vi/Ttpc26m39Dw/maxresdefault.jpg" alt="Claude CLI Free Setup" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>Claude CLI Free Setup with 9Router 🚀<br/>by <a href="https://www.youtube.com/@CodeVerseSoban">CodeVerse Soban</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=G-5A_D5Pm6Y">
        <img src="https://img.youtube.com/vi/G-5A_D5Pm6Y/maxresdefault.jpg" alt="Cài đặt OpenClaw Free A-Z" width="300"/>
      </a><br/>
      <b>🇻🇳 Tiếng Việt</b><br/>
      <sub>Cài Đặt OpenClaw Free Từ A-Z + 9Router<br/>by <a href="https://www.youtube.com/@maigia">Mai Gia</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=JXmg8_gccgE">
        <img src="https://img.youtube.com/vi/JXmg8_gccgE/maxresdefault.jpg" alt="FREE OpenClaw with Claude Opus" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>FREE OpenClaw + Claude Opus 4.6<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=CkVZZUSTXAI">
        <img src="https://img.youtube.com/vi/CkVZZUSTXAI/mqdefault.jpg" alt="Claude CLI Free Setup" width="300"/>
      </a><br/>
      <b>🇮🇩 Indonesia</b><br/>
      <sub>Koding 24 Jam Anti Rate Limit! Hemat Token AI 65% | Tutorial Quick Setup 9Router 🚀<br/>by <a href="https://www.youtube.com/@krisswuh">Krisswuh</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=TXGv4eofe1I">
        <img src="https://img.youtube.com/vi/TXGv4eofe1I/mqdefault.jpg" alt="Cara Deploy 9Router di Hugging Face GRATIS Non-Stop! | Alternatif VPS RAM 16GB" width="300"/>
      </a><br/>
      <b>🇮🇩 Indonesia</b><br/>
      <sub>Cara Deploy 9Router di Hugging Face GRATIS Non-Stop! | Alternatif VPS RAM 16GB<br/>by <a href="https://www.youtube.com/@krisswuh">Krisswuh</a></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=GyX-DLvePW8">
        <img src="https://img.youtube.com/vi/GyX-DLvePW8/hqdefault.jpg" alt="این شکلی از هر API ای استفاده کن برای هوش مصنوعی" width="300"/>
      </a><br/>
      <b>🇮🇷 Persian-فارسی</b><br/>
      <sub dir="rtl">این شکلی از هر API ای استفاده کن برای هوش مصنوعی<br/>by <a href="https://www.youtube.com/@Matin_SenPai">Matin SenPai</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=hPusYX-5Pmw">
        <img src="https://img.youtube.com/vi/hPusYX-5Pmw/maxresdefault.jpg" alt="Hướng Dẫn Setup OpenClaw + 9Router: Tạo Bot Zalo AI Tự Động Từ A-Z" width="300"/>
      </a><br/>
      <b>🇻🇳 Tiếng Việt</b><br/>
      <sub>Hướng Dẫn Setup OpenClaw + 9Router: Tạo Bot Zalo AI Tự Động Từ A-Z<br/>by <a href="https://github.com/tuanminhhole">tuanminhhole</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=hgnE7MKi3Y4">
        <img src="https://img.youtube.com/vi/hgnE7MKi3Y4/maxresdefault.jpg" alt="Bye Limit! Cara Bikin Sistem 'AI Unlimited' 100% Gratis Dengan 9Router!
" width="300"/>
      </a><br/>
      <b>🇮🇩 Indonesia</b><br/>
      <sub>Bye Limit! Cara Bikin Sistem "AI Unlimited" 100% Gratis Dengan 9Router!<br/>by <a href="https://www.youtube.com/@neptiver">neptiver</a></sub>
    </td>
    <td align="center" width="320"></td>
    <td align="center" width="320"></td>
  </tr>
</table>

</div>

> 🎬 **Made a video about 9Router?** Submit a [Pull Request](https://github.com/decolua/9router/pulls) adding your video to this section — we'll merge it!

---

## 🛠️ Supported CLI Tools

9Router works seamlessly with all major AI coding tools:

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/openclaw.png" width="60" alt="OpenClaw"/><br/>
        <b>OpenClaw</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/opencode.png" width="60" alt="OpenCode"/><br/>
        <b>OpenCode</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/cline.png" width="60" alt="Cline"/><br/>
        <b>Cline</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/continue.png" width="60" alt="Continue"/><br/>
        <b>Continue</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/droid.png" width="60" alt="Droid"/><br/>
        <b>Droid</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/roo.png" width="60" alt="Roo"/><br/>
        <b>Roo</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/copilot.png" width="60" alt="Copilot"/><br/>
        <b>Copilot</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/kilocode.png" width="60" alt="Kilo Code"/><br/>
        <b>Kilo Code</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/opendesign.png" width="60" alt="OpenDesign"/><br/>
        <b>OpenDesign</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/jcode.png" width="60" alt="jcode"/><br/>
        <b>jcode</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/grok-cli.png" width="60" alt="Grok Build"/><br/>
        <b>Grok Build</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/devin-cli.png" width="60" alt="Devin CLI"/><br/>
        <b>Devin CLI</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/deepseek-tui.png" width="60" alt="DeepSeek TUI"/><br/>
        <b>DeepSeek TUI</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/qwen.png" width="60" alt="Qwen Code"/><br/>
        <b>Qwen Code</b>
      </td>
    </tr>
  </table>
</div>

---

## 🌐 Supported Providers

### 🔐 OAuth Providers

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/github.png" width="60" alt="GitHub"/><br/>
        <b>GitHub</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/kimchi.png" width="60" alt="Kimchi"/><br/>
        <b>Kimchi</b>
      </td>
    </tr>
  </table>
</div>

### 🆓 Free Providers

<div align="center">
  <table>
    <tr>
      <td align="center" width="150">
        <img src="./public/providers/kiro.png" width="70" alt="Kiro"/><br/>
        <b>Kiro AI</b><br/>
        <sub>Claude 4.5 + GLM-5 + MiniMax<br/>50 credits/month free</sub>
      </td>
      <td align="center" width="150">
        <img src="./public/providers/opencode.png" width="70" alt="OpenCode Free"/><br/>
        <b>OpenCode Free</b><br/>
        <sub>No auth • Auto-fetch models<br/>Free (model list varies)</sub>
      </td>
      <td align="center" width="150">
        <img src="./public/providers/gemini.png" width="70" alt="Vertex AI"/><br/>
        <b>Vertex AI</b><br/>
        <sub>Gemini 3 Pro + GLM-5 + DeepSeek<br/>$300 credits free</sub>
      </td>
    </tr>
  </table>
</div>

> **Note:** iFlow, Qwen Code and Gemini CLI free tiers were discontinued in 2026. Use Kiro / OpenCode Free / Vertex instead.
>
> **Kiro AI** moved to a paid model in Sep 2025 — the free tier is now capped at **50 credits/month** (plus 500 trial credits for new accounts in the first 30 days). Paid tiers: Pro $20/mo (1,000 credits), Pro+ $40/mo (2,000), Pro Max $100/mo (5,000), Power $200/mo (10,000).
> **OpenCode Free** model list fluctuates over time (some models free only for limited promos) — subject to change without notice.
> **Vertex AI**: the $300 free credit for new GCP accounts is still valid, but since Mar 2026 the **Gemini API endpoint no longer consumes these credits** — call the **Vertex AI Studio** endpoint instead.

### 🔑 API Key Providers (40+)

<div align="center">
  <table>
    <tr>
      <td align="center" width="100">
        <img src="./public/providers/openrouter.png" width="50" alt="OpenRouter"/><br/>
        <sub>OpenRouter</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/glm.png" width="50" alt="GLM"/><br/>
        <sub>GLM</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/kimi.png" width="50" alt="Kimi"/><br/>
        <sub>Kimi</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/minimax.png" width="50" alt="MiniMax"/><br/>
        <sub>MiniMax</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/openai.png" width="50" alt="OpenAI"/><br/>
        <sub>OpenAI</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/anthropic.png" width="50" alt="Anthropic"/><br/>
        <sub>Anthropic</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="./public/providers/gemini.png" width="50" alt="Gemini"/><br/>
        <sub>Gemini</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/deepseek.png" width="50" alt="DeepSeek"/><br/>
        <sub>DeepSeek</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/groq.png" width="50" alt="Groq"/><br/>
        <sub>Groq</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/xai.png" width="50" alt="xAI"/><br/>
        <sub>xAI</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/mistral.png" width="50" alt="Mistral"/><br/>
        <sub>Mistral</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/perplexity.png" width="50" alt="Perplexity"/><br/>
        <sub>Perplexity</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="./public/providers/together.png" width="50" alt="Together"/><br/>
        <sub>Together AI</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/fireworks.png" width="50" alt="Fireworks"/><br/>
        <sub>Fireworks</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/cerebras.png" width="50" alt="Cerebras"/><br/>
        <sub>Cerebras</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/cohere.png" width="50" alt="Cohere"/><br/>
        <sub>Cohere</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/nvidia.png" width="50" alt="NVIDIA"/><br/>
        <sub>NVIDIA</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/siliconflow.png" width="50" alt="SiliconFlow"/><br/>
        <sub>SiliconFlow</sub>
      </td>
    </tr>
  </table>
  <p><i>...and 20+ more providers including Nebius, Chutes, Hyperbolic, and custom OpenAI/Anthropic compatible endpoints</i></p>
</div>

### 🏠 Self-hosted Providers

For speech and embeddings served from **your own** machine — whisper.cpp,
faster-whisper, Speaches, Kokoro-FastAPI, openedai-speech, llama.cpp/llama-server,
vLLM, Infinity, text-embeddings-inference, or anything else that speaks the OpenAI
shape.

| Provider | Endpoint used | Typical server |
| --- | --- | --- |
| **Self-hosted STT** | `/v1/audio/transcriptions` | whisper.cpp, faster-whisper |
| **Self-hosted TTS** | `/v1/audio/speech` | Kokoro-FastAPI, openedai-speech |
| **Self-hosted Embedding** | `/v1/embeddings` | llama-server, vLLM, Infinity |

Every other speech provider is a named cloud service with a fixed endpoint. These
three read their address from **each connection**, so one provider can front
several machines and load-balance across them like any other.

Set it on the connection as `providerSpecificData.baseUrl`:

| Provider | Give it | Result |
| --- | --- | --- |
| Self-hosted STT | the full URL — `http://host:8080/v1/audio/transcriptions` | used as-is |
| Self-hosted TTS | the server root — `http://host:8880` | `+ /v1/audio/speech` |
| Self-hosted Embedding | the **OpenAI base**, `/v1` included — `http://host:8080/v1` | `+ /embeddings` |

> **Mind the `/v1` on embeddings.** The adapter appends `/embeddings`, so
> `http://host:8080` resolves to `http://host:8080/embeddings` and misses the
> OpenAI route — llama-server answers **501**. Give it the same base URL an OpenAI
> client would use. A full `.../v1/embeddings` is also accepted, so a value pasted
> from a `curl` example works too.

The API key is not checked by most local servers, but the field must be non-empty:
it is what gives the connection a credentials record, and `baseUrl` lives there.
Any placeholder works.

Self-hosted Embedding has **no cloud fallback by design** — a connection saved
without a `baseUrl` is reported as a configuration error rather than quietly
falling back to `api.openai.com`, which would send your input text and API key to
a third party under a provider named "Self-hosted".

---

## 💡 Key Features

| Feature                                                                           | What It Does                                                                             | Why It Matters                                    |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 🚀 **RTK Token Saver** ([RTK](https://github.com/rtk-ai/rtk) ⭐40K)               | Compress tool outputs (`git diff`, `grep`, `ls`, `tree`...) before sending to LLM        | Save **20-40% input tokens** per request          |
| 🧠 **Headroom Token Saver** ([Headroom](https://github.com/chopratejas/headroom)) | Optional external `/v1/compress` proxy before provider routing                           | Save more context tokens without changing clients |
| 🪨 **Caveman Mode** ([Caveman](https://github.com/JuliusBrussee/caveman) ⭐52K)   | Inject caveman-speak prompt → LLM replies terse, technical substance preserved           | Save **up to 65% output tokens**                  |
| 🐴 **Ponytail** ([Ponytail](https://github.com/DietrichGebert/ponytail))          | Inject "lazy senior dev" prompt → LLM writes minimal, YAGNI-first code (Lite/Full/Ultra) | **Fewer output tokens, less refactoring**         |
| 🎯 **Smart 3-Tier Fallback**                                                      | Auto-route: Subscription → Cheap → Free                                                  | Never stop coding, zero downtime                  |
| 📊 **Real-Time Quota Tracking**                                                   | Live token count + reset countdown                                                       | Maximize subscription value                       |
| 🔄 **Format Translation**                                                         | OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex                                        | Works with any CLI tool                           |
| 👥 **Multi-Account Support**                                                      | Multiple accounts per provider, tried in priority order unless rotation is enabled       | Redundancy + optional load balancing              |
| 🔄 **Auto Token Refresh**                                                         | OAuth tokens refresh automatically                                                       | No manual re-login needed                         |
| 🎨 **Custom Combos**                                                              | Create unlimited model combinations                                                      | Tailor fallback to your needs                     |
| 📝 **Request Logging**                                                            | Debug mode with full request/response logs                                               | Troubleshoot issues easily                        |
| 📊 **Usage Analytics**                                                            | Track tokens, cost, trends over time                                                     | Optimize spending                                 |
| 🌐 **Deploy Anywhere**                                                            | Localhost, VPS, Docker, Cloudflare Workers                                               | Flexible deployment options                       |

Set `X-9Router-Token-Saver: off` to bypass all token savers for one chat request.

<details>
<summary><b>📖 Feature Details</b></summary>

### 🚀 RTK Token Saver

Tool outputs (`git diff`, `grep`, `find`, `ls`, `tree`, log dumps...) often eat 30-50% of your prompt budget. RTK detects them and applies smart, lossless compression **before** the request hits the LLM:

- **Filters:** `git-diff`, `git-status`, `grep`, `find`, `ls`, `tree`, `dedup-log`, `smart-truncate`, `read-numbered`, `search-list`
- **Auto-detect:** No config needed — RTK peeks the first 1KB of each `tool_result` and picks the right filter.
- **Safe by design:** If a filter fails, throws, or makes output bigger, RTK silently keeps the original text. Errors never break your request.
- **Universal:** Works across all formats (OpenAI, Claude, Gemini, Cursor, Kiro, OpenAI Responses) because it runs **before** any format translation.
- **Default ON:** Toggle anytime in Dashboard → Endpoint settings.

```
Without RTK: 47K tokens sent to LLM
With RTK:    28K tokens sent to LLM   (40% saved · same context · same answer)
```

### 🧠 Headroom Token Saver

Headroom is optional and runs separately. 9Router calls Headroom's local `/v1/compress` endpoint, then keeps normal routing, fallback, auth, and usage tracking:

```
Client → 9Router → Headroom /v1/compress → 9Router → provider
```

Local setup:

```bash
pip install "headroom-ai[proxy]"
headroom proxy --port 8787
```

Enable in Dashboard → Endpoint → Token Saver → Headroom. Default URL: `http://localhost:8787`.

Docker examples:

```bash
# Headroom service in same Docker network
http://headroom:8787

# Headroom running on host machine
http://host.docker.internal:8787
```

If Headroom is down or returns an error, 9Router fails open and sends the original request.

### 🐴 Ponytail (Lazy Senior Dev)

Ponytail injects a _"lazy senior dev"_ system prompt into every request, biasing the LLM toward minimal, YAGNI-first code — deletion over addition, stdlib over new deps, one-liners over abstractions. Adapted from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail).

- **Lite** — Build what's asked, name the lazier alternative.
- **Full** — YAGNI ladder enforced: stdlib → native → existing deps → one-liner → minimal code.
- **Ultra** — YAGNI extremist: deletion first, ship the one-liner, challenge the rest of the requirement in the same response.

```
Without Ponytail: verbose code, extra abstractions, "just in case" scaffolding
With Ponytail:    shortest working diff, no unrequested abstractions, fewer tokens
```

Never trades away: input validation, error handling that prevents data loss, security, accessibility, or anything explicitly requested. Enable in Dashboard → Endpoint → Ponytail. Stacks with Caveman (output terseness) and RTK (input compression).

### 🎯 Smart 3-Tier Fallback

Create combos with automatic fallback:

```
Combo: "my-coding-stack"
  1. cc/claude-opus-5          (your subscription)
  2. glm/glm-4.7               (cheap backup, $0.6/1M)
  3. if/kimi-k2               (free fallback — the only kimi model iflow.js ships)

→ Auto switches when quota runs out or errors occur
```

### 📊 Real-Time Quota Tracking

- Token consumption per provider
- Reset countdown (5-hour, daily, weekly)
- Cost estimation for paid tiers
- Monthly spending reports

### 🔄 Format Translation

Seamless translation between formats:

- **OpenAI** ↔ **Claude** ↔ **Gemini** ↔ **Cursor** ↔ **Kiro** ↔ **Vertex** ↔ **Antigravity** ↔ **Ollama** ↔ **OpenAI Responses**
- Your CLI tool sends OpenAI format → 9Router translates → Provider receives native format
- Works with any tool that supports custom OpenAI endpoints

### 👥 Multi-Account Support

- Add multiple accounts per provider
- Priority-based (`fill-first`) routing by default — round-robin is opt-in per provider
- Fallback to next account when one hits quota

### 🔄 Auto Token Refresh

- OAuth tokens automatically refresh before expiration
- No manual re-authentication needed
- Seamless experience across all providers

### 🎨 Custom Combos

- Create unlimited model combinations
- Mix subscription, cheap, and free tiers
- Name your combos for easy access

### 📝 Request Logging

- Enable debug mode for full request/response logs
- Track API calls, headers, and payloads
- Troubleshoot integration issues
- Export logs for analysis

### 📊 Usage Analytics

- Track token usage per provider and model
- Cost estimation and spending trends
- Monthly reports and insights
- Optimize your AI spending
- Counts come from the provider's own usage metadata; when a provider reports
  none and the response carried content, the tokens are **estimated** from the
  request and response text and the row is stored marked `estimated` (shown as
  `(estimated)` on the `📊 DONE` line) — so an upstream that omits counts no
  longer leaves the Usage page at zero. A response with neither counts nor
  content is not recorded.

> **💡 IMPORTANT - Understanding Dashboard Costs:**
>
> The "cost" displayed in Usage Analytics is **for tracking and comparison purposes only**.
> 9Router itself **never charges** you anything. You only pay providers directly (if using paid services).
>
> **Example:** If your dashboard shows "$290 total cost" while using Kiro free models, this represents
> what you would have paid using paid APIs directly. Your actual cost = **$0** (Kiro free tier: ~50 credits/mo).
>
> Think of it as a "savings tracker" showing how much you're saving by using free models or
> routing through 9Router!

### 🌐 Deploy Anywhere

- 💻 **Localhost** - Default, works offline
- ☁️ **VPS/Cloud** - Run on any server you control
- 🐳 **Docker** - One-command deployment
- 🚀 **Cloudflare Workers** - Global edge network

</details>

---

## 💰 Pricing at a Glance

| Tier                | Provider              | Cost         | Quota Reset      | Best For                                |
| ------------------- | --------------------- | ------------ | ---------------- | --------------------------------------- |
| **🚀 TOKEN SAVER**  | **RTK (built-in)**    | **FREE**     | Always on        | **Save 20-40% tokens on EVERY request** |
| **💳 SUBSCRIPTION** | Claude Code (Pro/Max) | $20-200/mo   | 5h + weekly      | Already subscribed                      |
|                     | Codex (Plus/Pro)      | $20-200/mo   | 5h + weekly      | OpenAI users                            |
|                     | GitHub Copilot        | $10-19/mo    | Monthly          | GitHub users                            |
|                     | Cursor IDE            | $20/mo       | Monthly          | Cursor users                            |
| **💰 CHEAP**        | GLM-5.1 / GLM-4.7     | $0.6/1M      | Daily 10AM       | Budget backup                           |
|                     | MiniMax M2.7          | $0.2/1M      | 5-hour rolling   | Cheapest option                         |
|                     | Kimi K2.5             | $9/mo flat   | 10M tokens/mo    | Predictable cost                        |
| **🆓 FREE**         | Kiro AI               | $0           | 50 credits/mo    | Claude 4.5 + GLM-5 + MiniMax free (paid tiers above) |
|                     | OpenCode Free         | $0           | Varies*          | No auth, auto-fetch models (list changes over time) |
|                     | Vertex AI             | $300 credits | New GCP accounts | Gemini 3 Pro + DeepSeek + GLM-5 (use Vertex AI Studio endpoint for free credits) |

**💡 Pro Tip:** RTK + Kiro AI + OpenCode Free combo = **$0 cost + 20-40% token savings**!

---

### 📊 Understanding 9Router Costs & Billing

**9Router Billing Reality:**

✅ **9Router software = FREE forever** (open source, never charges)  
✅ **Dashboard "costs" = Display/tracking only** (not actual bills)  
✅ **You pay providers directly** (subscriptions or API fees)  
✅ **FREE providers stay FREE** (Kiro ~50 credits/mo, OpenCode Free, Vertex $300 credits = $0 within free-tier limits) — note iFlow/Qwen/Gemini CLI free tiers were discontinued in 2026
❌ **9Router never sends invoices** or charges your card

**How Cost Display Works:**

The dashboard shows **estimated costs** as if you were using paid APIs directly. This is **not billing** - it's a comparison tool to show your savings.

**Example Scenario:**

```
Dashboard Display:
• Total Requests: 1,662
• Total Tokens: 47M
• Display Cost: $290

Reality Check:
• Provider: Kiro (free tier: ~50 credits/mo)
• Actual Payment: $0.00
• What $290 Means: Amount you SAVED by using free models!
```

**Payment Rules:**

- **Subscription providers** (Claude Code, Codex): Pay them directly via their websites
- **Cheap providers** (GLM, MiniMax): Pay them directly, 9Router just routes
- **FREE providers** (Kiro, OpenCode Free, Vertex): Genuinely free within their free-tier limits, no hidden charges
- **9Router**: Never charges anything, ever

---

## 🎯 Use Cases

### Case 1: "I have Claude Pro subscription"

**Problem:** Quota expires unused, rate limits during heavy coding

**Solution:**

```
Combo: "maximize-claude"
  1. cc/claude-opus-5          (use subscription fully)
  2. glm/glm-5.1               (cheap backup when quota out)
  3. kr/claude-sonnet-4.5      (free emergency fallback)

Monthly cost: $20 (subscription) + ~$5 (backup) = $25 total
vs. $20 + hitting limits = frustration
```

### Case 2: "I want zero cost"

**Problem:** Can't afford subscriptions, need reliable AI coding

**Solution:**

```
Combo: "free-forever"
  1. kr/claude-sonnet-4.5      (Claude 4.5 free via Kiro, ~50 credits/mo)
  2. kr/glm-5                  (GLM-5 free via Kiro)
  3. oc/<auto>                 (OpenCode Free, no auth)

Monthly cost: $0
Quality: Production-ready models + RTK saves 20-40% tokens
```

### Case 3: "I need 24/7 coding, no interruptions"

**Problem:** Deadlines, can't afford downtime

**Solution:**

```
Combo: "always-on"
  1. cc/claude-opus-5          (best quality)
  2. cx/gpt-5.5                (second subscription)
  3. glm/glm-5.1               (cheap, resets daily)
  4. minimax/MiniMax-M2.7      (cheapest, 5h reset)
  5. kr/claude-sonnet-4.5      (free via Kiro, ~50 credits/mo)

Result: 5 layers of fallback = zero downtime
Monthly cost: $20-200 (subscriptions) + $10-20 (backup)
```

### Case 4: "I want FREE AI in OpenClaw"

**Problem:** Need AI assistant in messaging apps (WhatsApp, Telegram, Slack...), completely free

**Solution:**

```
Combo: "openclaw-free"
  1. kr/claude-sonnet-4.5      (Claude 4.5 free)
  2. kr/glm-5                  (GLM-5 free)
  3. kr/MiniMax-M2.5           (MiniMax free)

Monthly cost: $0
Access via: WhatsApp, Telegram, Slack, Discord, iMessage, Signal...
```

---

## ❓ Frequently Asked Questions

<details>
<summary><b>📊 Why does my dashboard show high costs?</b></summary>

The dashboard tracks your token usage and displays **estimated costs** as if you were using paid APIs directly. This is **not actual billing** - it's a reference to show how much you're saving by using free models or existing subscriptions through 9Router.

**Example:**

- **Dashboard shows:** "$290 total cost"
- **Reality:** You're using Kiro free models (~50 credits/mo)
- **Your actual cost:** **$0.00**
- **What $290 means:** Amount you **saved** by using free models instead of paid APIs!

The cost display is a "savings tracker" to help you understand your usage patterns and optimization opportunities.

</details>

<details>
<summary><b>💳 Will I be charged by 9Router?</b></summary>

**No.** 9Router is free, open-source software that runs on your own computer. It never charges you anything.

**You only pay:**

- ✅ **Subscription providers** (Claude Code $20/mo, Codex $20-200/mo) → Pay them directly on their websites
- ✅ **Cheap providers** (GLM, MiniMax) → Pay them directly, 9Router just routes your requests
- ❌ **9Router itself** → **Never charges anything, ever**

9Router is a local proxy/router. It doesn't have your credit card, can't send invoices, and has no billing system. It's completely free software.

</details>

<details>
<summary><b>🆓 Are FREE providers really unlimited?</b></summary>

**Mostly!** The current FREE providers (Kiro, OpenCode Free, Vertex) are genuinely free, but free tiers have limits:

These are free services offered by those respective companies:

- **Kiro AI**: ~50 credits/month free (plus 500 trial credits for new accounts in the first 30 days) via AWS Builder ID / Google / GitHub OAuth. Paid tiers available above that.
- **OpenCode Free**: No-auth passthrough proxy, models auto-fetched from `opencode.ai/zen/v1/models`. The free model list fluctuates over time (some models free only for limited promos) — subject to change without notice.
- **Vertex AI**: $300 free credits for new Google Cloud accounts (90 days). Since Mar 2026 the Gemini API endpoint no longer consumes these credits — use the **Vertex AI Studio** endpoint instead.

9Router just routes your requests to them - there's no "catch" or future billing from 9Router itself. They're truly free services, and 9Router makes them easy to use with fallback support.

**Discontinued free tiers (no longer recommended):**

- ❌ **iFlow**: Was free unlimited, now changed to paid (2026)
- ❌ **Qwen Code**: Free OAuth tier fully discontinued by Alibaba on 2026-04-15
- ❌ **Gemini CLI**: Service fully shut down by Google on 2026-06-18 (replaced by the closed-source Antigravity CLI). Discontinued — do not use.

</details>

<details>
<summary><b>💰 How do I minimize my actual AI costs?</b></summary>

**Free-First Strategy:**

1. **Start with 100% free combo:**

   ```
   1. kr/glm-5 (GLM-5 free via Kiro, ~50 credits/mo)
   2. OpenCode Free models (no auth, auto-fetched)
   3. Vertex AI Gemini 3 Pro (using the Vertex AI Studio endpoint with $300 credits)
   ```

   **Cost: $0/month** (within Kiro's free credit cap; OpenCode/Vertex subject to their free-tier limits)

2. **Add cheap backup** only if you need it:

   ```
   4. glm/glm-4.7 ($0.6/1M tokens)
   ```

   **Additional cost: Only pay for what you actually use**

3. **Use subscription providers last:**
   - Only if you already have them
   - 9Router helps maximize their value through quota tracking

**Result:** Most users can operate at $0/month using only free tiers!

</details>

<details>
<summary><b>📈 What if my usage suddenly spikes?</b></summary>

9Router's smart fallback prevents surprise charges:

**Scenario:** You're on a coding sprint and blow through your quotas

**Without 9Router:**

- ❌ Hit rate limit → Work stops → Frustration
- ❌ Or: Accidentally rack up huge API bills

**With 9Router:**

- ✅ Subscription hits limit → Auto-fallback to cheap tier
- ✅ Cheap tier gets expensive → Auto-fallback to free tier
- ✅ Never stop coding → Predictable costs

**You're in control:** Set spending limits per provider in dashboard, and 9Router respects them.

</details>

---

## 📖 Setup Guide

<details>
<summary><b>🔐 Subscription Providers (Maximize Value)</b></summary>

### Claude Code (Pro/Max)

```bash
Dashboard → Providers → Connect Claude Code
→ OAuth login → Auto token refresh
→ 5-hour + weekly quota tracking

Models:
  cc/claude-opus-5
  cc/claude-fable-5-1
  cc/claude-sonnet-5
  cc/claude-haiku-4-5-20251001
```

**Pro Tip:** Use Opus for complex tasks, Sonnet for speed. 9Router tracks quota per model!

### OpenAI Codex (Plus/Pro)

```bash
Dashboard → Providers → Connect Codex
→ OAuth login (port 1455)
→ 5-hour + weekly reset

Models:
  cx/gpt-6.1-sol
  cx/gpt-6-sol
  cx/gpt-6-astra
  cx/gpt-6-luna
  cx/gpt-5.6-sol
  cx/gpt-5.5
```

### GitHub Copilot

```bash
Dashboard → Providers → Connect GitHub
→ OAuth via GitHub
→ Monthly reset (1st of month)

Models:
  gh/gpt-5.4
  gh/claude-opus-4.7
  gh/claude-sonnet-4.6
  gh/gemini-3.1-pro-preview
  gh/grok-code-fast-1
```

### Cursor IDE

```bash
Dashboard → Providers → Connect Cursor
→ OAuth login
→ Monthly subscription

Models:
  cu/claude-4.6-opus-max
  cu/claude-4.5-sonnet-thinking
  cu/gpt-5.3-codex
```

</details>

<details>
<summary><b>💰 Cheap Providers (Backup)</b></summary>

### GLM-5.1 / GLM-4.7 (Daily reset, $0.6/1M)

1. Sign up: [Zhipu AI](https://open.bigmodel.cn/)
2. Get API key from Coding Plan
3. Dashboard → Add API Key:
   - Provider: `glm`
   - API Key: `your-key`

**Use:** `glm/glm-5.1`, `glm/glm-5`, `glm/glm-4.7`

**Pro Tip:** Coding Plan offers 3× quota at 1/7 cost! Reset daily 10:00 AM.

### MiniMax M2.7 (5h reset, $0.20/1M)

1. Sign up: [MiniMax](https://www.minimax.io/)
2. Get API key
3. Dashboard → Add API Key

**Use:** `minimax/MiniMax-M2.7`, `minimax/MiniMax-M2.5`

**Pro Tip:** Cheapest option for long context (1M tokens)!

### Kimi K2.5 ($9/month flat)

1. Subscribe: [Moonshot AI](https://platform.moonshot.ai/)
2. Get API key
3. Dashboard → Add API Key

**Use:** `kimi/kimi-k2.5`, `kimi/kimi-k2.5-thinking`

**Pro Tip:** Fixed $9/month for 10M tokens = $0.90/1M effective cost!

</details>

<details>
<summary><b>🆓 FREE Providers (Recommended)</b></summary>

### Kiro AI (Claude 4.5 + GLM-5 + MiniMax FREE)

```bash
Dashboard → Connect Kiro
→ AWS Builder ID, AWS IAM Identity Center, Google, or GitHub
→ ~50 credits/month free (paid tiers above)

Models:
  kr/claude-sonnet-4.5
  kr/claude-haiku-4.5
  kr/glm-5
  kr/MiniMax-M2.5
  kr/qwen3-coder-next
  kr/deepseek-3.2
```

**Pro Tip:** Best free option for Claude. No API key, no payment; free tier ~50 credits/mo.

### OpenCode Free (No auth, auto-fetch models)

```bash
Dashboard → Connect OpenCode Free
→ No login required (passthrough proxy)
→ Models auto-fetched from opencode.ai/zen/v1/models
```

**Pro Tip:** Fastest setup. Just connect and start coding.

### Vertex AI ($300 free credits for new GCP accounts)

```bash
Dashboard → Connect Vertex AI
→ Upload Google Cloud Service Account JSON
→ Enable Vertex AI API in your GCP project

Models:
  vertex/gemini-3.1-pro-preview
  vertex/gemini-3-flash-preview
  vertex/gemini-2.5-flash

Vertex Partner (Anthropic / DeepSeek / GLM / Qwen via Vertex):
  vertex-partner/zai-org/glm-5-maas
  vertex-partner/deepseek-ai/deepseek-v3.2-maas
  vertex-partner/qwen/qwen3-next-80b-a3b-thinking-maas
```

For a raw Google Cloud API-key connection, set the following through
`PUT /api/providers/<connection-id>` to select the global endpoint:

```json
{
  "providerSpecificData": {
    "projectId": "YOUR_GOOGLE_CLOUD_PROJECT_ID",
    "location": "global"
  }
}
```

With an explicit project, API-key requests honor `location` and default to
`global` when it is omitted. Connections without an explicit project retain
the projectless endpoint. Gemini 4 Argon supports `global`, `us`, and `eu`,
not regional locations such as `europe-west1`; see
[Google's supported locations](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/4-argon).

**Pro Tip:** New Google Cloud accounts get $300 credits free for 90 days. Plenty for daily coding.

</details>

<details>
<summary><b>🎨 Create Combos</b></summary>

### Example 1: Maximize Subscription → Cheap Backup

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-5 (Subscription primary)
  2. glm/glm-5.1 (Cheap backup, $0.6/1M)
  3. minimax/MiniMax-M2.7 (Cheapest fallback, $0.20/1M)

Use in CLI: premium-coding

Monthly cost example (100M tokens):
  80M via Claude (subscription): $0 extra
  15M via GLM: $9
  5M via MiniMax: $1
  Total: $10 + your subscription
```

### Example 2: Free-Only (Zero Cost)

```
Name: free-combo
Models:
  1. kr/claude-sonnet-4.5 (Claude 4.5 free via Kiro, ~50 credits/mo)
  2. kr/glm-5 (GLM-5 free via Kiro)
  3. vertex/gemini-3.1-pro-preview ($300 free credits)

Cost: $0 forever (+ 20-40% token savings via RTK)!
```

</details>

<details>
<summary><b>🔧 CLI Integration</b></summary>

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from 9router dashboard]
  Model: cc/claude-opus-5
```

Or use combo: `premium-coding`

### Claude Code

Claude Code reads its endpoint from env vars (or `~/.claude/settings.json`), not
`~/.claude/config.json`. Set:

```bash
export ANTHROPIC_BASE_URL="http://localhost:20128/v1"
export ANTHROPIC_AUTH_TOKEN="your-9router-api-key"
claude
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

### OpenClaw

**Option 1 — Dashboard (recommended):**

```
Dashboard → CLI Tools → OpenClaw → Select Model → Apply
```

**Option 2 — Manual:** Edit `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/kr/claude-sonnet-4.5"
      }
    }
  },
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "http://127.0.0.1:20128/v1",
        "apiKey": "sk_9router",
        "api": "openai-completions",
        "models": [
          {
            "id": "kr/claude-sonnet-4.5",
            "name": "Claude Sonnet 4.5 (Kiro Free)"
          }
        ]
      }
    }
  }
}
```

> **Note:** OpenClaw only works with local 9Router. Use `127.0.0.1` instead of `localhost` to avoid IPv6 resolution issues.

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [from dashboard]
Model: cc/claude-opus-5
```

</details>

<details>
<summary><b>🚀 Deployment</b></summary>

### VPS Deployment

```bash
# Clone and install
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run build

# Configure
export JWT_SECRET="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"
# /var/lib/9router is a system path and does not exist on a fresh host: create it
# first (the app fails fast at boot if DATA_DIR cannot be created/written). Or
# drop this export entirely and the app uses the per-user default ~/.9router.
sudo mkdir -p /var/lib/9router && sudo chown "$USER:$USER" /var/lib/9router
export DATA_DIR="/var/lib/9router"
export PORT="20128"
export HOSTNAME="0.0.0.0"
export NODE_ENV="production"
export NEXT_PUBLIC_BASE_URL="http://localhost:20128"
export NEXT_PUBLIC_CLOUD_URL="https://9router.com"
export API_KEY_SECRET="endpoint-proxy-api-key-secret"
export MACHINE_ID_SALT="endpoint-proxy-salt"

# Start
npm run start

# Or use PM2
npm install -g pm2
pm2 start npm --name 9router -- start
pm2 save
pm2 startup
```

### Docker

Published images (multi-platform `linux/amd64` + `linux/arm64`):

- Docker Hub: [`decolua/9router`](https://hub.docker.com/r/decolua/9router)
- GHCR: [`ghcr.io/decolua/9router`](https://github.com/decolua/9router/pkgs/container/9router)

**Quick start (use published image):**

```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  decolua/9router:latest
```

→ Open http://localhost:20128

**Build from source (dev):**

```bash
git clone https://github.com/decolua/9router.git
cd 9router
docker build -t 9router .
docker run -d --name 9router -p 20128:20128 \
  -v "$HOME/.9router:/app/data" -e DATA_DIR=/app/data 9router
```

**Compose fallback when the published images cannot be pulled** (clean,
rootless or air-gapped host): keep `docker-compose.yml` and apply the
local-build override on top of it — ports, volumes, env and wiring still come
from the base file:

```bash
# 9router built from this checkout
docker compose -f docker-compose.yml -f docker-compose.local-build.yml up -d --build

# no third-party pulls at all (headroom sidecar omitted — optional at runtime)
docker compose -f docker-compose.yml -f docker-compose.local-build.yml \
  up -d --build --no-deps 9router
```

The override tags the build `9router:local` (a local build never overwrites
`decolua/9router:latest`) — see [DOCKER.md](DOCKER.md).

**Container defaults:**

- `PORT=20128`
- `HOSTNAME=0.0.0.0`

**Useful commands:**

```bash
docker logs -f 9router
docker restart 9router
docker stop 9router && docker rm 9router
docker pull decolua/9router:latest   # update to latest
```

**Data persistence:** `$HOME/.9router/db/data.sqlite` on host ↔ `/app/data/db/data.sqlite` in container.

### Environment Variables

| Variable                                             | Default                                  | Description                                                                         |
| ---------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `JWT_SECRET`                                         | Auto-generated (`~/.9router/jwt-secret`) | JWT signing secret for dashboard auth cookie (override to share across instances)   |
| `INITIAL_PASSWORD`                                   | `123456`                                 | First login password when no saved hash exists                                      |
| `DATA_DIR`                                           | `~/.9router`                             | Main app data location (SQLite at `$DATA_DIR/db/data.sqlite`); must be writable — the app fails fast at boot if it cannot create/write it |
| `PORT`                                               | framework default                        | Service port (`20128` in examples)                                                  |
| `HOSTNAME`                                           | framework default                        | Bind host (Docker defaults to `0.0.0.0`)                                            |
| `NODE_ENV`                                           | runtime default                          | Set `production` for deploy                                                         |
| `BASE_URL`                                           | `http://localhost:20128`                 | Server-side public base URL of this instance (used when resolving callback/redirect origins for SAML/OIDC login; falls back to request headers when unset) |
| `CLOUD_URL`                                          | `https://9router.com`                    | Dashboard URL used by the CLI endpoint presets and URL matching                               |
| `NEXT_PUBLIC_BASE_URL`                               | `http://localhost:3000`                  | Backward-compatible/public base URL (prefer `BASE_URL` for server runtime)          |
| `NEXT_PUBLIC_CLOUD_URL`                              | `https://9router.com`                    | Backward-compatible/public dashboard URL fallback (prefer `CLOUD_URL`)             |
| `API_KEY_SECRET`                                     | `endpoint-proxy-api-key-secret`          | Server-side HMAC secret used to derive and validate generated API keys. **This is not a client credential — never send it as `Authorization: Bearer <API_KEY_SECRET>` to `/v1`.** Remote clients must use an active API key minted in the dashboard (Endpoint → API Keys) or via login + `POST /api/keys` (keys look like `sk-…`). |
| `MACHINE_ID_SALT`                                    | `endpoint-proxy-salt`                    | Salt for stable machine ID hashing                                                  |
| `ENABLE_REQUEST_LOGS`                                | `false`                                  | Enables request/response logs under `logs/`. **Also the hard override for the in-DB `requestDetails` store** (dashboard → Observability): when the variable is set to any value it supersedes the UI toggle, so `ENABLE_REQUEST_LOGS=false` disables in-DB request-detail capture even when Observability is enabled in the dashboard — and `true` enables it regardless of the UI setting. |
| `AUTH_COOKIE_SECURE`                                 | `false`                                  | Force `Secure` auth cookie (set `true` behind HTTPS reverse proxy)                  |
| `REQUIRE_API_KEY`                                    | `false`                                  | API-key enforcement on the public LLM API (`/v1`, `/v1beta`, `/api/v1`, `/api/v1beta`, `/codex`, `/responses`) for remote clients. `true` = a remote client must send a valid key (trusted-local clients still pass the dashboard gate, and the LLM handlers layer their own key check on top while it is `true`); `false` = a remote client may call the LLM API with no key. Unset = the stored setting applies, whose default is `true` (secure). `.env.example` ships `false` for local use — set `true` before exposing the gateway to the internet (recommended for internet-exposed deploys). This opt-out is a deployment setting only — it is never a reason to send `API_KEY_SECRET` as a client key; remote clients still use a minted `sk-…` API key when a key is needed. |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | empty                                    | Optional outbound proxy for upstream provider calls                                 |
| `SEARXNG_URL`                                        | `http://localhost:8888/search`           | Endpoint for the built-in unauthenticated SearXNG web-search provider               |

Notes:

- Lowercase proxy variables are also supported: `http_proxy`, `https_proxy`, `all_proxy`, `no_proxy`.
- `.env` is not baked into Docker image (`.dockerignore`); inject runtime config with `--env-file` or `-e`.
- On Windows, `APPDATA` can be used for local storage path resolution.
- `INSTANCE_NAME` appears in older docs/env templates, but is currently not used at runtime.

### Runtime Files and Storage

- Main app state: `${DATA_DIR}/db/data.sqlite` (SQLite — providers, combos, aliases, keys, settings, usage history)
- Auto backups: `${DATA_DIR}/db/backups/`
- Optional request/translator logs: `<repo>/logs/...` when `ENABLE_REQUEST_LOGS=true`
- Both `${DATA_DIR}` and `~/.9router` resolve to the same location in a Docker container — the symlink `/root/.9router -> /app/data` is created at build time.

</details>

---

## 📊 Available Models

<details>
<summary><b>View all available models</b></summary>

**Claude Code (`cc/`)** - Pro/Max:

- `cc/claude-opus-5`
- `cc/claude-fable-5-1`
- `cc/claude-fable-5`
- `cc/claude-sonnet-5`
- `cc/claude-haiku-4-5-20251001`

**Codex (`cx/`)** - Plus/Pro:

- `cx/gpt-6.1-sol`
- `cx/gpt-6-sol`
- `cx/gpt-6-astra`
- `cx/gpt-6-luna`
- `cx/gpt-5.6-sol`
- `cx/gpt-5.5`

**GitHub Copilot (`gh/`)**:

- `gh/gpt-5.4`
- `gh/claude-opus-4.7`
- `gh/claude-sonnet-4.6`
- `gh/gemini-3.1-pro-preview`
- `gh/grok-code-fast-1`

**Cursor (`cu/`)** - Subscription:

- `cu/claude-4.6-opus-max`
- `cu/claude-4.6-sonnet-medium-thinking`
- `cu/claude-4.5-opus-high-thinking`
- `cu/claude-4.5-opus-high`
- `cu/claude-4.5-opus`
- `cu/claude-4.5-sonnet-thinking`
- `cu/claude-4.5-sonnet`
- `cu/claude-4.5-haiku`
- `cu/gpt-5.3-codex`
- `cu/gpt-5.2-codex`
- `cu/gpt-5.2`
- `cu/gemini-3-flash-preview`
- `cu/kimi-k2.5`

The list is synced from the provider registry (`open-sse/providers/registry/cursor.js`); `cu/auto` is also available (server picks).

**GLM (`glm/`)** - $0.6/1M:

- `glm/glm-5.1`
- `glm/glm-5`
- `glm/glm-4.7`

**MiniMax (`minimax/`)** - $0.2/1M:

- `minimax/MiniMax-M2.7`
- `minimax/MiniMax-M2.5`

**Kimi (`kimi/`)** - $9/mo flat:

- `kimi/kimi-k2.5`
- `kimi/kimi-k2.5-thinking`

**Kiro (`kr/`)** - Free (~50 credits/month, paid tiers above):

- `kr/claude-sonnet-4.5`
- `kr/claude-haiku-4.5`
- `kr/glm-5`
- `kr/MiniMax-M2.5`
- `kr/qwen3-coder-next`
- `kr/deepseek-3.2`

**OpenCode Free (`oc/`)** - FREE no-auth:

- Auto-fetched from `opencode.ai/zen/v1/models`

**Vertex AI (`vertex/`)** - $300 free credits:

- `vertex/gemini-3.1-pro-preview`
- `vertex/gemini-3-flash-preview`
- `vertex/gemini-2.5-flash`
- `vertex-partner/zai-org/glm-5-maas`
- `vertex-partner/deepseek-ai/deepseek-v3.2-maas`

</details>

---

## 🐛 Troubleshooting

**"Language model did not provide messages"**

- Provider quota exhausted → Check dashboard quota tracker
- Solution: Use combo fallback or switch to cheaper tier

**Rate limiting**

- Subscription quota out → Fallback to GLM/MiniMax
- Add combo: `cc/claude-opus-5 → glm/glm-5.1 → kr/claude-sonnet-4.5`

**OAuth token expired**

- Auto-refreshed by 9Router
- If issues persist: Dashboard → Provider → Reconnect

**High costs**

- Enable RTK in Dashboard → Endpoint settings (default ON, saves 20-40% tokens)
- Check usage stats in Dashboard
- Switch primary model to GLM/MiniMax
- Use free tier (Kiro, OpenCode Free, Vertex) for non-critical tasks

**Dashboard opens on wrong port**

- Set `PORT=20128` and `NEXT_PUBLIC_BASE_URL=http://localhost:20128`

**First login not working**

- Check `INITIAL_PASSWORD` in `.env`. If it is set (the `.env.example` default is
  `change-me-to-a-strong-password`), that value is the password — not the built-in fallback.
- Only when `INITIAL_PASSWORD` is completely unset does the built-in fallback
  `123456` apply (loopback sessions only). See "Headless / Docker first login"
  above for why a copied `.env.example` rejects `123456`.

**No request logs under `logs/`**

- Set `ENABLE_REQUEST_LOGS=true`

### Crash logging

The production wrapper (`custom-server.js`, used by `npm start` and the Docker image) appends one JSON object per line to `$DATA_DIR/logs/crash.log` (default `~/.9router/logs/crash.log`). All crash-log writes are fail-open — a logging error never crashes or blocks the server.

Record shapes:

```json
{"ts":"…ISO…","event":"boot","pid":123,"argv":"custom-server.js","dataDir":"…"}
{"ts":"…ISO…","event":"shutdown","pid":123,"signal":"SIGTERM"}
{"ts":"…ISO…","event":"uncaughtException","pid":123,"name":"Error","message":"…","stack":"…"}
{"ts":"…ISO…","event":"unhandledRejection","pid":123,"name":"Error","message":"…","stack":"…"}
```

**Reading an exit-137 (OOM/SIGKILL) death:** SIGKILL cannot be caught, so nothing is logged for it. A `boot` record with no following `shutdown`/`uncaughtException`/`unhandledRejection` record means the process was killed abnormally — check `dmesg` or `journalctl -k` for the kernel OOM killer entry.

---

## 🛠️ Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Next.js 16
- **UI**: React 19 + Tailwind CSS 4
- **Database**: SQLite (better-sqlite3 / node:sqlite / sql.js fallback)
- **Streaming**: Server-Sent Events (SSE)
- **Auth**: OAuth 2.0 (PKCE) + JWT + API Keys

---

## 📝 API Reference

### Chat Completions

```bash
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer your-api-key
Content-Type: application/json

{
  "model": "cc/claude-opus-5",
  "messages": [
    {"role": "user", "content": "Write a function to..."}
  ],
  "stream": true
}
```

### List Models

```bash
GET http://localhost:20128/v1/models
Authorization: Bearer your-api-key

→ Returns all models + combos in OpenAI format
```

## 📧 Support

- **Website**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)

---

## 👥 Contributors

Thanks to all contributors who helped make 9Router better!

For work-item markers, evidence, and close-out expectations, see the [repository traceability doctrine](docs/traceability-doctrine.md).

[![Contributors](https://contrib.rocks/image?repo=decolua/9router&max=150&columns=15&anon=1&v=20260309)](https://github.com/decolua/9router/graphs/contributors)

---

## 📊 Star Chart

[![GitHub stars](https://img.shields.io/github/stars/decolua/9router?style=social)](https://github.com/decolua/9router)

## 🔀 Forks

**[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — A full-featured TypeScript fork of 9Router. Adds 36+ providers, 4-tier auto-fallback, multi-modal APIs (images, embeddings, audio, TTS), circuit breaker, semantic cache, LLM evaluations, and a polished dashboard. 368+ unit tests. Available via npm and Docker.

---

## 🙏 Acknowledgments

Built on the shoulders of giants:

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** — original Go implementation that inspired this JavaScript port.
- **[RTK](https://github.com/rtk-ai/rtk)** ![Stars](https://img.shields.io/github/stars/rtk-ai/rtk?style=flat&color=yellow) — Rust token-saver. 9Router ports its compression pipeline to JS → **−20-40% input tokens** on every request.
- **[Caveman](https://github.com/JuliusBrussee/caveman)** ![Stars](https://img.shields.io/github/stars/JuliusBrussee/caveman?style=flat&color=yellow) by **[@JuliusBrussee](https://github.com/JuliusBrussee)** — viral _"why use many token when few token do trick"_. 9Router adapts its prompt → **−65% output tokens**.
- **[Ponytail](https://github.com/DietrichGebert/ponytail)** ![Stars](https://img.shields.io/github/stars/DietrichGebert/ponytail?style=flat&color=yellow) by **[@DietrichGebert](https://github.com/DietrichGebert)** — _"lazy senior dev"_ skill. 9Router injects its YAGNI-first ladder → **fewer tokens, less code, shorter diffs**.

Huge thanks to these authors — without their work, 9Router's token-saving features wouldn't exist. ⭐ them on GitHub!

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">
  <sub>Built with ❤️ for developers who code 24/7</sub>
</div>
