<div align="center">
  <img src="./images/9router.png" alt="9Router Dashboard" width="800"/>
  
  # 9Router - Free AI Router
  
  **Never stop coding. Auto-route to FREE & cheap AI models with smart fallback.**
  
  **Free AI Provider for OpenClaw.**
  
  <p align="center">
    <img src="./public/providers/openclaw.png" alt="OpenClaw" width="80"/>
  </p>
  
  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)
  
  [🚀 Quick Start](#-quick-start) • [💡 Features](#-key-features) • [📖 Setup](#-setup-guide) • [🌐 Website](https://9router.com)
</div>

---

## 🤔 Why 9Router?

**Stop wasting money and hitting limits:**

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Expensive APIs ($20-50/month per provider)
- ❌ Manual switching between providers

**9Router solves this:**

- ✅ **Maximize subscriptions** - Track quota, use every bit before reset
- ✅ **Auto fallback** - Subscription → Cheap → Free, zero downtime
- ✅ **Multi-account** - Round-robin between accounts per provider
- ✅ **Universal** - Works with Claude Code, Codex, Gemini CLI, Cursor, Cline, any CLI tool

---

## 🔄 How It Works

```
┌─────────────┐
│  Your CLI   │  (Claude Code, Codex, Gemini CLI, OpenClaw, Cursor, Cline...)
│   Tool      │
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌─────────────────────────────────────────┐
│           9Router (Smart Router)        │
│  • Format translation (OpenAI ↔ Claude) │
│  • Quota tracking                       │
│  • Auto token refresh                   │
└──────┬──────────────────────────────────┘
       │
       ├─→ [Tier 1: SUBSCRIPTION] Claude Code, Codex, Gemini CLI
       │   ↓ quota exhausted
       ├─→ [Tier 2: CHEAP] GLM ($0.6/1M), MiniMax ($0.2/1M)
       │   ↓ budget limit
       └─→ [Tier 3: FREE] iFlow, Qwen, Kiro (unlimited)

Result: Never stop coding, minimal cost
```

---

## ⚡ Quick Start

**1. Install globally:**

```bash
npm install -g 9router
9router
```

🎉 Dashboard opens at `http://localhost:20128`

**2. Connect a FREE provider (no signup needed):**

Dashboard → Providers → Connect **Claude Code** or **Antigravity** → OAuth login → Done!

**3. Use in your CLI tool:**

```
Claude Code/Codex/Gemini CLI/OpenClaw/Cursor/Cline Settings:
  Endpoint: http://localhost:20128/v1
  API Key: [copy from dashboard]
  Model: if/kimi-k2-thinking
```

**That's it!** Start coding with FREE AI models.

**Alternative: run from source (this repository):**

This repository package is private (`9router-app`), so source/Docker execution is the expected local development path.

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

Production mode:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

Default URLs:
- Dashboard: `http://localhost:20128/dashboard`
- OpenAI-compatible API: `http://localhost:20128/v1`

---

## 💡 Key Features

| Feature | What It Does | Why It Matters |
|---------|--------------|----------------|
| 🎯 **Smart 3-Tier Fallback** | Auto-route: Subscription → Cheap → Free | Never stop coding, zero downtime |
| 📊 **Real-Time Quota Tracking** | Live token count + reset countdown | Maximize subscription value |
| 🔄 **Format Translation** | OpenAI ↔ Claude ↔ Gemini seamless | Works with any CLI tool |
| 👥 **Multi-Account Support** | Multiple accounts per provider | Load balancing + redundancy |
| 🔄 **Auto Token Refresh** | OAuth tokens refresh automatically | No manual re-login needed |
| 🎨 **Custom Combos** | Create unlimited model combinations | Tailor fallback to your needs |
| 📝 **Request Logging** | Debug mode with full request/response logs | Troubleshoot issues easily |
| 💾 **Cloud Sync** | Sync config across devices | Same setup everywhere |
| 📊 **Usage Analytics** | Track tokens, cost, trends over time | Optimize spending |
| 🌐 **Deploy Anywhere** | Localhost, VPS, Docker, Cloudflare Workers | Flexible deployment options |

<details>
<summary><b>📖 Feature Details</b></summary>

### 🎯 Smart 3-Tier Fallback

Create combos with automatic fallback:

```
Combo: "my-coding-stack"
  1. cc/claude-opus-4-6        (your subscription)
  2. glm/glm-4.7               (cheap backup, $0.6/1M)
  3. if/kimi-k2-thinking       (free fallback)

→ Auto switches when quota runs out or errors occur
```

### 📊 Real-Time Quota Tracking

- Token consumption per provider
- Reset countdown (5-hour, daily, weekly)
- Cost estimation for paid tiers
- Monthly spending reports

### 🔄 Format Translation

Seamless translation between formats:
- **OpenAI** ↔ **Claude** ↔ **Gemini** ↔ **OpenAI Responses**
- Your CLI tool sends OpenAI format → 9Router translates → Provider receives native format
- Works with any tool that supports custom OpenAI endpoints

### 👥 Multi-Account Support

- Add multiple accounts per provider
- Auto round-robin or priority-based routing
- Fallback to next account when one hits quota

### 🔄 Auto Token Refresh

- OAuth tokens automatically refresh before expiration
- No manual re-authentication needed
- Seamless experience across all providers

### 🎨 Custom Combos

- Create unlimited model combinations
- Mix subscription, cheap, and free tiers
- Name your combos for easy access
- Share combos across devices with Cloud Sync

### 📝 Request Logging

- Enable debug mode for full request/response logs
- Track API calls, headers, and payloads
- Troubleshoot integration issues
- Export logs for analysis

### 💾 Cloud Sync

- Sync providers, combos, and settings across devices
- Automatic background sync
- Secure encrypted storage
- Access your setup from anywhere

#### Cloud Runtime Notes

- Prefer server-side cloud variables in production:
  - `BASE_URL` (internal callback URL used by sync scheduler)
  - `CLOUD_URL` (cloud sync endpoint base)
- `NEXT_PUBLIC_BASE_URL` and `NEXT_PUBLIC_CLOUD_URL` are still supported for compatibility/UI, but server runtime now prioritizes `BASE_URL`/`CLOUD_URL`.
- Cloud sync requests now use timeout + fail-fast behavior to avoid UI hanging when cloud DNS/network is unavailable.

### 📊 Usage Analytics

- Track token usage per provider and model
- Cost estimation and spending trends
- Monthly reports and insights
- Optimize your AI spending

### 🌐 Deploy Anywhere

- 💻 **Localhost** - Default, works offline
- ☁️ **VPS/Cloud** - Share across devices
- 🐳 **Docker** - One-command deployment
- 🚀 **Cloudflare Workers** - Global edge network

</details>

---

## 💰 Pricing at a Glance

| Tier | Provider | Cost | Quota Reset | Best For |
|------|----------|------|-------------|----------|
| **💳 SUBSCRIPTION** | Claude Code (Pro) | $20/mo | 5h + weekly | Already subscribed |
| | Codex (Plus/Pro) | $20-200/mo | 5h + weekly | OpenAI users |
| | Gemini CLI | **FREE** | 180K/mo + 1K/day | Everyone! |
| | GitHub Copilot | $10-19/mo | Monthly | GitHub users |
| **💰 CHEAP** | GLM-4.7 | $0.6/1M | Daily 10AM | Budget backup |
| | MiniMax M2.1 | $0.2/1M | 5-hour rolling | Cheapest option |
| | Kimi K2 | $9/mo flat | 10M tokens/mo | Predictable cost |
| **🆓 FREE** | iFlow | $0 | Unlimited | 8 models free |
| | Qwen | $0 | Unlimited | 3 models free |
| | Kiro | $0 | Unlimited | Claude free |

**💡 Pro Tip:** Start with Gemini CLI (180K free/month) + iFlow (unlimited free) combo = $0 cost!

---

## 🎯 Use Cases

### Case 1: "I have Claude Pro subscription"

**Problem:** Quota expires unused, rate limits during heavy coding

**Solution:**
```
Combo: "maximize-claude"
  1. cc/claude-opus-4-6        (use subscription fully)
  2. glm/glm-4.7               (cheap backup when quota out)
  3. if/kimi-k2-thinking       (free emergency fallback)

Monthly cost: $20 (subscription) + ~$5 (backup) = $25 total
vs. $20 + hitting limits = frustration
```

### Case 2: "I want zero cost"

**Problem:** Can't afford subscriptions, need reliable AI coding

**Solution:**
```
Combo: "free-forever"
  1. gc/gemini-3-flash         (180K free/month)
  2. if/kimi-k2-thinking       (unlimited free)
  3. qw/qwen3-coder-plus       (unlimited free)

Monthly cost: $0
Quality: Production-ready models
```

### Case 3: "I need 24/7 coding, no interruptions"

**Problem:** Deadlines, can't afford downtime

**Solution:**
```
Combo: "always-on"
  1. cc/claude-opus-4-6        (best quality)
  2. cx/gpt-5.2-codex          (second subscription)
  3. glm/glm-4.7               (cheap, resets daily)
  4. minimax/MiniMax-M2.1      (cheapest, 5h reset)
  5. if/kimi-k2-thinking       (free unlimited)

Result: 5 layers of fallback = zero downtime
Monthly cost: $20-200 (subscriptions) + $10-20 (backup)
```

### Case 4: "I want FREE AI in OpenClaw"

**Problem:** Need AI assistant in messaging apps (WhatsApp, Telegram, Slack...), completely free

**Solution:**
```
Combo: "openclaw-free"
  1. if/glm-4.7                (unlimited free)
  2. if/minimax-m2.1           (unlimited free)
  3. if/kimi-k2-thinking       (unlimited free)

Monthly cost: $0
Access via: WhatsApp, Telegram, Slack, Discord, iMessage, Signal...
```

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
  cc/claude-opus-4-6
  cc/claude-sonnet-4-5-20250929
  cc/claude-haiku-4-5-20251001
```

**Pro Tip:** Use Opus for complex tasks, Sonnet for speed. 9Router tracks quota per model!

### OpenAI Codex (Plus/Pro)

```bash
Dashboard → Providers → Connect Codex
→ OAuth login (port 1455)
→ 5-hour + weekly reset

Models:
  cx/gpt-5.2-codex
  cx/gpt-5.1-codex-max
```

### Gemini CLI (FREE 180K/month!)

```bash
Dashboard → Providers → Connect Gemini CLI
→ Google OAuth
→ 180K completions/month + 1K/day

Models:
  gc/gemini-3-flash-preview
  gc/gemini-2.5-pro
```

**Best Value:** Huge free tier! Use this before paid tiers.

### GitHub Copilot

```bash
Dashboard → Providers → Connect GitHub
→ OAuth via GitHub
→ Monthly reset (1st of month)

Models:
  gh/gpt-5
  gh/claude-4.5-sonnet
  gh/gemini-3-pro
```

</details>

<details>
<summary><b>💰 Cheap Providers (Backup)</b></summary>

### GLM-4.7 (Daily reset, $0.6/1M)

1. Sign up: [Zhipu AI](https://open.bigmodel.cn/)
2. Get API key from Coding Plan
3. Dashboard → Add API Key:
   - Provider: `glm`
   - API Key: `your-key`

**Use:** `glm/glm-4.7`

**Pro Tip:** Coding Plan offers 3× quota at 1/7 cost! Reset daily 10:00 AM.

### MiniMax M2.1 (5h reset, $0.20/1M)

1. Sign up: [MiniMax](https://www.minimax.io/)
2. Get API key
3. Dashboard → Add API Key

**Use:** `minimax/MiniMax-M2.1`

**Pro Tip:** Cheapest option for long context (1M tokens)!

### Kimi K2 ($9/month flat)

1. Subscribe: [Moonshot AI](https://platform.moonshot.ai/)
2. Get API key
3. Dashboard → Add API Key

**Use:** `kimi/kimi-latest`

**Pro Tip:** Fixed $9/month for 10M tokens = $0.90/1M effective cost!

</details>

<details>
<summary><b>🆓 FREE Providers (Emergency Backup)</b></summary>

### iFlow (8 FREE models)

```bash
Dashboard → Connect iFlow
→ iFlow OAuth login
→ Unlimited usage

Models:
  if/kimi-k2-thinking
  if/qwen3-coder-plus
  if/glm-4.7
  if/minimax-m2
  if/deepseek-r1
```

### Qwen (3 FREE models)

```bash
Dashboard → Connect Qwen
→ Device code authorization
→ Unlimited usage

Models:
  qw/qwen3-coder-plus
  qw/qwen3-coder-flash
```

### Kiro (Claude FREE)

```bash
Dashboard → Connect Kiro
→ AWS Builder ID or Google/GitHub
→ Unlimited usage

Models:
  kr/claude-sonnet-4.5
  kr/claude-haiku-4.5
```

</details>

<details>
<summary><b>🎨 Create Combos</b></summary>

### Example 1: Maximize Subscription → Cheap Backup

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-4-6 (Subscription primary)
  2. glm/glm-4.7 (Cheap backup, $0.6/1M)
  3. minimax/MiniMax-M2.1 (Cheapest fallback, $0.20/1M)

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
  1. gc/gemini-3-flash-preview (180K free/month)
  2. if/kimi-k2-thinking (unlimited)
  3. qw/qwen3-coder-plus (unlimited)

Cost: $0 forever!
```

</details>

<details>
<summary><b>🔧 CLI Integration</b></summary>

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from 9router dashboard]
  Model: cc/claude-opus-4-6
```

Or use combo: `premium-coding`

### Claude Code

Edit `~/.claude/config.json`:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

### OpenClaw

Edit `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/if/glm-4.7"
      }
    }
  },
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "http://localhost:20128/v1",
        "apiKey": "your-9router-api-key",
        "api": "openai-completions",
        "models": [
          {
            "id": "if/glm-4.7",
            "name": "glm-4.7"
          }
        ]
      }
    }
  }
}
```

**Or use Dashboard:** CLI Tools → OpenClaw → Auto-config

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [from dashboard]
Model: cc/claude-opus-4-6
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

```bash
# Build image (from repository root)
docker build -t 9router .

# Run container (command used in current setup)
docker run -d \
  --name 9router \
  -p 20128:20128 \
  --env-file /root/dev/9router/.env \
  -v 9router-data:/app/data \
  -v 9router-usage:/root/.9router \
  9router
```

Portable command (if you are already at repository root):

```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  --env-file ./.env \
  -v 9router-data:/app/data \
  -v 9router-usage:/root/.9router \
  9router
```

Container defaults:
- `PORT=20128`
- `HOSTNAME=0.0.0.0`

Useful commands:

```bash
docker logs -f 9router
docker restart 9router
docker stop 9router && docker rm 9router
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `9router-default-secret-change-me` | JWT signing secret for dashboard auth cookie (**change in production**) |
| `INITIAL_PASSWORD` | `123456` | First login password when no saved hash exists |
| `DATA_DIR` | `~/.9router` | Main app database location (`db.json`) |
| `PORT` | framework default | Service port (`20128` in examples) |
| `HOSTNAME` | framework default | Bind host (Docker defaults to `0.0.0.0`) |
| `NODE_ENV` | runtime default | Set `production` for deploy |
| `BASE_URL` | `http://localhost:20128` | Server-side internal base URL used by cloud sync jobs |
| `CLOUD_URL` | `https://9router.com` | Server-side cloud sync endpoint base URL |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | Backward-compatible/public base URL (prefer `BASE_URL` for server runtime) |
| `NEXT_PUBLIC_CLOUD_URL` | `https://9router.com` | Backward-compatible/public cloud URL (prefer `CLOUD_URL` for server runtime) |
| `API_KEY_SECRET` | `endpoint-proxy-api-key-secret` | HMAC secret for generated API keys |
| `MACHINE_ID_SALT` | `endpoint-proxy-salt` | Salt for stable machine ID hashing |
| `ENABLE_REQUEST_LOGS` | `false` | Enables request/response logs under `logs/` |
| `AUTH_COOKIE_SECURE` | `false` | Force `Secure` auth cookie (set `true` behind HTTPS reverse proxy) |
| `REQUIRE_API_KEY` | `false` | Enforce Bearer API key on `/v1/*` routes (recommended for internet-exposed deploys) |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | empty | Optional outbound proxy for upstream provider calls |

Notes:
- Lowercase proxy variables are also supported: `http_proxy`, `https_proxy`, `all_proxy`, `no_proxy`.
- `.env` is not baked into Docker image (`.dockerignore`); inject runtime config with `--env-file` or `-e`.
- On Windows, `APPDATA` can be used for local storage path resolution.
- `INSTANCE_NAME` appears in older docs/env templates, but is currently not used at runtime.

### Runtime Files and Storage

- Main app state: `${DATA_DIR}/db.json` (providers, combos, aliases, keys, settings), managed by `src/lib/localDb.js`.
- Usage history and logs: `~/.9router/usage.json` and `~/.9router/log.txt`, managed by `src/lib/usageDb.js`.
- Optional request/translator logs: `<repo>/logs/...` when `ENABLE_REQUEST_LOGS=true`.
- Usage storage currently follows `~/.9router` path logic and is independent from `DATA_DIR`.

</details>

---

## 📊 Available Models

<details>
<summary><b>View all available models</b></summary>

**Claude Code (`cc/`)** - Pro/Max:
- `cc/claude-opus-4-6`
- `cc/claude-sonnet-4-5-20250929`
- `cc/claude-haiku-4-5-20251001`

**Codex (`cx/`)** - Plus/Pro:
- `cx/gpt-5.2-codex`
- `cx/gpt-5.1-codex-max`

**Gemini CLI (`gc/`)** - FREE:
- `gc/gemini-3-flash-preview`
- `gc/gemini-2.5-pro`

**GitHub Copilot (`gh/`)**:
- `gh/gpt-5`
- `gh/claude-4.5-sonnet`

**GLM (`glm/`)** - $0.6/1M:
- `glm/glm-4.7`

**MiniMax (`minimax/`)** - $0.2/1M:
- `minimax/MiniMax-M2.1`

**iFlow (`if/`)** - FREE:
- `if/kimi-k2-thinking`
- `if/qwen3-coder-plus`
- `if/deepseek-r1`

**Qwen (`qw/`)** - FREE:
- `qw/qwen3-coder-plus`
- `qw/qwen3-coder-flash`

**Kiro (`kr/`)** - FREE:
- `kr/claude-sonnet-4.5`
- `kr/claude-haiku-4.5`

</details>

---

## 🐛 Troubleshooting

**"Language model did not provide messages"**
- Provider quota exhausted → Check dashboard quota tracker
- Solution: Use combo fallback or switch to cheaper tier

**Rate limiting**
- Subscription quota out → Fallback to GLM/MiniMax
- Add combo: `cc/claude-opus-4-6 → glm/glm-4.7 → if/kimi-k2-thinking`

**OAuth token expired**
- Auto-refreshed by 9Router
- If issues persist: Dashboard → Provider → Reconnect

**High costs**
- Check usage stats in Dashboard
- Switch primary model to GLM/MiniMax
- Use free tier (Gemini CLI, iFlow) for non-critical tasks

**Dashboard opens on wrong port**
- Set `PORT=20128` and `NEXT_PUBLIC_BASE_URL=http://localhost:20128`

**Cloud sync errors**
- Verify `BASE_URL` points to your running instance (example: `http://localhost:20128`)
- Verify `CLOUD_URL` points to your expected cloud endpoint (example: `https://9router.com`)
- Keep `NEXT_PUBLIC_*` values aligned with server-side values when possible.

**Cloud endpoint `stream=false` returns 500 (`Unexpected token 'd'...`)**
- Symptom usually appears on public cloud endpoint (`https://9router.com/v1`) for non-streaming calls.
- Root cause: upstream returns SSE payload (`data: ...`) while client expects JSON.
- Workaround: use `stream=true` for cloud direct calls.
- Local 9Router runtime includes SSE→JSON fallback for non-streaming calls when upstream returns `text/event-stream`.

**Cloud says connected, but request still fails with `Invalid API key`**
- Create a fresh key from local dashboard (`/api/keys`) and run cloud sync (`Enable Cloud` then `Sync Now`).
- Old/non-synced keys can still return `401` on cloud even if local endpoint works.

**First login not working**
- Check `INITIAL_PASSWORD` in `.env`
- If unset, fallback password is `123456`

**No request logs under `logs/`**
- Set `ENABLE_REQUEST_LOGS=true`

---

## 🛠️ Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Next.js 16
- **UI**: React 19 + Tailwind CSS 4
- **Database**: LowDB (JSON file-based)
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
  "model": "cc/claude-opus-4-6",
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

### Compatibility Endpoints

- `POST /v1/chat/completions`
- `POST /v1/messages`
- `POST /v1/responses`
- `GET /v1/models`
- `POST /v1/messages/count_tokens`
- `GET /v1beta/models`
- `POST /v1beta/models/{...path}` (Gemini-style `generateContent`)
- `POST /v1/api/chat` (Ollama-style transform path)

### Cloud Validation Scripts

Added test scripts under `tester/security/`:

- `tester/security/test-docker-hardening.sh`
  - Builds Docker image and validates hardening checks (`/api/cloud/auth` auth guard, `REQUIRE_API_KEY`, secure auth cookie behavior).
- `tester/security/test-cloud-openai-compatible.sh`
  - Sends a direct OpenAI-compatible request to cloud endpoint (`https://9router.com/v1/chat/completions`) with provided model/key.
- `tester/security/test-cloud-sync-and-call.sh`
  - End-to-end flow: create local key -> enable/sync cloud -> call cloud endpoint with retry.
  - Includes fallback check with `stream=true` to distinguish auth errors from non-streaming parse issues.

Security note for cloud test scripts:

- Never hardcode real API keys in scripts/commits.
- Provide keys only via environment variables:
  - `API_KEY`, `CLOUD_API_KEY`, or `OPENAI_API_KEY` (supported by `test-cloud-openai-compatible.sh`)
- Example:

```bash
OPENAI_API_KEY="your-cloud-key" bash tester/security/test-cloud-openai-compatible.sh
```

Expected behavior from recent validation:

- Local runtime (`http://127.0.0.1:20128/v1/chat/completions`): works with `stream=false` and `stream=true`.
- Docker runtime (same API path exposed by container): hardening checks pass, cloud auth guard works, strict API key mode works when enabled.
- Public cloud endpoint (`https://9router.com/v1/chat/completions`):
  - `stream=true`: expected to succeed (SSE chunks returned).
  - `stream=false`: may fail with `500` + parse error (`Unexpected token 'd'`) when upstream returns SSE content to a non-streaming client path.

### Dashboard and Management API

- Auth/settings: `/api/auth/login`, `/api/auth/logout`, `/api/settings`, `/api/settings/require-login`
- Provider management: `/api/providers`, `/api/providers/[id]`, `/api/providers/[id]/test`, `/api/providers/[id]/models`, `/api/providers/validate`, `/api/provider-nodes*`
- OAuth flows: `/api/oauth/[provider]/[action]` (+ provider-specific imports like Cursor/Kiro)
- Routing config: `/api/models/alias`, `/api/combos*`, `/api/keys*`, `/api/pricing`
- Usage/logs: `/api/usage/history`, `/api/usage/logs`, `/api/usage/request-logs`, `/api/usage/[connectionId]`
- Cloud sync: `/api/sync/cloud`, `/api/sync/initialize`, `/api/cloud/*`
- CLI helpers: `/api/cli-tools/claude-settings`, `/api/cli-tools/codex-settings`, `/api/cli-tools/droid-settings`, `/api/cli-tools/openclaw-settings`

### Authentication Behavior

- Dashboard routes (`/dashboard/*`) use `auth_token` cookie protection.
- Login uses saved password hash when present; otherwise it falls back to `INITIAL_PASSWORD`.
- `requireLogin` can be toggled via `/api/settings/require-login`.

### Request Processing (High Level)

1. Client sends request to `/v1/*`.
2. Route handler calls `handleChat` (`src/sse/handlers/chat.js`).
3. Model is resolved (direct provider/model or alias/combo resolution).
4. Credentials are selected from local DB with account availability filtering.
5. `handleChatCore` (`open-sse/handlers/chatCore.js`) detects format and translates request.
6. Provider executor sends upstream request.
7. Stream is translated back to client format when needed.
8. Usage/logging is recorded (`src/lib/usageDb.js`).
9. Fallback applies on provider/account/model errors according to combo rules.

Full architecture reference: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## 📧 Support

- **Website**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)

---

## 👥 Contributors

Thanks to all contributors who helped make 9Router better!

[![Contributors](https://contrib.rocks/image?repo=decolua/9router&max=100&columns=20&anon=1)](https://github.com/decolua/9router/graphs/contributors)

---

## 📊 Star Chart

[![Star Chart](https://starchart.cc/decolua/9router.svg?variant=adaptive)](https://starchart.cc/decolua/9router)

### How to Contribute

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## 🙏 Acknowledgments

Special thanks to **CLIProxyAPI** - the original Go implementation that inspired this JavaScript port.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">
  <sub>Built with ❤️ for developers who code 24/7</sub>
</div>
