# GOALS — 9Router

## Mission

Make AI coding tools free and uninterrupted for every developer, by routing requests intelligently across 40+ providers while saving 20–40% of tokens on every call.

---

## North Stars

- A new user goes from `npm install -g 9router` to coding on a free provider in under 3 minutes
- Zero downtime mid-session: fallback triggers before the developer notices a limit has been hit
- RTK token savings are measurable and visible in the dashboard on every session

---

## Anti-Stars

- Routing decisions that introduce latency visible to the user (>200ms overhead)
- Providers added to the list without automated auth validation — broken providers that silently fail
- Token savings features that alter model output semantics or truncate tool results incorrectly

---

## Directives

| # | Title | Steer | Description |
|---|-------|-------|-------------|
| 1 | Expand provider coverage | increase | Add new free/cheap provider integrations; prioritize those with high rate limits |
| 2 | RTK compression correctness | increase | All tool_result truncation must be lossless for code paths; add regression tests |
| 3 | Reduce cold-start latency | decrease | Time from `9router` launch to dashboard ready; target <2s |
| 4 | Onboarding friction | decrease | Steps between install and first successful proxied request |

---

## Gates

| ID | Check | Weight | Description |
|----|-------|--------|-------------|
| build-passing | `npm run build 2>&1 \| tail -1 \| grep -q "Route\\|Generating\\|compiled"` | 9 | Production build must succeed |
| dev-starts | `timeout 15 npm run dev 2>&1 \| grep -q "localhost:20128" && echo ok` | 8 | Dev server must be reachable |
| no-lint-errors | `npx next lint 2>&1 \| grep -qv "Error:" && echo ok` | 6 | No blocking ESLint errors |
| env-example-complete | `grep -qE "^[A-Z_]+=?" .env.example && echo ok` | 4 | .env.example documents all required env vars |
| changelog-updated | `git log --oneline -1 2>/dev/null \| grep -qv "^$" && echo ok` | 3 | Repo has commit history |
