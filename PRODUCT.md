# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: the owner, for personal use — runs and customizes 9Router as the router/proxy behind their own AI coding workflow (Claude Code, OpenCode, Codex and other CLI tools on this machine).

Confirmed: the public README audience (developers installing `9router` from npm/Docker) is not the focus of this record; this fork documents the owner's personal-use truth.

## Product Purpose

Local AI router that sits between coding tools and AI providers at `http://localhost:20128/v1` (OpenAI-compatible). It compresses requests (RTK token saver), translates request formats, tracks provider quota, and falls back across providers so coding sessions never stop. Success = uninterrupted coding at minimal cost, with measurable token savings.

## Positioning

One local proxy that combines what would otherwise be separate tools: token-saving compression (RTK/Headroom/Caveman/Ponytail), OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex format translation, and tiered fallback (subscription → cheap → free) with quota tracking. The router itself never charges; dashboard "costs" are savings estimates, not billing.

## Operating Context

- Source-run development path: private package `9router-app`; `npm run dev` (port 20127), production `npm run start` (port 20128), `.env` from `.env.example`.
- Next.js 16 + React 19 + Tailwind 4 frontend/dashboard; Express custom server; SQLite data at `DATA_DIR` (default `~/.9router`), `sql.js` fallback when `better-sqlite3` can't build.
- Consumers are CLI tools pointed at the local endpoint (env vars or tool settings); providers are connected through the dashboard (OAuth, API key, free tiers, self-hosted endpoints).
- Deployment options on hand: localhost, VPS/PM2, Docker (`decolua/9router`), Cloudflare Workers.
- Heavy production build documented (swap + `-j1` flags) — build environment constraint.

## Capabilities and Constraints

Confirmed capabilities: RTK token saver (default on, bypass header `X-9Router-Token-Saver: off`), optional Headroom `/v1/compress` proxy, Caveman and Ponytail prompt modes, 3-tier fallback combos, real-time quota tracking, multi-account round-robin, auto OAuth token refresh, request logging, cloud sync, usage analytics, custom OpenAI/Anthropic-compatible endpoints, self-hosted STT/TTS/embeddings.

Constraints and open decisions:

- Self-hosted embeddings must not fall back to a cloud endpoint — missing `baseUrl` is a config error, not a silent fallback (safety rule to preserve).
- RTK and Headroom fail open (original request sent on error) — preserve.
- Open decisions: how far personal modifications diverge from the upstream `decolua/9router` README claims; whether changes get upstreamed. Not decided.

## Brand Commitments

- Name: 9Router. Repo carries the public product's identity: "FREE AI Router & Token Saver", open source, "9Router never charges anything, ever".
- README translations exist under `i18n/` (pt-BR, vi, zh-CN, ja-JP, ru, th, fa_IR, id-ID, es, fr) — treat multilingual README as an existing asset.
- Provider logos in `public/providers/`, hero image `images/9router.png`.

## Evidence on Hand

- `README.md` (full product documentation, feature tables, setup guides, FAQ) and `i18n/README.*.md`.
- `package.json` (stack, scripts), `images/9router.png`, `public/providers/*.png`.
- Linked external proof: npm/Docker badges, Trendshift badge, community YouTube tutorials (URLs in README).
- Absences: no DESIGN.md, no prior PRODUCT.md, no committed screenshot/golden fixtures — future work must not fabricate testimonials, benchmarks, or pricing beyond what the README states.

## Product Principles

1. Never stop coding — route/fallback before failure; fail open on compression errors.
2. Local-first and free — the router charges nothing; costs shown are savings trackers, never billing.
3. Privacy by design — no silent fallback of self-hosted providers to cloud endpoints.
4. Universal compatibility — anything speaking the OpenAI shape can plug in.
5. Preserve what works — personal modifications and upstream README truth are tracked, not silently overwritten.

## Accessibility & Inclusion

No product-specific requirement established.
