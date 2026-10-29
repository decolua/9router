# 9router dogfood run 3 — 2026-09-01 — integration report (real use, L3)

**Run:** third dogfood of the federation fork (after 2026-08-08 🔴 and
2026-08-20 🟡). Target: `federation` branch @ `cd90fd9e`. Method: real
deployment from the repo-root production path, real dashboard API usage,
real `/v1` traffic against a local mock Ollama upstream, SIGKILL of central,
queued write during outage, restart + reconciliation. NOT a test-suite run.

## Promise

Deploy 9router on multiple hosts (`FEDERATION_MODE=central|edge`); edges
proxy `/v1` + mutating dashboard API to central, replicate its SQLite within
seconds, keep serving during a central outage (writes queued, reconciled on
recovery) — using only documented env vars.

## Verdict: ✅ SHIPPABLE (federation feature)

Every formerly-open finding from the previous two runs was re-verified at
row level and holds at HEAD:

| Check | Result | Evidence |
|---|---|---|
| npm ci + build | ✅ | lockfiles tracked (NR-GAP-036 fix); build exit 0, `custom-server.js` in `.next/standalone/` |
| Boot central + edge (repo-root production path) | ✅ | edge logs `[federation] replication + failover loops started (edge mode).` (FED-013 fix visible) |
| A: replication converges + revision advances | ✅ | `lastAppliedRevision` 3→4→5→6→7 after each central write, lag 0, state `linked` |
| A+: **FED-020 row-level re-check** | ✅ | after delta apply, edge row `federation_version=4, updated_at` identical to central — metadata no longer dropped |
| B: authenticated `/v1` through edge (FED-011) | ✅ | 200 + real completion with client key created on central |
| C: federation API Bearer-only (FED-012) | ✅ | 200 with token; 401 with wrong/no token |
| D: kill central → degraded → serve from replica | ✅ | edge flipped `degraded` (5s threshold), `/v1` returned 200 from replica |
| D+: queued write during outage | ✅ | `202` + `X-Federation-Queued-Write-Id`; `pendingWrites.state=done` after recovery; key present on central (v5) AND re-replicated to edge |
| D+: edge returns to `linked` after central restart | ✅ | ~15–20s after restart (multiple failed pulls logged during outage — expected) |
| **FED-022 settings replication** | ✅ | PATCH `/api/settings` → edge replica settings row `federation_version=6` + matching `updated_at` |
| Combos (headline feature) via edge | ✅ | combo created on central, replicated (v7), `/v1` call with combo name through edge → 200 |
| Boot guards (NR-GAP-034 / NR-GAP-019) | ✅ | short FEDERATION_TOKEN → FATAL; placeholder JWT_SECRET/INITIAL_PASSWORD → FATAL with docs pointer |

## Timeline (real use)

- T+0: `npm ci` (0 vulnerabilities) + `npm run build` — clean.
- T+~4min: central (20131) + edge (20132) + mock Ollama (11439) up.
- T+~6min: login, API key, provider connection via dashboard API; edge
  converged `linked` in under 7s; first `/v1` completion through the edge.
- T+~9min: SIGKILL central → edge `degraded` → served `/v1` from replica →
  queued write (202) → central restarted → drained + reconciled + `linked`.
- T+~14min: settings PATCH replicated (FED-022 verified); combo created,
  replicated, and exercised through the edge.

Time-to-first-success (edge `/v1` completion): **~6 minutes** from a clean
scratch dir, following the usage skill's boot recipe exactly.

## Friction found this run (4, all minor — none block real use)

1. **PUT `/api/keys/{id}` silently ignores `name`.** The handler only reads
   `isActive`; a `{"name":...}` body returns 200, bumps nothing user-visible,
   and the name is unchanged. A rename from the raw API is impossible (UI
   presumably recreates?). Filed as task R3-01 (P3).
2. **Short-token boot guard reuses placeholder wording.** Booting with
   `FEDERATION_TOKEN=short` logs the "placeholder secrets still in use"
   message even though `short` is not an example value — the too-short
   branch (NR-GAP-034) apparently shares the placeholder FATAL text. Ops
   confusion risk. Task R3-02 (P3).
3. **`[federation] pull failed: fetch failed` spam** — one line per sync
   interval for the whole outage (12+ lines in 15s window with fast test
   intervals; at default 5s it's 12/min for as long as central is down).
   Log-rate limiting would help. Task R3-03 (P3).
4. **PATCH `/api/settings` echoes the whole settings document** including
   tunnel/oidc structure — noisy but harmless; no secrets observed in the
   echo (protected keys are stripped server-side). Noted, no task.

## What a new user needs (all now documented)

The usage skill (`skills/9router-federation-usage/SKILL.md`) is accurate and
sufficient: boot recipe, dashboard API quick reference, acceptance checks
A–D, pitfalls. The only undocumented bits I hit are friction items 1–2 above.
The `.env.example` federation block + `docs/FEDERATION.md` troubleshooting
table cover the rest.
