# Cheap Providers - Ultra-Cheap Backup

When subscription quota runs out, pay pennies instead of dollars. ~90% cheaper than ChatGPT API!

---

## Overview

Cheap tier providers are your **backup** when subscription quota exhausted:

- 💰 **GLM-4.7** - $0.6/$2.2 per 1M tokens (daily reset)
- 💰 **MiniMax M2.1** - $0.2/$1.0 per 1M tokens (5h reset)
- 💰 **Kimi K2** - $9/month flat (10M tokens)

**Strategy:** Use after subscription quota out, before free tier. Massive cost savings vs ChatGPT API ($20/1M).

---

## GLM-4.7 (Daily Reset)

### Pricing

| Tier | Input | Output | Reset |
|------|-------|--------|-------|
| Standard | $0.60/1M | $2.20/1M | Daily 10:00 AM |
| Coding Plan | $0.60/1M | $2.20/1M | Daily 10:00 AM (3× quota) |

**Cost Example (10M tokens):**
- Input: 10M × $0.60 = $6
- Output: 10M × $2.20 = $22
- **Total: $6-22** vs $200 on ChatGPT API!

### Setup

**Step 1: Sign Up**

1. Visit [Zhipu AI](https://open.bigmodel.cn/)
2. Create account (phone verification)
3. Choose **Coding Plan** for 3× quota at same price

**Step 2: Get API Key**

```bash
Dashboard → API Keys → Create New
→ Copy API key (starts with "zhipu-")
```

**Step 3: Add to 9Router**

```bash
9router
# Dashboard → Providers → Add API Key

Provider: glm
API Key: zhipu-your-api-key-here
```

**Step 4: Use in CLI**

```
Model: glm/glm-4.7
       glm/glm-4.6v (vision)
```

### Available Models

| Model ID | Description | Context | Best For |
|----------|-------------|---------|----------|
| `glm/glm-4.7` | GLM 4.7 | 128K | Coding, general tasks |
| `glm/glm-4.6v` | GLM 4.6V Vision | 128K | Image analysis |

### Pro Tips

- **Coding Plan** - 3× quota at same price ($0.6/$2.2)
- **Daily reset** - Fresh quota at 10:00 AM Beijing time
- **Best for coding** - Optimized for code generation
- **128K context** - Handle large files

### Quota Reset

```
Daily reset: 10:00 AM Beijing Time (UTC+8)
→ 2:00 AM UTC
→ 6:00 PM PST (previous day)
→ 9:00 PM EST (previous day)

Plan your heavy tasks around reset time!
```

---

## MiniMax M2.1 (5-Hour Reset)

### Pricing

| Tier | Input | Output | Reset |
|------|-------|--------|-------|
| Standard | $0.20/1M | $1.00/1M | 5-hour rolling |

**Cost Example (10M tokens):**
- Input: 10M × $0.20 = $2
- Output: 10M × $1.00 = $10
- **Total: $2-10** - Cheapest option!

### Setup

**Step 1: Sign Up**

1. Visit [MiniMax](https://www.minimax.io/)
2. Create account
3. Verify email/phone

**Step 2: Get API Key**

```bash
Dashboard → API Management → Create Key
→ Copy API key
```

**Step 3: Add to 9Router**

```bash
9router
# Dashboard → Providers → Add API Key

Provider: minimax
API Key: your-minimax-api-key
```

**Step 4: Use in CLI**

```
Model: minimax/MiniMax-M2.1
```

### Available Models

| Model ID | Description | Context | Best For |
|----------|-------------|---------|----------|
| `minimax/MiniMax-M2.1` | MiniMax M2.1 | 1M tokens | Long context, coding |

### Pro Tips

- **Cheapest option** - $0.20/1M input (90% cheaper than ChatGPT)
- **5-hour rolling** - Quota resets every 5 hours
- **1M context** - Massive context window
- **Best for long files** - Handle entire codebases

### Quota Reset

```
5-hour rolling window:
→ Use quota → Wait 5 hours → Fresh quota

Example:
10:00 AM - Use 5M tokens
3:00 PM - Fresh quota available
8:00 PM - Fresh quota available

Code 24/7 with minimal cost!
```

---

## Kimi K2 (Flat $9/month)

### Pricing

| Plan | Monthly Cost | Included Tokens | Effective Cost |
|------|--------------|-----------------|----------------|
| Subscription | $9 | 10M tokens | $0.90/1M |

**Cost Example:**
- $9/month flat
- 10M tokens included
- **Effective: $0.90/1M** - Best value for consistent usage!

### Setup

**Step 1: Subscribe**

1. Visit [Moonshot AI](https://platform.moonshot.ai/)
2. Create account
3. Subscribe to $9/month plan

**Step 2: Get API Key**

```bash
Dashboard → API Keys → Create New
→ Copy API key
```

**Step 3: Add to 9Router**

```bash
9router
# Dashboard → Providers → Add API Key

Provider: kimi
API Key: your-kimi-api-key
```

**Step 4: Use in CLI**

```
Model: kimi/kimi-latest
```

### Available Models

| Model ID | Description | Context | Best For |
|----------|-------------|---------|----------|
| `kimi/kimi-latest` | Kimi Latest | 200K | General coding |

### Pro Tips

- **Fixed cost** - $9/month regardless of usage (up to 10M)
- **Best for consistent usage** - If you use 10M/month, only $0.90/1M
- **Monthly reset** - 10M tokens reset monthly
- **Predictable billing** - No surprise costs

### Quota Reset

```
Monthly reset: 1st of each month
→ 10M tokens refresh

Example monthly usage:
Week 1: 3M tokens
Week 2: 2M tokens
Week 3: 3M tokens
Week 4: 2M tokens
Total: 10M tokens = $9 flat
```

---

## Pricing Comparison

| Provider | Input/1M | Output/1M | Reset | 10M Cost | Best For |
|----------|----------|-----------|-------|----------|----------|
| **GLM-4.7** | $0.60 | $2.20 | Daily 10AM | $6-22 | Daily quota users |
| **MiniMax M2.1** | $0.20 | $1.00 | 5-hour | $2-10 | **Cheapest!** |
| **Kimi K2** | $0.90 | $0.90 | Monthly | **$9 flat** | Consistent usage |
| ChatGPT API | $20.00 | $20.00 | None | $200 | ❌ Expensive |

**Savings:** 90-95% cheaper than ChatGPT API!

---

## Usage Example

### Cursor IDE Setup

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from 9router dashboard]
  Model: glm/glm-4.7
```

### Create Combo (Recommended)

```
Dashboard → Combos → Create New

Name: cheap-backup
Models:
  1. cc/claude-opus-4-5 (Subscription primary)
  2. glm/glm-4.7 (Cheap backup, daily reset)
  3. minimax/MiniMax-M2.1 (Cheapest fallback)
  4. if/kimi-k2-thinking (FREE emergency)

Use in CLI: cheap-backup
```

**Result:** Subscription → Cheap → Cheapest → Free

---

## Cost Optimization

### Strategy 1: Daily Reset Routine

```
Morning (10AM): Fresh GLM quota
→ Use GLM for heavy tasks
→ Save subscription quota

Afternoon: Subscription quota
→ Use Claude/Codex for complex tasks

Evening: MiniMax (5h reset)
→ Cheap fallback for late work

Night: Free tier (iFlow)
→ Zero cost emergency backup
```

### Strategy 2: Budget-First

```
Set monthly budget: $20

Allocation:
- $9 Kimi K2 (10M tokens flat)
- $6 GLM daily quota (10M tokens)
- $5 MiniMax overflow (25M tokens)

Total: 45M tokens for $20
vs 1M tokens for $20 on ChatGPT API!
```

### Strategy 3: Maximize Subscriptions First

```
Priority:
1. Gemini CLI (180K/month FREE)
2. Claude Code (subscription you already pay)
3. GLM-4.7 (cheap backup, $0.6/1M)
4. MiniMax M2.1 (cheapest, $0.2/1M)
5. iFlow (FREE emergency)

Monthly cost example (100M tokens):
- 60M via Gemini CLI: $0 (free)
- 30M via Claude Code: $0 (subscription)
- 8M via GLM: $4.80
- 2M via MiniMax: $0.40
Total: $5.20/month!
```

---

## Real-World Examples

### Example 1: Heavy Coding Month (100M tokens)

```
Breakdown:
- 60M via subscription (Claude/Codex): $0 extra
- 30M via GLM-4.7: $18
- 10M via MiniMax M2.1: $2

Total: $20/month
vs $2000 on ChatGPT API!

Savings: 99% cheaper!
```

### Example 2: Budget Coder ($10/month)

```
Strategy:
- $9 Kimi K2 (10M tokens)
- $1 MiniMax overflow (5M tokens)

Total: 15M tokens for $10
vs 0.5M tokens for $10 on ChatGPT API!

30× more tokens!
```

### Example 3: Freelancer (Variable Usage)

```
Light month (20M tokens):
- 15M via subscription: $0
- 5M via GLM: $3
Total: $3

Heavy month (150M tokens):
- 60M via subscription: $0
- 60M via GLM: $36
- 30M via MiniMax: $6
Total: $42

Average: $22.50/month
vs $3400 on ChatGPT API!
```

---

## Best Practices

### 1. Track Daily Quota

```
Dashboard shows:
- GLM quota: 75% used (reset in 6h)
- MiniMax quota: 50% used (reset in 2h)
- Kimi quota: 8M/10M used (reset in 15 days)

Plan heavy tasks around reset times!
```

### 2. Use Coding Plan (GLM)

```
Standard: 1× quota
Coding Plan: 3× quota (same price!)

→ Always choose Coding Plan
```

### 3. Combine with Free Tier

```
Combo:
1. gc/gemini-3-flash (FREE primary)
2. glm/glm-4.7 (cheap backup)
3. minimax/MiniMax-M2.1 (cheapest)
4. if/kimi-k2-thinking (FREE emergency)

Result: Minimize costs, maximize uptime
```

### 4. Set Budget Alerts

```
Dashboard → Settings → Budget Alerts

Daily: $2 limit
Weekly: $10 limit
Monthly: $30 limit

→ Auto switch to free tier when limit reached
```

---

## Troubleshooting

### "Quota exhausted"

**Solution:**
- GLM: Wait until 10:00 AM Beijing time
- MiniMax: Wait 5 hours from first use
- Kimi: Wait until 1st of next month
- Use combo fallback to free tier

### "API key invalid"

**Solution:**
- Check API key copied correctly
- Verify account has credits
- Regenerate API key if needed

### "High costs"

**Solution:**
- Check usage stats in Dashboard
- Set budget alerts
- Switch to MiniMax ($0.2/1M cheapest)
- Use free tier for non-critical tasks

---

## Next Steps

- **Add free fallback:** [Free Providers](./free.md)
- **Setup subscriptions:** [Subscription Providers](./subscription.md)
- **Create combos:** Dashboard → Combos → Create New
