# 016 — Headroom compression-metrics page (router-native)

## Goal (user spec, 2026-06-22)
Fold the standalone Headroom context-compression proxy INTO the router and surface a
**metrics/health page** (`/dashboard/system/compress/headroom`) showing the router's OWN
compression + token-savings stats + health — replacing the page that used to fetch an
EXTERNAL Headroom proxy on `http://127.0.0.1:8787`. The data must live in the router itself.

## Discovery findings (2026-06-22) — the real state (do NOT plan page-first)
- **Headroom is NOT yet folded into the router.** `open-sse/handlers/chatCore.js:260-265`
  calls `compressWithHeadroom(...)` as **"optional external proxy compression; fail open if
  proxy is absent"** — i.e. it still calls an EXTERNAL `headroomUrl`. There is no router-native
  compression path yet.
- **No aggregated metrics exist.** The only Headroom stats are **per-request** `headroomStats`
  at `chatCore.js:266`, formatted by `open-sse/rtk/headroom.js:32-37` (`formatHeadroomLog`:
  `tokens_saved`/`tokens_before`/`tokens_after` → a console log line). Nothing is stored or
  aggregated across requests. No cost tracking. No per-project breakdown.
- **The existing page is an external-probe UI.** `/dashboard/system/compress/headroom` +
  `/api/headroom/probe` probe `localhost:8787/v1/compress` expecting `tokens_saved`/
  `tokens_before` from an external server. There is NO in-router stats source.

➡ **Conclusion:** this is foundational work, not a page over existing data. Slice order below
is mandatory: the folding must land before instrumentation, which must land before the page.

## Slice 0 — DECISION: RESOLVED (user, 2026-06-22)
**Detection-priority hybrid** — user intent: "detect an existing Headroom installation on the machine and use it FIRST; user can point to an IP:port; else use the app's own headroom." Source resolution priority for compression:
1. **custom IP:port** — user-configured Headroom URL → use it.
2. **auto-detected local install** — external Headroom detected on the machine (via `/api/headroom/probe` probing `localhost:8787` etc.) → use it.
3. **router-native fallback** — else run the router's OWN in-process compression.
Keep `/api/headroom/probe` as the detection mechanism for (1)+(2). The stats/health response MUST include a `source` field (`custom | detected | native`) so the page shows which backend is active.

## Slice 1 — source resolution + router-native fallback (the fold)
Implement the Slice-0 priority in `open-sse/rtk/headroom.js` + `compressWithHeadroom` (`chatCore.js:260`):
- **Source resolver:** custom URL (setting) → auto-detected external (probe, cached) → router-native.
- **Router-native compressor** returning the same `{ tokens_before, tokens_after, tokens_saved, model, source, ... }` shape (add `source`; keep `formatHeadroomLog` + downstream compatible).
- **PREREQ — VERIFIED 2026-06-22:** the Headroom compression ALGORITHM is **NOT in this repo** — `open-sse/rtk/headroom.js` contains only the external-proxy `compressWithHeadroom` call + `formatHeadroomLog`; the algorithm lives in the standalone Headroom proxy (separate project). ➡ **Native fallback (Slice 1) is BLOCKED** until that source/spec is provided. HOWEVER: **source-priority resolution (custom > detected > external-call) + instrumentation (the external proxy already returns `tokens_saved`/`tokens_before`) + the page are FEASIBLE NOW** using external sources — ship those first (source shows `custom`/`detected`; `native` shows "unavailable" until the algorithm lands). Do NOT fabricate a native compressor.
- Preserve "fail open" (compression errors never break a request); cache the detection result (don't probe every request).

## Slice 2 — instrumentation + read-only stats endpoint (the data source)
At the `headroomStats` call site, **aggregate** into an in-process store (reset on restart is
acceptable for v1; persist later if needed):
- `requests_compressed`, `total_tokens_removed`, rolling `avg_compression_pct`.
- Per-project (key by connection/project id): `requests`, `tokens_saved`,
  `compression_savings_usd`, `savings_percent`, `last_activity_at`.
- Cost: compute `without_headroom_usd` / `with_headroom_usd` / `total_saved_usd` from
  `open-sse/providers/pricing.js` × token deltas (if pricing data exists; else render `—`).
Add a **read-only, server-side** endpoint (`GET /api/headroom/stats` → `{ health, summary, savings, source }`) — all counter access server-side; the browser never reads counters directly. Add `GET /api/headroom/health` → `{ status, version, uptime_seconds, source }`. **`source` (`custom | detected | native`) is TOP-LEVEL on both responses (the single canonical home) — which backend produced that response.** It is NOT duplicated inside the `health` sub-object.
**Report which target-shape fields map to real counters vs are placeholders (`—`).**

## Slice 3 — page (replace/extend the EXISTING page — NOT a duplicate)
Target the **existing** `/dashboard/system/compress/headroom` page: replace its external-probe
UI with the metrics/health view wired to `/api/headroom/stats` + `/health`. Mirror an existing
dashboard page's layout primitives (no new design system). Per the user spec:
1. **Status row** — health badge (healthy vs fetch-error), `v{version}`, **"Using: {source}"** (custom / detected / native backend), optional "Open UI" link.
2. **Error state** — "Headroom unavailable — could not read router stats" panel on fetch failure.
3. **Four metric cards** — API requests (+primary_model hint), Tokens saved (+avg-compression%),
   Estimated savings USD (+savings%), Mode (compression strategy). `Intl.NumberFormat`, USD,
   2-dp percents, `—` for missing.
4. **Per-project savings grid** — only when `savings.per_project` non-empty.
- **Behavior:** ~30s poll (or the project's standard live-refresh); read-only; match existing
  auth/route protection. Remove/repurpose the `/api/headroom/probe` external-probe code (or keep
  it only if dual-mode Slice-0-B is chosen).

## Target data contract (adapt field names to the router's reality — every field OPTIONAL)
Health: `service`, `status("healthy"|"unhealthy")`, `ready`, `version`, `timestamp`, `uptime_seconds` (no `source` here).
Stats: `summary.{mode, api_requests, primary_model, compression{requests_compressed, avg_compression_pct, total_tokens_removed}, cost{without_headroom_usd, with_headroom_usd, total_saved_usd, savings_pct}}`, `savings.{total_tokens, per_project{requests, tokens_saved, compression_savings_usd, savings_percent, last_activity_at}}`, **top-level `source("custom"|"detected"|"native")` (canonical — returned by both `/stats` and `/health`)**. Page must degrade gracefully on partial/missing data. **Never fabricate numbers** — compute or render `—`.

## STOP / risks
- Do NOT build the page before Slice 1+2 (it would still report an external proxy).
- Cost fields depend on `pricing.js` coverage — if a model's price is unknown, render `—`, don't guess.
- In-process counters reset on restart (v1); flag if persistence is required.
- The external-probe path (`/api/headroom/probe`) is **KEPT** — it is the detection mechanism for custom + detected sources (per the hybrid decision). Do NOT remove it. The page must handle all three `source` values (custom / detected / native).

## Roadmap slot
This IS the "headroom compression part of the plan" — discovery shows it is **not already made**
(compression is still external-proxy), so 016 is foundational: fold (Slice 1) → instrument (2) →
page (3). Wire into plans/README + plan 013 as a P1 feature workstream (not blocked, but
Slice-0 decision should be confirmed before implementation).

## Status
⏳ PLANNED — discovery complete; awaiting Slice-0 decision (embed vs dual-mode) before implementation.
