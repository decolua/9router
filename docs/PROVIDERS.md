# Provider Guide

Complete reference for 9Router provider types, connection methods, and configuration.

---

## Provider Categories

### OAuth Providers (No API Key Required)

These providers use OAuth or device-code authentication:

| Provider | Auth Type | Notes |
|----------|-----------|-------|
| Claude Code | OAuth | Requires Claude Code subscription |
| Codex | OAuth | GitHub OAuth |
| GitHub | OAuth | GitHub OAuth |
| Cursor | OAuth | Cursor subscription |
| Antigravity | OAuth | Antigravity auth |
| Kiro AI | Device Code | Free, no signup needed |
| OpenCode | None | No auth required |
| Gemini CLI | OAuth | Google OAuth |
| iFlow | Device Code | Free tier (limited) |
| Qwen | OAuth | Alibaba Cloud |

### API Key Providers (40+)

| Provider | Pricing Tier | Notes |
|----------|-------------|-------|
| OpenRouter | Marketplace | Access to 100+ models |
| GLM | Cheap | $0.6/1M tokens |
| Kimi | Cheap | Moonshot AI |
| MiniMax | Cheap | $0.2/1M tokens |
| OpenAI | Paid | gpt-4o, o-series |
| Anthropic | Paid | Claude Sonnet, Opus |
| Gemini | Paid/Free | Google AI |
| DeepSeek | Cheap | DeepSeek V3/V4 |
| Groq | Cheap | Fast inference |
| xAI | Paid | Grok models |
| Mistral | Paid/Free | Mistral Large, Small |
| Perplexity | Paid | Search-integrated |
| Together AI | Paid | Open-source models |
| Fireworks | Paid | Hosted models |
| Cerebras | Paid | Ultra-fast inference |
| Cohere | Paid | Command models |
| NVIDIA | Free credits | NIM endpoints |
| SiliconFlow | Cheap | Chinese provider |
| Cloudflare AI | Free/Paid | Workers AI |
| ... | | 20+ more providers |

### Custom Compatible Nodes

Add any OpenAI/Anthropic-compatible endpoint:

1. Dashboard → Providers → Add Compatible Node
2. Enter base URL, API key
3. Select API type (OpenAI-compatible / Anthropic-compatible)
4. Test connection
5. Models auto-discovered

Examples:

- Local Ollama instance
- Self-hosted vLLM server
- Custom proxy endpoint

---

## Connecting Providers

### OAuth Flow

```
Dashboard → Providers → Connect [Provider]
  → Browser opens OAuth/Device Code page
  → Authenticate with provider
  → Token received and stored in SQLite
  → Connection status: Active
```

Token refresh is automatic for OAuth providers.

### API Key Flow

```
Dashboard → Providers → Connect [Provider]
  → Paste API key
  → Test connection
  → Connection status: Active
```

### Device Code Flow (Kiro, iFlow)

```
Dashboard → Providers → Connect [Provider]
  → Device code generated
  → User enters code on provider's website
  → Poll for token
  → Token received and stored
```

---

## Multi-Account Support

Add multiple accounts per provider for round-robin:

1. Connect first account as usual
2. Dashboard → Providers → Add Account (same provider)
3. Configure second account
4. 9Router distributes requests across accounts

Benefits:

- Load balancing
- Higher rate limit ceiling
- Redundancy if one account fails

---

## Fallback Routing

### 3-Tier Fallback Strategy

```
Tier 1: Subscription (Claude Code, Codex, GitHub Copilot)
  ↓ Quota exhausted
Tier 2: Cheap (GLM, MiniMax)
  ↓ Budget limit
Tier 3: Free (Kiro, OpenCode, Vertex)
```

### Combo Model Fallback

Create combos with explicit model sequences:

```
Combo: "production"
  1. claude-sonnet-4.5 (primary)
  2. glm-4-plus (fallback)
  3. claude-sonnet-4.5 via OpenRouter (backup)
```

If model 1 fails → try model 2 → try model 3.

### Account Fallback

Within a provider:

```
Account A → 429 Rate Limited
  → Cooldown Account A
  → Try Account B
    → Success → Return response
    → Also rate limited → Cooldown Account B
    → No more accounts → Try next combo model
```

Fallback eligibility determined by status codes and error heuristics in `open-sse/services/accountFallback.js`.

---

## Model Aliases

Create custom names for models:

```
Dashboard → Models → Aliases
  → Create alias: "my-favorite" → "kr/claude-sonnet-4.5"
```

Use `my-favorite` as the model name in CLI tools.

---

## Disabled Models

Temporarily disable specific models:

```
Dashboard → Models → Disable [Model]
```

Disabled models are excluded from routing but can be re-enabled.

---

## Provider Status

Monitor provider health:

```
Dashboard → Providers → Status column
  → Active: Ready for requests
  → Cooldown: Temporary rate limit/auth issue
  → Error: Connection problem
  → Testing: Validating credentials
```

CLI tool card status:

```
GET /api/cli-tools/all-statuses
→ Aggregated status for all providers
```

---

## Pricing

Pricing data for cost calculation:

- Built-in pricing for major providers
- Custom pricing overrides via `/api/pricing`
- GLM and MiniMax pricing fetchers (intl/cn)

---

## Proxy Pools

Configure proxy pools for providers:

```
Dashboard → Settings → Proxy Pools
  → Add proxy endpoints
  → Assign to providers
  → Round-robin or failover between proxies
```

---

## Provider Nodes

Add custom OpenAI/Anthropic-compatible endpoints:

| Field | Description |
|-------|-------------|
| Name | Display name |
| Base URL | API endpoint URL |
| API Type | OpenAI-compatible / Anthropic-compatible |
| API Key | Authentication key |
| Prefix | Model prefix (e.g., `ll/`) |

---

## Tailscale Integration

Expose providers over Tailscale:

1. Dashboard → Settings → Tunnel
2. Enable Tailscale
3. Transport protocol: UDP (default) or TCP
4. Status API confirms connectivity

Auto-resume guard: tunnel restart attempted once per process only.
