# E2E-001 — Federation E2E Tick (tick 211, 2026-08-16)

**Verdict: PASS — 17/17 checks, 7.1s** (script: `tests/federation/e2e.mjs`)

## What was exercised

Real 3-instance federation lifecycle (central + 2 edges, real modules via
e2e-loader alias hook, real SQLite adapters, temp DATA_DIRs):

| Phase | Result |
|-------|--------|
| Standalone boot (3 instances, FEDERATION_MODE unset) | PASS |
| Central seed (provider connection + model alias) | PASS |
| Edges replicate to central watermark (revision 3) | PASS |
| Edges LINKED after heartbeat | PASS |
| Edge proxy /v1/models → central (source=central) | PASS |
| Kill central → edges DEGRADED after outage threshold | PASS |
| Degraded serving from local replica (edge-a, edge-b) | PASS |
| Degraded write queued locally (202 + queued-write-id) | PASS |
| Restart central → edges RECOVERING → LINKED (replay drain + delta) | PASS |
| Queued degraded write reconciled on central | PASS |
| Post-recovery write replicated to both edges | PASS |

## Findings → board tasks

None. No new tasks injected (zero failures, zero regressions).

## Notes

- Ran against federation HEAD (a1fc01d0, post v0.5.55 convergence).
- Full guard (Tier 1 secrets + full test suite) PASS earlier this tick.
- CI green 5/5; PR #3173 open + MERGEABLE.
