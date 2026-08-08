# Dogfood Log

## 2026-08-08 — 9router (federation fork)

- **Verdict:** 🔴 DOES-NOT-DELIVER (federation feature; standalone/upstream product works)
- **Promise:** "Deploy the same 9router on multiple instances; edges proxy /v1 to central,
  replicate central's SQLite, and keep serving from a local replica during a central
  outage (writes queued, reconciled later)."
- **Method:** Real deployment, not tests — central + edge booted from the exact
  Dockerfile.federation runtime layout (`node custom-server.js`), real dashboard API
  usage (login, API keys, provider connection), real `/v1/chat/completions` against a
  mock Ollama upstream, SIGKILL of central, degraded writes, central restart.
- **Top findings:**
  1. **FED-011 (P0)** — edge proxy strips the client's API key (`Authorization` →
     `X-9r-Client-Authorization`, never read upstream): authenticated /v1 through any
     edge → `Invalid API key` from central. The headline "point your CLI tool at the
     edge" workflow fails on the first authenticated request.
  2. **FED-013 (P0)** — replication + failover loops (`edgeClient.start()`/
     `failover.start()`) are called only by the e2e harness, never by the real app:
     edge replica stayed empty (0 apiKeys/providerConnections after 6 min), DEGRADED
     serving answered `Invalid API key` (empty replica), and after central restart the
     edge stayed DEGRADED forever with pendingWrites never drained / never reconciled.
  3. **FED-012 (P0)** — `/api/federation/*` 401s with only the documented Bearer token
     (dashboardGuard deny-by-default; `/api/federation` missing from PUBLIC_API_PATHS);
     even token-less `local-status` needs a dashboard session. The documented protocol
     is unreachable.
  - Also: FED-014 (README `npm run start` never loads custom-server.js → no federation
    at all), FED-015 (plain Docker image ships without `src/lib/federation` → silently
    inert edge), FED-016 (status surface masks "never started" as `linked`).
- **Time-to-first-success (federation):** never — first documented workflow (replication)
  failed at step 1; first working federation API call required an undocumented dashboard
  cookie. Time-to-first-success (standalone gateway): ~3 min.
- **Friction count:** 7 (see integration report).
- **Artifacts:** `docs/dogfood/2026-08-08-integration.md`,
  `docs/dogfood/diagnostics.md`, `skills/9router-federation-usage/SKILL.md`, board
  tasks FED-011..FED-016 (event id 74).
- **Foreman:** not woken (CooldownS already 900); 6 pending P0/P1/P2 tasks on the board.
- **Meta:** the "e2e 17/17 PASS" claim coexists with a dead feature — the harness starts
  the loops itself and bypasses Next's dashboardGuard. Tests proved modules, not product.
