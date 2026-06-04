# Combos - Custom Fallback Chains

Create custom model combinations with automatic fallback. Combos let you define your own routing strategy based on cost, quality, and availability.

---

## What Are Combos?

Combos are **custom fallback chains** that you create in the dashboard. Instead of using a single model, you define a sequence of models that 9Router tries in order.

**Example:**
```
Combo name: premium-coding
Models:
  1. cc/claude-opus-4-5-20251101 (try first)
  2. glm/glm-4.7 (if #1 quota exhausted)
  3. minimax/MiniMax-M2.1 (if #2 quota exhausted)
```

**Usage in CLI:**
```
Model: premium-coding
```

9Router automatically tries each model in sequence until one succeeds.

---

## Why Use Combos?

### 1. Maximize Subscription Value
```
cc/claude-opus → glm/glm-4.7 → if/kimi-k2-thinking

→ Use subscription first, cheap backup, free emergency
→ Get full value from subscriptions you already pay for
```

### 2. Minimize Costs
```
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking

→ Start with cheapest paid option ($0.60/1M)
→ Fallback to even cheaper ($0.20/1M)
→ Emergency free tier
→ Total cost: ~$5-10/month vs $2000 on ChatGPT API
```

### 3. Ensure 24/7 Availability
```
cc/claude-opus → cx/gpt-5.2-codex → glm/glm-4.7 → if/kimi-k2-thinking

→ Always include free tier at the end
→ Never run out of quota
→ Code anytime, anywhere
```

### 4. Optimize for Quality
```
cc/claude-opus-4-5 → cx/gpt-5.2-codex → gc/gemini-3-pro

→ Best models first
→ Fallback to other premium models
→ Maintain high quality across fallback chain
```

---

## How to Create Combos

### Step 1: Open Dashboard

```
http://localhost:20128
→ Login with your password
```

### Step 2: Navigate to Combos

```
Dashboard → Combos → Create New Combo
```

### Step 3: Configure Combo

**Combo Name:**
```
premium-coding
```

**Description (optional):**
```
Subscription first, cheap backup, free emergency
```

**Select Models:**
```
1. cc/claude-opus-4-5-20251101
2. glm/glm-4.7
3. minimax/MiniMax-M2.1
```

**Drag to reorder** - Priority from top to bottom.

### Step 4: Save

```
Click "Save Combo"
→ Combo appears in model list
```

### Step 5: Use in CLI

```
Cursor/Cline/Any tool:
  Model: premium-coding
```

---

## Example Combos

### Example 1: Premium Coding (Subscription → Cheap → Free)

**Goal**: Maximize subscription value, minimize extra costs.

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-4-5-20251101
  2. glm/glm-4.7
  3. minimax/MiniMax-M2.1
```

**Usage:**
```
Cursor IDE:
  Model: premium-coding
```

**Behavior:**
```
Morning (fresh quota):
  Request → cc/claude-opus-4-5 ✅

Afternoon (Claude quota out):
  Request → glm/glm-4.7 ✅ (auto switched)

Evening (GLM quota out):
  Request → minimax/MiniMax-M2.1 ✅ (auto switched)
```

**Monthly cost (100M tokens):**
```
80M via Claude Code: $0 (subscription)
15M via GLM: $9
5M via MiniMax: $1
Total: $10 + your subscription
```

**Savings**: ~99% vs ChatGPT API ($2000).

---

### Example 2: Budget Combo (Cheap → Free)

**Goal**: Minimize costs, use free tier as backup.

```
Dashboard → Combos → Create New

Name: budget-combo
Models:
  1. glm/glm-4.7
  2. minimax/MiniMax-M2.1
  3. if/kimi-k2-thinking
```

**Usage:**
```
Cline:
  Provider: OpenAI Compatible
  Base URL: http://localhost:20128/v1
  Model: budget-combo
```

**Behavior:**
```
Request → glm/glm-4.7
  ✅ Daily quota available → Use GLM ($0.60/1M)
  ❌ Quota exhausted → Try MiniMax ($0.20/1M)
  ❌ MiniMax quota out → Use iFlow (FREE)
```

**Monthly cost (100M tokens):**
```
70M via GLM: $42
20M via MiniMax: $4
10M via iFlow: $0
Total: $46 vs $2000 on ChatGPT API
```

**Savings**: 97%.

---

### Example 3: Free Combo (Zero Cost)

**Goal**: 100% free, no costs ever.

```
Dashboard → Combos → Create New

Name: free-combo
Models:
  1. if/kimi-k2-thinking
  2. qw/qwen3-coder-plus
  3. kr/claude-sonnet-4.5
```

**Usage:**
```
Claude Desktop:
  Model: free-combo
```

**Behavior:**
```
Request → if/kimi-k2-thinking
  ✅ Available → Use iFlow
  ❌ Error → Try Qwen
  ❌ Error → Try Kiro
```

**Monthly cost:**
```
100M tokens via free providers: $0
Total: $0 forever
```

**Use case**: Personal projects, learning, experimentation.

---

### Example 4: Quality First (Premium Models Only)

**Goal**: Best quality, no cheap fallback.

```
Dashboard → Combos → Create New

Name: quality-first
Models:
  1. cc/claude-opus-4-5-20251101
  2. cx/gpt-5.2-codex
  3. gc/gemini-3-pro-preview
```

**Usage:**
```
Codex CLI:
  export OPENAI_BASE_URL="http://localhost:20128"
  Model: quality-first
```

**Behavior:**
```
Request → cc/claude-opus-4-5
  ❌ Quota out → cx/gpt-5.2-codex
  ❌ Quota out → gc/gemini-3-pro-preview
  ❌ All out → Return error (no cheap fallback)
```

**Use case**: Critical production code, complex refactoring.

---

### Example 5: Multi-Subscription (Maximize All)

**Goal**: Use all subscriptions before paying extra.

```
Dashboard → Combos → Create New

Name: multi-sub
Models:
  1. gc/gemini-3-flash-preview (FREE 180K/month)
  2. cc/claude-opus-4-5-20251101 (Pro subscription)
  3. cx/gpt-5.2-codex (Plus subscription)
  4. gh/gpt-5 (Copilot subscription)
  5. glm/glm-4.7 (Cheap backup)
  6. if/kimi-k2-thinking (Free emergency)
```

**Monthly cost (200M tokens):**
```
50M via Gemini CLI: $0 (free tier)
80M via Claude Code: $0 (subscription)
40M via Codex: $0 (subscription)
20M via Copilot: $0 (subscription)
8M via GLM: $4.80
2M via iFlow: $0
Total: $4.80 + existing subscriptions
```

**Result**: Use 190M tokens from subscriptions, only $4.80 extra.

---

### Example 6: Quota Reset Optimization

**Goal**: Distribute usage based on reset times.

```
Dashboard → Combos → Create New

Name: reset-optimized
Models:
  1. cc/claude-opus-4-5 (5h reset, use morning)
  2. gc/gemini-3-flash (1K/day, use afternoon)
  3. glm/glm-4.7 (daily 10AM reset, use evening)
  4. minimax/MiniMax-M2.1 (5h rolling, use night)
  5. if/kimi-k2-thinking (unlimited, emergency)
```

**Daily routine:**
```
08:00 - 13:00: Claude Code (fresh 5h quota)
13:00 - 18:00: Gemini CLI (1K/day quota)
18:00 - 22:00: GLM (resets 10AM next day)
22:00 - 08:00: MiniMax (5h rolling) or iFlow
```

**Result**: Code 24/7 with minimal costs.

---

## Use Combos in CLI Tools

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [from dashboard]
  Model: premium-coding
```

### Claude Desktop

Edit `~/.claude/config.json`:
```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key",
  "model": "budget-combo"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex --model quality-first "your prompt"
```

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [from dashboard]
Model: free-combo
```

### API Request

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "premium-coding",
    "messages": [
      {"role": "user", "content": "Write a function to..."}
    ],
    "stream": true
  }'
```

---

## Best Practices

### 1. Always Include Free Tier

```
✅ Good:
cc/claude-opus → glm/glm-4.7 → if/kimi-k2-thinking

❌ Bad:
cc/claude-opus → glm/glm-4.7
(no free fallback, can run out of quota)
```

**Why**: Ensures 24/7 availability, never blocked by quota.

### 2. Order by Cost (Cheap to Expensive)

```
✅ Good:
glm/glm-4.7 → minimax/MiniMax-M2.1 → cc/claude-opus

❌ Bad:
cc/claude-opus → glm/glm-4.7
(wastes subscription quota on simple tasks)
```

**Exception**: If you want to maximize subscription value, put subscription first.

### 3. Match Quality Requirements

```
For production code:
cc/claude-opus → cx/gpt-5.2-codex → glm/glm-4.7

For quick tasks:
glm/glm-4.7 → if/kimi-k2-thinking

For experimentation:
if/kimi-k2-thinking → qw/qwen3-coder-plus
```

### 4. Consider Quota Reset Times

```
Morning combo (fresh quotas):
cc/claude-opus → cx/gpt-5.2-codex

Evening combo (quotas likely exhausted):
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking
```

### 5. Create Multiple Combos for Different Use Cases

```
premium-coding: For complex tasks
budget-combo: For simple tasks
free-combo: For experimentation
quality-first: For production code
```

**Switch between combos** based on task requirements.

### 6. Monitor Combo Performance

```
Dashboard → Analytics → Combo Usage:
  premium-coding:
    80% via cc/claude-opus (good, using subscription)
    15% via glm/glm-4.7 (acceptable backup)
    5% via minimax (rare fallback)
```

**Optimize**: If too much fallback usage, increase primary quota or reorder models.

---

## Advanced Configuration

### Set Budget Limits per Combo

```
Dashboard → Combos → Edit → Budget:
  Daily limit: $5
  Monthly limit: $50
```

When limit reached, 9Router skips paid models and uses free tier only.

### Enable/Disable Models in Combo

```
Dashboard → Combos → Edit → Models:
  ✅ cc/claude-opus-4-5 (enabled)
  ❌ glm/glm-4.7 (temporarily disabled)
  ✅ if/kimi-k2-thinking (enabled)
```

**Use case**: Temporarily disable expensive models without deleting combo.

### Clone Existing Combo

```
Dashboard → Combos → Clone "premium-coding"
→ Creates copy with "-copy" suffix
→ Modify and save as new combo
```

**Use case**: Create variations for different scenarios.

---

## Troubleshooting

**Issue: Combo not appearing in model list**

**Solution:**
1. Refresh dashboard
2. Check combo is saved (green checkmark)
3. Restart CLI tool to refresh model list

**Issue: Combo always uses last model (free tier)**

**Solution:**
1. Check quota for primary models (Dashboard → Quota)
2. Verify API keys are valid (Dashboard → Providers)
3. Check budget limits not exceeded

**Issue: Combo costs more than expected**

**Solution:**
1. Dashboard → Analytics → Review combo usage
2. Check if primary models are quota-exhausted
3. Reorder models (put cheaper first)
4. Set budget limits

---

## Related

- [Smart Routing](./smart-routing.md) - How auto fallback works
- [Quota Tracking](./quota-tracking.md) - Monitor usage and costs
