# Setup Guide

Detailed setup instructions for 9Router.

---

## Prerequisites

- Node.js v22+ (recommended) or Bun
- npm or bun package manager
- Docker (optional, for containerized deployment)

---

## Quick Start (Global Install)

```bash
# Install globally from npm
npm install -g 9router

# Start the app
9router
```

Dashboard opens at `http://localhost:20128`

---

## Development from Source

```bash
# Clone the repo
git clone git@github.com:diepxuan/9router.git
cd 9router

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Start development server
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

Production build:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

---

## Docker Deployment

```bash
# Build image
docker build -t 9router .

# Run container
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  --name 9router \
  9router
```

Volume mount:

- `$HOME/.9router` on host → `/app/data` in container
- SQLite DB stored at `$HOME/.9router/9router.db`
- Data persists across container restarts

Stop:

```bash
docker stop 9router
```

---

## CapRover Deployment

9Router ships with `captain-definition` for CapRover (Caprover) deployment.

1. Push code to your repo or local directory
2. Connect CapRover to the repo
3. Deploy — CapRover reads `captain-definition` automatically
4. Access via your CapRover domain

---

## Connect a FREE Provider

### Kiro AI (Free Claude, no signup)

1. Open Dashboard → Providers
2. Connect **Kiro AI**
3. Done — unlimited free access

### OpenCode Free (No auth)

1. Open Dashboard → Providers
2. Connect **OpenCode Free**
3. Models auto-fetched — no auth needed

### Vertex AI ($300 free credits)

1. Open Dashboard → Providers
2. Connect **Vertex AI**
3. Follow Google Cloud setup
4. $300 credits for new accounts

---

## Connect an API Key Provider

1. Dashboard → Providers
2. Click **Connect** on desired provider (OpenAI, Anthropic, OpenRouter, GLM, etc.)
3. Paste your API key
4. Test connection
5. Done

---

## Use in CLI Tools

Configure any CLI tool to use 9Router as the endpoint:

```
Claude Code / Codex / OpenClaw / Cursor / Cline:
  Endpoint: http://localhost:20128/v1
  API Key:  [copy from Dashboard → Settings]
  Model:    kr/claude-sonnet-4.5  (or any model via 9Router)
```

### Available model prefixes

| Prefix | Provider |
|--------|----------|
| `kr/` | Kiro |
| `oc/` | OpenCode |
| `vx/` | Vertex |
| `or/` | OpenRouter |
| `gl/` | GLM |
| `km/` | Kimi |
| `mm/` | MiniMax |
| ... | See Dashboard → Models |

---

## RTK Token Saver

RTK is enabled by default. It automatically compresses tool_result content:

- `git diff` output → compressed
- `grep` results → compressed
- `ls`, `tree`, `find` → compressed
- Log deduplication → compressed

Savings: 20-40% input tokens per request.

Toggle in Dashboard → Endpoint settings.

---

## Caveman Mode

Inject caveman-speak prompts to reduce output tokens by up to 65%.

Enable in Dashboard → Endpoint settings → Caveman Mode.

---

## Create a Fallback Combo

1. Dashboard → Combos → New Combo
2. Name your combo (e.g., `my-smart-fallback`)
3. Add models in priority order:
   - Model 1: `kr/claude-sonnet-4.5` (Kiro — free)
   - Model 2: `gl/glm-4-plus` (GLM — cheap)
   - Model 3: `or/claude-sonnet-4.5` (OpenRouter — backup)
4. Save
5. Use model name `my-smart-fallback` in your CLI tool

---

## Cloud Sync

Sync config across devices:

1. Dashboard → Settings → Cloud Sync
2. Enable → generates machine ID
3. Sync pushes providers, aliases, combos, keys
4. On second device: enable with same API key

Note: Local runtime continues even if cloud sync fails.

---

## Tailscale Tunnel

Expose 9Router over Tailscale:

1. Dashboard → Settings → Tunnel
2. Enable Tailscale
3. Status check confirms connectivity
4. Configure transport protocol (UDP/TCP)

---

## MCP Marketplace

1. Dashboard → Cowork Tool Card
2. Open MCP Marketplace Modal
3. Browse available plugins
4. Install/activate plugins
5. Configure per-plugin settings

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 20128 | Server port |
| `HOSTNAME` | localhost | Bind address |
| `NEXT_PUBLIC_BASE_URL` | - | Dashboard base URL |
| `DATA_DIR` | ~/.9router | Database directory |
| `JWT_SECRET` | auto-generated | Dashboard auth |
| `INITIAL_PASSWORD` | 123456 | Default admin password |
| `API_KEY_SECRET` | auto-generated | API key HMAC |
| `MACHINE_ID_SALT` | auto-generated | Machine ID |
| `ENABLE_REQUEST_LOGS` | false | Detailed logging |
| `NEXT_PUBLIC_CLOUD_URL` | - | Cloud sync endpoint |

---

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues.
