# 9Router - FREE AI Router & Token Saver

**Never stop coding. Save 20-40% tokens with RTK + auto-fallback to FREE & cheap AI models.**

**Connect All AI Code Tools (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) to 40+ AI Providers & 100+ Models.**

[![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
[![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
[![Docker Pulls](https://img.shields.io/docker/pulls/decolua/9router.svg?logo=docker&label=Docker%20pulls)](https://hub.docker.com/r/decolua/9router)
[![GHCR](https://img.shields.io/badge/GHCR-decolua%2F9router-blue?logo=github)](https://github.com/decolua/9router/pkgs/container/9router)
[![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)

<a href="https://trendshift.io/repositories/22628" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22628" alt="decolua%2F9router | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[🌐 Website](https://9router.com) • [📖 Full Docs](https://github.com/decolua/9router)

---

## 🤔 Why 9Router?

**Stop wasting money, tokens and hitting limits:**

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls...) burn tokens fast
- ❌ Expensive APIs ($20-50/month per provider)

**9Router solves this:**

- ✅ **RTK Token Saver** - Auto-compress tool_result, save 20-40% tokens
- ✅ **Maximize subscriptions** - Track quota, use every bit before reset
- ✅ **Auto fallback** - Subscription → Cheap → Free, zero downtime
- ✅ **Multi-account** - Round-robin between accounts per provider
- ✅ **Universal** - Works with any OpenAI/Claude-compatible CLI

---

## ⚡ Quick Start

**Option 1 — npm (recommended for desktop):**

```bash
npm install -g 9router
9router

# Or run directly with npx
npx 9router
```

**Option 1b — local source checkout (development):**

```bash
cd /path/ke/9router
npm run build:cli
node cli/cli.js --headless --port 20128
```

If you want `9router` command available in PATH:

```bash
cd /path/ke/9router/cli
npm install -g .
export PATH="$(npm prefix -g)/bin:$PATH"
9router
```

**Option 2 — Docker (server/VPS):**

```bash
docker run -d --name 9router -p 20128:20128 \
  -v "$HOME/.9router:/app/data" -e DATA_DIR=/app/data \
  decolua/9router:latest
```

Published images: [Docker Hub](https://hub.docker.com/r/decolua/9router) • [GHCR](https://github.com/decolua/9router/pkgs/container/9router) (multi-platform amd64/arm64).

🎉 Dashboard opens at `http://localhost:20128`

**2. Connect a FREE provider (no signup needed):**

Dashboard → Providers → Connect **Kiro AI** (free Claude unlimited) or **OpenCode Free** (no auth) → Done!

**3. Use in your CLI tool:**

```
Claude Code/Codex/OpenClaw/Cursor/Cline Settings:
  Endpoint: http://localhost:20128/v1
  API Key:  [copy from dashboard]
  Model:    kr/claude-sonnet-4.5
```

That's it! Start coding with FREE AI models.

---

## 🚀 CLI Options

```bash
9router                    # Start with default settings
9router --port 8080        # Custom port
9router --no-browser       # Don't open browser
9router --headless          # API/CLI only, no dashboard terminal UI
9router --skip-update      # Skip auto-update check
9router --help             # Show all options
```

**Dashboard**: `http://localhost:20128/dashboard`

## 🧩 Headless/CLI API Commands

`9router` now supports direct non-interactive commands for automation:

```bash
9router --headless --host 127.0.0.1 --port 20128
                                 # Flow A: server mode (keeps API process running)

9router --host 127.0.0.1 --port 20128 api-keys list
                                 # Flow B: command mode (requires a running server)
9router api-keys list                # command mode with default host/port
9router api-keys create "ci-token"   # Create API key
9router api-keys usage <id> --period 7d
9router api-keys delete <id>         # Delete API key

# aliases
9router keys list
9router k list

9router providers list                 # List provider connections
9router providers add openrouter <key> # Add API-key provider
9router providers test <id>            # Test provider connection
9router providers models <id>          # Show available models for connection
9router providers delete <id>          # Delete provider connection

9router prov list
9router p list

9router usage key <key_id> --period 30d         # Usage by API key
9router usage connection <provider_connection_id> # Usage from provider connection

9router usage key <key_id>                 # alias command variant
9router u key <key_id>
9router usg connection <provider_connection_id>
```

Common gotcha:

- `List API keys failed: Network error: connect ECONNREFUSED 127.0.0.1:20128`
  means server is not running yet.
  Start one server first in another terminal:

```bash
9router --headless --host 127.0.0.1 --port 20128
```

All commands use the same runtime config as the running server (`--port` / `--host` flags can be passed).

Detailed examples and quick scripts are available in [CLI Headless API Guide](CLI_HEADLESS.md).

---

## 🛠️ Supported CLI Tools

Claude-Code • OpenClaw • Codex • OpenCode • Cursor • Antigravity • Cline • Continue • Droid • Roo • Copilot • Kilo Code • Gemini CLI • Qwen Code • iFlow • Crush • Crusher • Aider

Any tool supporting OpenAI/Claude-compatible API works.

---

## 💾 Data Location

- **macOS/Linux**: `~/.9router/db/data.sqlite`
- **Windows**: `%APPDATA%/9router/db/data.sqlite`
- **Docker**: `/app/data/db/data.sqlite` (mount `$HOME/.9router` to persist)

---

## 📚 Documentation

Full docs, advanced setup, video tutorials & development guide:

- **GitHub**: https://github.com/decolua/9router
- **Full README**: https://github.com/decolua/9router/blob/main/app/README.md
- **Website**: https://9router.com

---

## 🙏 Acknowledgments

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** - Original Go implementation

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
