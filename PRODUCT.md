---
last_reviewed: 2026-05-25
---

# PRODUCT.md — 9Router

## Mission

Route AI coding requests intelligently across 40+ providers so developers never stop mid-session due to rate limits, quota exhaustion, or cost — while automatically saving 20–40% of tokens on every call.

## Vision

A world where AI coding tools are effectively free and infinitely available — where switching providers is invisible, token costs are irrelevant, and no developer loses their train of thought to a quota wall.

## Target Personas

### Persona 1: The Quota-Burning Indie Dev
- **Goal:** Keep Claude Code / Cursor / Codex running all day without hitting limits or paying extra
- **Pain point:** Subscription quota runs out mid-sprint; manually switching API keys and endpoints is fragile and breaks tool configs
- **Gap exposure:** Onboarding friction (first provider setup); RTK savings not visible until after first session

### Persona 2: The Cost-Conscious Team Lead
- **Goal:** Reduce AI API spend across the team while maintaining output quality
- **Pain point:** Each tool bills separately; no visibility into where tokens are burned; budgets set per-tool, not per-team
- **Gap exposure:** Multi-account round-robin docs; per-model cost dashboard

### Persona 3: The AI Workflow Integrator
- **Goal:** Drop a universal OpenAI-compatible proxy in front of any AI pipeline without per-tool config
- **Pain point:** Every provider has slightly different API shapes, auth flows, and rate limit behaviors — normalizing them is boilerplate work
- **Gap exposure:** Format translation completeness (Claude ↔ OpenAI edge cases); provider auth validation robustness

## What the Product Actually Is

9Router is a locally-running proxy server + Next.js dashboard that intercepts AI API calls and makes routing, compression, and fallback decisions transparently.

**Layer 1 — Proxy server (Express, port 20128):**
OpenAI-compatible `/v1` endpoint. Any tool that can point at a custom API endpoint works — Claude Code, Codex, Cursor, Cline, Copilot, etc. No per-tool plugin required.

**Layer 2 — RTK Token Saver:**
Auto-compresses `tool_result` content (git diff, ls, grep output) before forwarding to the model. Saves 20-40% of input tokens without changing model outputs.

**Layer 3 — Tiered fallback router:**
Subscription providers → cheap pay-as-you-go → free providers. Quota tracking triggers tier-down automatically. Round-robin across multiple accounts per tier.

**Layer 4 — Dashboard (Next.js):**
Visual provider management, quota gauges, request logs, model selector. Designed for non-technical users who want to connect a free provider without touching config files.

## Core Value Propositions

- **Never stop coding** — auto-fallback means quota exhaustion is invisible to the user
- **20-40% token savings** — RTK compresses tool output before it reaches the model; measurable per session
- **Universal compatibility** — single OpenAI-compatible endpoint works with every major AI coding tool
- **Free AI is real** — Kiro AI and OpenCode Free provide genuine unlimited free Claude access; 9Router surfaces and manages them
- **Zero lock-in** — local-first; no cloud dependency; your provider credentials never leave your machine

## Design Principles

**Operational principles:**

1. **Transparency over magic** — every routing decision is logged and visible in the dashboard; users should be able to audit why a fallback happened
2. **Fail to cheaper, not to nothing** — a degraded response from a free provider is better than a hard error
3. **Token savings must never corrupt output** — RTK truncation applies only to tool results that fit a safe compression pattern; code and model responses are untouched
4. **OpenAI-compat is the contract** — any deviation from the OpenAI API shape is a bug, not a feature

## Competitive Positioning

| Alternative | Where They Win | Where We Win |
|-------------|----------------|--------------|
| LiteLLM | Mature, battle-tested, extensive provider list | Dashboard-first UX; RTK token saver built-in; OAuth subscription providers (Claude Code, Codex, Copilot) |
| OpenRouter | Managed cloud routing, no self-hosting | Local-first, no data sent to third party; free OAuth providers not available on OpenRouter |
| Portkey | Enterprise observability, team features | Free, self-hosted, zero config for individual devs |
| Manual API key rotation | Full control | Automatic fallback; no per-tool reconfiguration; quota tracking |

## Strategic Bet

We bet that subscription-based AI coding tools (Claude Code, Codex, Copilot) will continue to offer more value than raw API access — but their quota limits create a real gap between what users pay and what they can use. The winning layer is a router that maximizes utilization of those subscriptions before falling back to pay-as-you-go, rather than replacing them. As free providers (Kiro, OpenCode) mature, the gap between "free" and "paid quality" will close further, making 9Router's fallback tier increasingly powerful.

## Evidence

**Traction (as of 2026-05-25):**
- Stars: 14,124
- Forks: 2,114
- Open issues: 462 (high engagement signal)
- npm package: `9router` (globally installable)
- Docker: `decolua/9router` (available on Docker Hub + GHCR)
- Release cadence: v0.4.55 → v0.4.59 in one week (active development)
- Created: 2026-01-05 (14K stars in ~5 months)

**Community:**
- Video tutorials in English, Vietnamese, Japanese — community-produced, not official
- i18n README in 3 languages (Vietnamese, Chinese, Japanese)

## Known Product Gaps

| Gap | Impact | Status |
|-----|--------|--------|
| 462 open issues | Backlog may signal provider auth breakage or UX confusion — hard to triage at scale | Open |
| No automated provider auth validation on startup | Broken providers fail silently mid-session rather than at connection time | Open |
| RTK compression is opaque | Users can't tell which tool results were compressed or by how much in real-time | Open |
| First-run UX for OAuth providers | OAuth flow (Claude Code, Codex) requires manual steps not shown in the dashboard | Open |
| No Windows native installer | `npm install -g 9router` requires Node.js; no `.exe` or winget package | Open |
| Test coverage unknown | No visible CI test badge; unclear what's covered by automated tests | Open |

## Usage

This file enables product-aware council reviews:

- **`/pre-mortem`** — Automatically includes `product` perspectives (user-value, adoption-barriers, competitive-position) alongside plan-review judges when this file exists.
- **`/vibe`** — Automatically includes `developer-experience` perspectives (api-clarity, error-experience, discoverability) alongside code-review judges when this file exists.
- **`/council --preset=product`** — Run product review on demand.
- **`/council --preset=developer-experience`** — Run DX review on demand.
