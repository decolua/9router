# Getting Started

Get 9Router running in 5 minutes and start routing AI requests intelligently.

---

## Quick Start

### 1. Install

```bash
npm install -g 9router
```

**Requirements:** Node.js 20+ ([Installation details](getting-started/installation.md))

### 2. Start

```bash
9router
```

🎉 **Dashboard opens automatically** at `http://localhost:20128`

- Default password: `123456` (change in dashboard)
- API key generated automatically
- Ready to connect providers

### 3. Connect Providers

You have 3 ways to connect providers:

#### Option A: OAuth (Subscription Providers)

**Best for:** Claude Code, Codex, Gemini CLI, GitHub Copilot

```
Dashboard → Providers → Connect [Provider]
→ OAuth login → Auto token refresh
→ Quota tracking enabled
```

**Example: Claude Code**
1. Click "Connect Claude Code"
2. Login with your Claude account
3. Authorize 9Router
4. ✅ Done! Use model: `cc/claude-opus-4-5-20251101`

#### Option B: API Key (Cheap Providers)

**Best for:** GLM, MiniMax, Kimi, OpenRouter

```
Dashboard → Providers → Add API Key
→ Select provider
→ Paste API key
→ Save
```

**Example: GLM-4.7**
1. Sign up at [Zhipu AI](https://open.bigmodel.cn/)
2. Get API key from Coding Plan
3. Dashboard → Add API Key → Provider: `glm` → Paste key
4. ✅ Done! Use model: `glm/glm-4.7`

#### Option C: Free Providers (No Cost)

**Best for:** iFlow, Qwen, Kiro

```
Dashboard → Providers → Connect [Free Provider]
→ Device code or OAuth
→ Unlimited usage
```

**Example: iFlow**
1. Click "Connect iFlow"
2. Login with iFlow account
3. Authorize
4. ✅ Done! Use 8 models: `if/kimi-k2-thinking`, `if/qwen3-coder-plus`, etc.

---

## 4. Use in CLI Tools

Point your coding tool to 9Router:

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from 9router dashboard]
  Model: cc/claude-opus-4-5-20251101
```

### Claude Desktop

Edit `~/.claude/config.json`:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [from dashboard]
Model: cc/claude-opus-4-5-20251101
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

---

## 5. Create Smart Combos (Optional)

Combos enable automatic fallback between models:

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-4-5-20251101 (Subscription primary)
  2. glm/glm-4.7 (Cheap backup, $0.6/1M)
  3. if/kimi-k2-thinking (Free fallback)

Use in CLI: premium-coding
```

**How it works:**
1. Tries Claude Opus first (your subscription)
2. If quota exhausted → GLM-4.7 (ultra-cheap)
3. If budget limit → iFlow (free)
4. Zero downtime, automatic switching!

---

## Available Models

### Subscription Models (Maximize First)

**Claude Code (`cc/`)** - Pro/Max subscription:
- `cc/claude-opus-4-5-20251101` - Claude 4.5 Opus
- `cc/claude-sonnet-4-5-20250929` - Claude 4.5 Sonnet
- `cc/claude-haiku-4-5-20251001` - Claude 4.5 Haiku

**Codex (`cx/`)** - Plus/Pro subscription:
- `cx/gpt-5.2-codex` - GPT 5.2 Codex
- `cx/gpt-5.1-codex-max` - GPT 5.1 Codex Max

**Gemini CLI (`gc/`)** - FREE 180K/month:
- `gc/gemini-3-flash-preview` - Gemini 3 Flash Preview
- `gc/gemini-2.5-pro` - Gemini 2.5 Pro

**GitHub Copilot (`gh/`)** - Subscription:
- `gh/gpt-5` - GPT-5
- `gh/claude-4.5-sonnet` - Claude 4.5 Sonnet

### Cheap Models (Backup)

**GLM (`glm/`)** - $0.6/$2.2 per 1M:
- `glm/glm-4.7` - GLM 4.7 (daily reset 10AM)

**MiniMax (`minimax/`)** - $0.20/$1.00 per 1M:
- `minimax/MiniMax-M2.1` - MiniMax M2.1 (5h reset)

**Kimi (`kimi/`)** - $9/month (10M tokens):
- `kimi/kimi-latest` - Kimi Latest

### FREE Models (Emergency)

**iFlow (`if/`)** - 8 models FREE:
- `if/kimi-k2-thinking` - Kimi K2 Thinking
- `if/qwen3-coder-plus` - Qwen3 Coder Plus
- `if/glm-4.7` - GLM 4.7
- `if/deepseek-r1` - DeepSeek R1

**Qwen (`qw/`)** - 3 models FREE:
- `qw/qwen3-coder-plus` - Qwen3 Coder Plus
- `qw/qwen3-coder-flash` - Qwen3 Coder Flash

**Kiro (`kr/`)** - 2 models FREE:
- `kr/claude-sonnet-4.5` - Claude Sonnet 4.5
- `kr/claude-haiku-4.5` - Claude Haiku 4.5

---

## Cost Optimization Strategy

### Monthly Budget: $10-20/month

```
1. Use Gemini CLI free tier (180K/month) for quick tasks
2. Use Claude Code subscription quota fully (you already pay)
3. Fallback to GLM ($0.6/1M) when quota out
4. Emergency: MiniMax M2.1 ($0.20/1M) or iFlow (free)

Real example (100M tokens/month):
  60M via Gemini CLI: $0 (free tier)
  30M via Claude Code: $0 (subscription you already have)
  8M via GLM: $4.80
  2M via MiniMax: $0.40
  Total: $5.20/month + existing subscriptions
```

### Quota Reset Strategy

```
Daily routine:
1. Morning: Fresh Claude Code quota (5h reset)
2. Afternoon: Switch to Gemini CLI (1K/day)
3. Evening: GLM daily quota (reset 10AM next day)
4. Late night: MiniMax (5h rolling) or iFlow (free)

→ Code 24/7 with minimal extra cost!
```

---

## Next Steps

- [Installation Details](getting-started/installation.md) - Requirements, troubleshooting
- [Features](features/) - Explore quota tracking, combos, deployment
- [FAQ](faq.md) - Common questions and answers
- [Troubleshooting](troubleshooting.md) - Fix common issues

---

## Need Help?

- **Website**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
