# Smart Routing & Auto Fallback

9Router eliminates rate limits and quota deadlocks through multi-tier automated fallback.

---

## The 3-Tier Routing Architecture

When you send a prompt, 9Router evaluates the availability of your upstream providers in sequence:

```
Your Request
    │
    ▼
[ Tier 1: Subscriptions ] ──► (Claude Code / Codex / Copilot)
    │ (Quota depleted / rate limited / 5xx error)
    ▼
[ Tier 2: Ultra-Cheap ]   ──► (GLM ~$0.60/1M / MiniMax ~$0.20/1M)
    │ (Budget limit reached / account exhausted)
    ▼
[ Tier 3: Free Fallback ] ──► (Kiro AI / OpenCode Free)
```

---

## Automatic Failover Triggers

9Router triggers automatic fallback upon:
1. **Quota exhaustion**: 5-hour rolling limits, daily allowance caps, or subscription window resets.
2. **Rate limiting (HTTP 429)**: Requests immediately failover to the next available model in the sequence.
3. **Provider outages (HTTP 500 / 502 / 503)**: Fast switch to minimize client latency.

---

## Load Balancing & Account Rotation

If you configure multiple accounts for the same provider (e.g., two Claude Code accounts or two GLM API keys), 9Router automatically rotates requests across accounts using round-robin distribution.
