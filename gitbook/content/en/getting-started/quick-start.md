# Quick Start

Get 9Router running in under 2 minutes and start routing requests.

---

## 1. Install & Launch

```bash
npm install -g 9router
9router
```

The dashboard opens automatically at `http://localhost:20128` (Default password: `123456`).

---

## 2. Connect a Provider

In the dashboard, go to **Providers**:

- **Free Option**: Click **Connect Kiro AI** (sign in via AWS Builder ID or Google for free Claude & GLM credits) or **OpenCode Free** (no auth required).
- **Subscription Option**: Click **Connect** for Claude Code, OpenAI Codex, or GitHub Copilot.
- **API Key Option**: Click **Add API Key** for GLM ($0.60/1M) or MiniMax ($0.20/1M).

---

## 3. Configure Your Coding Tool

Point your AI tool to the 9Router endpoint (`http://localhost:20128/v1`):

### Claude Code
Add to `~/.zshrc` or `~/.bashrc`:
```bash
export ANTHROPIC_BASE_URL="http://localhost:20128/v1"
```

### OpenAI Codex CLI
```bash
export OPENAI_BASE_URL="http://localhost:20128/v1"
export OPENAI_API_KEY="sk_9router"
```

### Cursor
In **Settings → Models → OpenAI Base URL**, set `http://localhost:20128/v1`.

### Cline / Roo Code
In settings, select **OpenAI Compatible** provider:
- Base URL: `http://localhost:20128/v1`
- Model: `cc/claude-opus-4-7` (or any model/combo name)

### OpenClaw
Open Dashboard → **CLI Tools** → **OpenClaw** → Select your preferred model → **Apply**.

---

## 4. Model Naming Cheat Sheet

| Prefix | Provider | Example Model |
|---|---|---|
| `cc/` | Claude Code | `cc/claude-opus-4-7` |
| `cx/` | OpenAI Codex | `cx/gpt-5.5` |
| `gh/` | GitHub Copilot | `gh/gpt-5.4` |
| `cu/` | Cursor | `cu/claude-4.6-opus-max` |
| `kr/` | Kiro AI | `kr/claude-sonnet-4.5` |
| `glm/` | GLM | `glm/glm-5.1` |
| `minimax/` | MiniMax | `minimax/MiniMax-M2.7` |
| `vertex/` | Google Vertex | `vertex/gemini-3.1-pro-preview` |
| `oc/` | OpenCode Free | Auto-fetched |

---

## 5. Next Steps

- [Installation Options](./installation.md) — Docker and source install guides.
- [Create Custom Combos](../features/combos.md) — Set up multi-tier automatic fallback chains.
- [Quota Tracking](../features/quota-tracking.md) — Monitor real-time limits and reset timers.
