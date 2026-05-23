# Subscription Providers - Maximize Your Value

Maximize your existing AI subscriptions with smart quota tracking and automatic fallback. Use every bit of your subscription before it resets!

---

## Overview

Subscription tier providers are your **primary** choice - you're already paying for them, so get full value:

- ✅ **Claude Code** (Pro/Max) - Claude 4.5 Opus/Sonnet/Haiku
- ✅ **OpenAI Codex** (Plus/Pro) - GPT 5.2 Codex, GPT 5.1 Codex Max
- ✅ **Gemini CLI** (FREE tier!) - 180K completions/month
- ✅ **GitHub Copilot** - GPT-5, Claude 4.5, Gemini 3
- ✅ **Antigravity** (Google) - Gemini 3 Pro, Claude Sonnet 4.5

**Strategy:** Use these first, track quota in real-time, fallback to cheap/free when exhausted.

---

## Claude Code (Pro/Max)

### Pricing

| Plan | Monthly Cost | Quota Reset | Models |
|------|--------------|-------------|--------|
| Pro | $20 | 5-hour + Weekly | Opus, Sonnet, Haiku |
| Max | $100 | 5-hour + Weekly | Opus, Sonnet, Haiku |

### Setup

**Step 1: Connect via Dashboard**

```bash
9router
# Dashboard opens → Providers → Connect Claude Code
```

**Step 2: OAuth Login**

- Click "Connect Claude Code"
- Browser opens → Login to Claude.ai
- Auto token refresh enabled
- Quota tracking starts

**Step 3: Use in CLI**

```
Model: cc/claude-opus-4-5-20251101
       cc/claude-sonnet-4-5-20250929
       cc/claude-haiku-4-5-20251001
```

### Available Models

| Model ID | Description | Best For |
|----------|-------------|----------|
| `cc/claude-opus-4-5-20251101` | Claude 4.5 Opus | Complex tasks, architecture |
| `cc/claude-sonnet-4-5-20250929` | Claude 4.5 Sonnet | Balanced speed/quality |
| `cc/claude-haiku-4-5-20251001` | Claude 4.5 Haiku | Fast responses |

### Pro Tips

- **Use Opus for complex tasks** - Architecture decisions, refactoring
- **Use Sonnet for speed** - Quick edits, code generation
- **Track quota per model** - Dashboard shows usage per model
- **5-hour reset** - Fresh quota every 5 hours + weekly reset

---

## OpenAI Codex (Plus/Pro)

### Pricing

| Plan | Monthly Cost | Quota Reset | Models |
|------|--------------|-------------|--------|
| Plus | $20 | 5-hour + Weekly | GPT 5.2, GPT 5.1 |
| Pro | $200 | 5-hour + Weekly | GPT 5.2 Codex, GPT 5.1 Max |

### Setup

**Step 1: Connect via Dashboard**

```bash
9router
# Dashboard → Providers → Connect Codex
```

**Step 2: OAuth Login**

- Click "Connect Codex"
- Browser opens to `http://localhost:1455`
- Login to OpenAI account
- Auto token refresh enabled

**Step 3: Use in CLI**

```
Model: cx/gpt-5.2-codex
       cx/gpt-5.1-codex-max
       cx/gpt-5.2
       cx/gpt-5.1-codex
```

### Available Models

| Model ID | Description | Best For |
|----------|-------------|----------|
| `cx/gpt-5.2-codex` | GPT 5.2 Codex | Latest coding model |
| `cx/gpt-5.1-codex-max` | GPT 5.1 Codex Max | Maximum context |
| `cx/gpt-5.2` | GPT 5.2 | General tasks |
| `cx/gpt-5.1-codex` | GPT 5.1 Codex | Stable coding |

### Pro Tips

- **5-hour rolling quota** - Fresh quota every 5 hours
- **Weekly reset** - Full quota reset weekly
- **Pro tier** - 10× more quota than Plus

---

## Gemini CLI (FREE 180K/month!)

### Pricing

| Plan | Monthly Cost | Quota | Reset |
|------|--------------|-------|-------|
| FREE | $0 | 180K completions/month + 1K/day | Daily + Monthly |

**Best Value:** Huge free tier! Use this before paid tiers.

### Setup

**Step 1: Connect via Dashboard**

```bash
9router
# Dashboard → Providers → Connect Gemini CLI
```

**Step 2: Google OAuth**

- Click "Connect Gemini CLI"
- Browser opens → Login to Google account
- Grant permissions
- Auto token refresh enabled

**Step 3: Use in CLI**

```
Model: gc/gemini-3-flash-preview
       gc/gemini-3-pro-preview
       gc/gemini-2.5-pro
       gc/gemini-2.5-flash
```

### Available Models

| Model ID | Description | Best For |
|----------|-------------|----------|
| `gc/gemini-3-flash-preview` | Gemini 3 Flash Preview | Fast responses |
| `gc/gemini-3-pro-preview` | Gemini 3 Pro Preview | Complex tasks |
| `gc/gemini-2.5-pro` | Gemini 2.5 Pro | Stable production |
| `gc/gemini-2.5-flash` | Gemini 2.5 Flash | Quick tasks |

### Pro Tips

- **180K completions/month** - Massive free tier
- **1K/day limit** - Daily quota resets at midnight
- **Use first** - Free tier, use before paid subscriptions
- **No credit card** - Completely free with Google account

---

## GitHub Copilot

### Pricing

| Plan | Monthly Cost | Quota Reset | Models |
|------|--------------|-------------|--------|
| Individual | $10 | Monthly (1st) | GPT-5, Claude 4.5, Gemini 3 |
| Business | $19 | Monthly (1st) | GPT-5, Claude 4.5, Gemini 3 |

### Setup

**Step 1: Connect via Dashboard**

```bash
9router
# Dashboard → Providers → Connect GitHub
```

**Step 2: OAuth via GitHub**

- Click "Connect GitHub"
- Browser opens → Login to GitHub
- Authorize GitHub Copilot
- Auto token refresh enabled

**Step 3: Use in CLI**

```
Model: gh/gpt-5
       gh/gpt-5.1-codex-max
       gh/claude-4.5-sonnet
       gh/gemini-3-pro
```

### Available Models

| Model ID | Description | Best For |
|----------|-------------|----------|
| `gh/gpt-5` | GPT-5 | Latest OpenAI model |
| `gh/gpt-5.1-codex-max` | GPT-5.1 Codex Max | Maximum context |
| `gh/claude-4.5-sonnet` | Claude 4.5 Sonnet | Anthropic quality |
| `gh/gemini-3-pro` | Gemini 3 Pro | Google quality |

### Pro Tips

- **Monthly reset** - Full quota reset on 1st of month
- **Multiple models** - Access GPT, Claude, Gemini in one subscription
- **Business tier** - Higher quota for teams

---

## Antigravity (Google Account)

### Pricing

| Plan | Monthly Cost | Quota | Models |
|------|--------------|-------|--------|
| FREE | $0 | Similar to Gemini CLI | Gemini 3 Pro, Claude Sonnet 4.5 |

### Setup

**Step 1: Connect via Dashboard**

```bash
9router
# Dashboard → Providers → Connect Antigravity
```

**Step 2: Google OAuth**

- Click "Connect Antigravity"
- Browser opens → Login to Google account
- Grant permissions
- Auto token refresh enabled

**Step 3: Use in CLI**

```
Model: ag/gemini-3-pro-high
       ag/claude-sonnet-4-5
       ag/claude-opus-4-5-thinking
```

### Available Models

| Model ID | Description | Best For |
|----------|-------------|----------|
| `ag/gemini-3-pro-high` | Gemini 3 Pro High | High-quality responses |
| `ag/claude-sonnet-4-5` | Claude Sonnet 4.5 | Anthropic quality |
| `ag/claude-opus-4-5-thinking` | Claude Opus 4.5 Thinking | Complex reasoning |

### Pro Tips

- **Free tier** - No cost with Google account
- **Claude access** - Free Claude Sonnet/Opus
- **Quota similar to Gemini CLI** - Daily/monthly limits

---

## Pricing Comparison

| Provider | Monthly Cost | Quota Reset | Value |
|----------|--------------|-------------|-------|
| **Claude Code Pro** | $20 | 5-hour + Weekly | ⭐⭐⭐⭐⭐ Best quality |
| **Claude Code Max** | $100 | 5-hour + Weekly | ⭐⭐⭐⭐⭐ Highest quota |
| **Codex Plus** | $20 | 5-hour + Weekly | ⭐⭐⭐⭐ Good value |
| **Codex Pro** | $200 | 5-hour + Weekly | ⭐⭐⭐⭐⭐ 10× quota |
| **Gemini CLI** | **$0** | Daily + Monthly | ⭐⭐⭐⭐⭐ FREE 180K/month! |
| **GitHub Copilot** | $10-19 | Monthly (1st) | ⭐⭐⭐⭐ Multi-model |
| **Antigravity** | **$0** | Daily + Monthly | ⭐⭐⭐⭐ FREE Claude! |

---

## Usage Example

### Cursor IDE Setup

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from 9router dashboard]
  Model: cc/claude-opus-4-5-20251101
```

### Create Combo (Recommended)

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. gc/gemini-3-flash-preview (FREE, use first)
  2. cc/claude-opus-4-5-20251101 (Subscription)
  3. cx/gpt-5.2-codex (Subscription backup)

Use in CLI: premium-coding
```

**Result:** Maximize free tier → Use subscription → Auto fallback

---

## Quota Tracking

9Router tracks quota in real-time:

- **Token consumption** - Input/output tokens per request
- **Reset countdown** - Time until next quota reset
- **Usage percentage** - How much quota used
- **Auto fallback** - Switch to next tier when exhausted

**Dashboard view:**

```
Claude Code Pro
├─ Quota: 75% used
├─ Reset: 2h 15m (5-hour)
├─ Weekly reset: 3 days
└─ Fallback: glm/glm-4.7 (cheap tier)
```

---

## Best Practices

### 1. Use Free Tier First

```
Priority:
1. Gemini CLI (180K/month FREE)
2. Antigravity (FREE Claude)
3. Claude Code/Codex (paid subscriptions)
```

### 2. Track Quota Daily

- Check dashboard every morning
- Plan heavy tasks around quota resets
- Use cheap/free tier for non-critical tasks

### 3. Create Smart Combos

```
Example combo:
1. gc/gemini-3-flash-preview (FREE primary)
2. cc/claude-opus-4-5 (Complex tasks)
3. glm/glm-4.7 (Cheap backup)
4. if/kimi-k2-thinking (FREE fallback)
```

### 4. Optimize by Time

```
Morning: Fresh 5-hour quota (Claude/Codex)
Afternoon: Gemini CLI (1K/day)
Evening: Subscription quota
Night: Cheap/free tier
```

---

## Troubleshooting

### "Quota exhausted"

**Solution:**
- Check dashboard quota tracker
- Wait for reset (5-hour or daily)
- Use combo fallback to cheap/free tier

### "OAuth token expired"

**Solution:**
- Auto-refreshed by 9Router
- If issues: Dashboard → Provider → Reconnect

### "Rate limiting"

**Solution:**
- Subscription quota out
- Add fallback: `cc/claude-opus → glm/glm-4.7`
- Use free tier: `if/kimi-k2-thinking`

---

## Next Steps

- **Setup cheap backup:** [Cheap Providers](./cheap.md)
- **Add free fallback:** [Free Providers](./free.md)
- **Create combos:** Dashboard → Combos → Create New
