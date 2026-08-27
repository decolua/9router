<div align="center">
  <img src="./images/9router.png?1" alt="9Router Dashboard" width="800"/>

  # 9Router

  **Universal AI Model Router & Token Saver for Developers**

  Never hit rate limits again. Save 20–40% tokens with RTK, maximize your subscriptions, and auto-fallback to cheap or free models.

  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![Docker Pulls](https://img.shields.io/docker/pulls/decolua/9router.svg?logo=docker&label=Docker%20pulls)](https://hub.docker.com/r/decolua/9router)
  [![GHCR](https://img.shields.io/badge/GHCR-decolua%2F9router-blue?logo=github)](https://github.com/decolua/9router/pkgs/container/9router)
  [![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)

  <a href="https://trendshift.io/repositories/22628" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22628" alt="decolua%2F9router | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

  [🚀 Quick Start](#-quick-start) • [✨ Key Features](#-key-features) • [🔌 Connect Tools](#-connect-your-cli-tools) • [🌐 Website](https://9router.com)

  [🇧🇷 Português](./i18n/README.pt-BR.md) • [🇻🇳 Tiếng Việt](./i18n/README.vi.md) • [🇨🇳 中文](./README.zh-CN.md) • [🇯🇵 日本語](./i18n/README.ja-JP.md) • [🇷🇺 Русский](./i18n/README.ru.md) • [🇹🇭 ไทย](./i18n/README.th.md) • [🇮🇷 فارسی](./i18n/README.fa_IR.md) • [🇮🇩 Indonesia](./i18n/README.id-ID.md) • [🇪🇸 Español](./i18n/README.es.md) • [🇫🇷 Français](./i18n/README.fr.md)
</div>

---

## 💡 What is 9Router?

9Router is a local AI gateway that sits between your favorite coding tools (Claude Code, Cursor, Codex, OpenClaw, Cline, Roo) and AI model providers.

- 🗜️ **Save 20–40% tokens**: Built-in RTK automatically compresses bulky CLI tool results (`git diff`, `grep`, `ls`, logs).
- 🔄 **Zero downtime**: Automatic 3-tier fallback (Subscription → Ultra-cheap → Free).
- 📊 **Track quota in real-time**: Monitor 5-hour rolling limits and reset countdowns across providers.
- 🔌 **Universal format translator**: Seamless OpenAI ↔ Anthropic ↔ Gemini translation on a single endpoint.

---

## 🔄 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Your CLI Tools (Claude Code, Cursor, Codex, OpenClaw, Cline) │
└──────────────────────────────┬──────────────────────────────┘
                               │ http://localhost:20128/v1
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                           9Router                           │
│  • RTK Token Compression  • Protocol Translation (OpenAI/Claude)
│  • Quota Tracking         • Multi-Account Load Balancing    │
└──────────────┬──────────────────────┬───────────────────────┘
               │                      │
       [ Tier 1: Subscriptions ]     [ Tier 2: Cheap ]       [ Tier 3: Free / Fallback ]
       • Claude Code (Pro/Max)        • GLM ($0.6/1M)         • Kiro AI (Claude/GLM/MiniMax)
       • OpenAI Codex (Plus/Pro)      • MiniMax ($0.2/1M)     • OpenCode Free (no auth)
       • GitHub Copilot / Cursor      • Kimi ($9/mo)          • Vertex AI ($300 credits)
```

---

## ⚡ Quick Start

### 1. Run 9Router

**Using npm (Desktop):**
```bash
npm install -g 9router
9router
```

**Using Docker (Server / VPS):**
```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  decolua/9router:latest
```

**From source (Local development):**
```bash
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run dev
```

Dashboard is live at **`http://localhost:20128`** (Default password: `123456`).

---

### 2. Connect a Provider

Open `http://localhost:20128` → **Providers**:
- **Free option:** Connect **Kiro AI** (Claude 4.5 & GLM-5 free credits) or **OpenCode Free** (no login required).
- **Subscription option:** Connect your **Claude Code**, **Codex**, or **GitHub Copilot** via OAuth.
- **Cheap API key:** Add **GLM** ($0.60/1M) or **MiniMax** ($0.20/1M) keys.

---

### 3. Point Your Coding Tool

Set the endpoint in your tool settings to `http://localhost:20128/v1`:

| Tool | Configuration |
|---|---|
| **Claude Code** | Set `ANTHROPIC_BASE_URL="http://localhost:20128/v1"` in `~/.bashrc` / `~/.zshrc` |
| **OpenAI Codex** | Set `OPENAI_BASE_URL="http://localhost:20128/v1"` and `OPENAI_API_KEY="sk_9router"` |
| **Cursor** | Settings → Models → OpenAI Base URL: `http://localhost:20128/v1` |
| **Cline / Roo** | Provider: `OpenAI Compatible`, Base URL: `http://localhost:20128/v1` |
| **OpenClaw** | Use Dashboard → CLI Tools → OpenClaw → Apply (or `http://127.0.0.1:20128/v1`) |

---

## 🏷️ Model Prefix Guide

Select any upstream model using standard prefixes:

| Prefix | Provider | Top Models | Notes |
|---|---|---|---|
| `cc/` | Claude Code | `cc/claude-opus-4-7`, `cc/claude-sonnet-4-6` | Uses your Claude subscription |
| `cx/` | OpenAI Codex | `cx/gpt-5.5`, `cx/gpt-5.4`, `cx/gpt-5.3-codex` | Uses your ChatGPT Plus/Pro subscription |
| `gh/` | GitHub Copilot | `gh/gpt-5.4`, `gh/claude-opus-4.7` | Uses your Copilot subscription |
| `cu/` | Cursor | `cu/claude-4.6-opus-max`, `cu/gpt-5.3-codex` | Cursor account routing |
| `kr/` | Kiro AI | `kr/claude-sonnet-4.5`, `kr/glm-5`, `kr/MiniMax-M2.5` | Free quota available |
| `glm/` | GLM (Zhipu) | `glm/glm-5.1`, `glm/glm-4.7` | ~$0.60 / 1M input tokens |
| `minimax/` | MiniMax | `minimax/MiniMax-M2.7`, `minimax/MiniMax-M2.5` | ~$0.20 / 1M input tokens |
| `vertex/` | Google Vertex | `vertex/gemini-3.1-pro-preview` | GCP credits / Vertex AI Studio |
| `oc/` | OpenCode Free | Auto-fetched from catalog | Free no-auth models |

---

## ✨ Key Features

- 🚀 **RTK Compression**: Peeks command output in tool results (`git diff`, `grep`, `ls`, etc.) and losslessly compresses before LLM ingestion.
- 🔀 **Custom Combos**: Build chained fallbacks like `cc/claude-opus-4-7 → glm/glm-5.1 → kr/claude-sonnet-4.5`.
- 👥 **Multi-Account Load Balancing**: Add multiple accounts for the same provider; 9Router balances requests across them.
- ⏳ **Live Quota Countdown**: Accurately track 5-hour rolling windows, daily resets, and monthly limits.
- 🧠 **Caveman & Ponytail Modes**: Optional prompt injections to minimize output tokens and enforce YAGNI-clean coding.
- 🔒 **Local & Private**: Runs locally on your machine with SQLite storage at `~/.9router/db/data.sqlite`.

---

## ⚙️ Key Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `20128` | Server listening port |
| `DATA_DIR` | `~/.9router` | SQLite database and config storage directory |
| `INITIAL_PASSWORD` | `123456` | Initial dashboard password |
| `JWT_SECRET` | Auto-generated | Session signing key (set your own in production) |
| `ENABLE_REQUEST_LOGS`| `false` | Enable full payload logs in `logs/` for debugging |
| `REQUIRE_API_KEY` | `false` | Enforce API key validation on `/v1/*` |

---

## 💰 Billing Transparency

- **9Router is 100% free and open source.** It never charges you.
- **Dashboard costs are estimations only**, displaying what requests would cost at standard API rates to show your savings.
- You pay providers directly for their services (or use free tiers at $0).

---

## 📚 Community & Support

- 📖 **Documentation**: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) • [DOCKER.md](./DOCKER.md)
- 🐛 **Issue Tracker**: [GitHub Issues](https://github.com/decolua/9router/issues)
- 🌐 **Website**: [9router.com](https://9router.com)
- 👥 **Forks**: [OmniRoute](https://github.com/diegosouzapw/OmniRoute) (TypeScript edition)

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
