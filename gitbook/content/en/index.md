# Welcome to 9Router

**Use Claude, Codex, Gemini for FREE • Ultra-cheap alternatives from $0.20/1M tokens**

9Router is an AI model router that maximizes your subscription value and minimizes costs through intelligent routing and automatic fallback.

---

## What is 9Router?

9Router is a smart proxy that sits between your coding tools (Cursor, Cline, Claude Desktop) and AI providers. It automatically routes requests to the best available model based on quota, cost, and availability.

**Stop wasting money:**
- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Expensive APIs ($20-50/month per provider)
- ❌ Manual switching between providers

**Start maximizing value:**
- ✅ **Maximize Subscriptions** - Track and use every bit of Claude Code, Codex, Gemini quota
- ✅ **FREE Available** - Access iFlow, Qwen, Kiro models via CLI
- ✅ **Ultra-Cheap Backup** - GLM ($0.6/1M), MiniMax M2.1 ($0.20/1M)
- ✅ **Smart Fallback** - Subscription → Cheap → Free, automatic switching

---

## Key Features

### 🔄 Smart 3-Tier Fallback

```
Setup once, never stop coding:

Tier 1 (SUBSCRIPTION): Claude Code → Codex → Gemini
  ↓ quota exhausted
Tier 2 (CHEAP): GLM-4.7 → MiniMax M2.1 → Kimi
  ↓ budget limit
Tier 3 (FREE): iFlow → Qwen → Kiro

→ Automatic switching, zero downtime!
```

### 📊 Quota Tracking

- Real-time token consumption per provider
- Reset countdown (5-hour, daily, weekly, monthly)
- Cost estimation for paid tiers
- Monthly spending reports

### 🎯 Universal CLI Support

Works with any tool that supports custom OpenAI endpoints:

✅ **Cursor** • **Cline** • **Claude Desktop** • **Codex** • **RooCode** • **Continue** • **Any OpenAI-compatible tool**

### 💰 Cost Optimization

**Real example (100M tokens/month):**
```
60M via Gemini CLI: $0 (free tier)
30M via Claude Code: $0 (subscription you already have)
8M via GLM: $4.80
2M via MiniMax: $0.40
Total: $5.20/month vs $2000 on ChatGPT API!
```

---

## Why Choose 9Router?

### Maximize Subscriptions

Already paying for Claude Code ($20-100/month) or Codex ($20-200/month)? Get full value:

- Track quota usage in real-time
- Auto-switch when quota resets (5-hour, weekly)
- Use every token before it expires
- Gemini CLI: 180K completions/month **FREE**

### Ultra-Cheap Backup

When subscription quota runs out, pay pennies:

| Provider | Cost per 1M tokens | Reset |
|----------|-------------------|-------|
| **GLM-4.7** | $0.60 input / $2.20 output | Daily 10:00 AM |
| **MiniMax M2.1** | $0.20 input / $1.00 output | 5-hour rolling |
| **Kimi K2** | $9/month (10M tokens) | Monthly |

**~90% cheaper than ChatGPT API ($20/1M)!**

### Free Forever Fallback

Emergency backup when everything else is quota-limited:

- **iFlow**: 8 models (Kimi K2, Qwen3 Coder Plus, GLM 4.7, MiniMax M2)
- **Qwen**: 3 models (Qwen3 Coder Plus/Flash, Vision)
- **Kiro**: Claude Sonnet 4.5, Haiku 4.5 (AWS Builder ID)

---

## Quick Start

Get started in 2 minutes:

```bash
# Install globally
npm install -g 9router

# Start (dashboard opens automatically)
9router
```

🎉 **Dashboard opens** → Connect providers → Start coding!

**Use in your CLI tool:**

```
Endpoint: http://localhost:20128/v1
API Key: [from dashboard]
Model: cc/claude-opus-4-5-20251101
```

[→ Full Getting Started Guide](getting-started.md)

---

## Use Cases

### For Individual Developers

- Maximize your Claude Code/Codex subscription
- Use Gemini CLI free tier (180K/month)
- Fallback to ultra-cheap models ($0.20/1M)
- Code 24/7 without rate limits

### For Teams

- Deploy on VPS/Cloud for shared access
- Track team spending in real-time
- Set budget limits per tier
- Centralized provider management

### For Mobile/Remote Coding

- Use cloud deployment (https://9router.com)
- Access from iPad, phone, anywhere
- No localhost limitations
- Cloudflare edge network (300+ locations)

---

## What's Next?

- [Getting Started](getting-started.md) - Install and configure in 5 minutes
- [Installation Guide](getting-started/installation.md) - Detailed setup instructions
- [Features](features/) - Explore all capabilities
- [FAQ](faq.md) - Common questions

---

<div align="center">
  <sub>Built with ❤️ for developers maximizing AI value</sub>
</div>
