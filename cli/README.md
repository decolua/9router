# 10router - FREE AI Router & Token Saver

**Never stop coding. Save 20-40% tokens with RTK + auto-fallback to FREE & cheap AI models.**

**Connect All AI Code Tools (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) to 40+ AI Providers & 100+ Models.**

[![npm](https://img.shields.io/npm/v/10router.svg)](https://www.npmjs.com/package/10router)
[![Downloads](https://img.shields.io/npm/dm/10router.svg)](https://www.npmjs.com/package/10router)
[![Docker Pulls](https://img.shields.io/docker/pulls/some-du6e/10router.svg?logo=docker&label=Docker%20pulls)](https://hub.docker.com/r/some-du6e/10router)
[![GHCR](https://img.shields.io/badge/GHCR-some-du6e%2F10router-blue?logo=github)](https://github.com/some-du6e/10router/pkgs/container/10router)
[![License](https://img.shields.io/npm/l/10router.svg)](https://github.com/some-du6e/10router/blob/main/LICENSE)

<a href="https://trendshift.io/repositories/22628" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22628" alt="some-du6e%2F10router | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[📖 Full Docs](https://github.com/some-du6e/10router)

---

## 🤔 Why 10router?

**Stop wasting money, tokens and hitting limits:**

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls...) burn tokens fast
- ❌ Expensive APIs ($20-50/month per provider)

**10router solves this:**

- ✅ **RTK Token Saver** - Auto-compress tool_result, save 20-40% tokens
- ✅ **Maximize subscriptions** - Track quota, use every bit before reset
- ✅ **Auto fallback** - Subscription → Cheap → Free, zero downtime
- ✅ **Multi-account** - Round-robin between accounts per provider
- ✅ **Universal** - Works with any OpenAI/Claude-compatible CLI

---

## ⚡ Quick Start

**Option 1 — npm (recommended for desktop):**

```bash
npm install -g 10router
10router

# Or run directly with npx
npx 10router
```

**Option 2 — Docker (server/VPS):**

```bash
docker run -d --name 10router -p 20128:20128 \
  -v "$HOME/.9router:/app/data" -e DATA_DIR=/app/data \
  some-du6e/10router:latest
```

Published images: [Docker Hub](https://hub.docker.com/r/some-du6e/10router) • [GHCR](https://github.com/some-du6e/10router/pkgs/container/10router) (multi-platform amd64/arm64).

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
10router                   # Start with default settings
10router --port 8080        # Custom port
10router --no-browser       # Don't open browser
10router --skip-update      # Skip auto-update check
10router --help             # Show all options
```

**Dashboard**: `http://localhost:20128/dashboard`

---

## 🛠️ Supported CLI Tools

Claude-Code • OpenClaw • Codex • OpenCode • Cursor • Antigravity • Cline • Continue • Droid • Roo • Copilot • Kilo Code • Gemini CLI • Qwen Code • iFlow • Crush • Crusher • Aider

Any tool supporting OpenAI/Claude-compatible API works.

---

## 💾 Data Location

- **macOS/Linux**: `~/.9router/db/data.sqlite`
- **Windows**: `%APPDATA%/9router/db/data.sqlite`
- **Docker**: `/app/data/db/data.sqlite` (mount `$HOME/.9router` to persist)

> The `.9router` directory name is retained for compatibility with existing installs — it was deliberately not renamed with the 10router rebrand.

---

## 📚 Documentation

Full docs, advanced setup, video tutorials & development guide:

- **GitHub**: https://github.com/some-du6e/10router
- **Full README**: https://github.com/some-du6e/10router/blob/master/README.md

---

## 🙏 Acknowledgments

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** - Original Go implementation

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
