# NR-GAP-031 — Full-Suite + Federation E2E Re-Verification (2026-08-22)

_Author: 9router foreman tick 306 (NR-GAP-031, P1). Re-verifies the full ~1988-test suite and
the live federation lifecycle end-to-end after the P0 federation discoveries (FED-011..016,
FED-020). This project has a proven unit-green/e2e-red history (2026-08-08 DOES-NOT-DELIVER
while unit suites passed), so both the harness e2e AND a real-production-build live check
were run. Companion runs: `docs/dogfood/2026-08-12-federation-l3-reverify.md` (NR-GAP-018)._

- Date: 2026-08-22
- Branch: `federation`
- HEAD sha: `a0fc7a4bc4b5778cb5222276d5b1f3736704c276` (chore(board): tick 305; last code
  commit `34a189f4` NR-GAP-030 boot warnings)

## 1. Full suite + regression gate

```bash
cd tests && npx vitest run --reporter=json --outputFile=/tmp/9router-306-full.json
node tests/__baseline__/verify-no-regression.mjs /tmp/9router-306-full.json
```

Counts from the vitest JSON (`/tmp/9router-306-full.json`):

| metric | value |
|---|---|
| numTotalTests | 2131 |
| numPassedTests | 1988 |
| numFailedTests | 84 |
| numPendingTests | 59 |
| test suites | 673 total / 614 passed / 59 failed |

Regression gate verdict (verbatim, exit 0):

```
✅ No regression. (now fails=84, baseline known=89, all known)
```

All 84 current failures are catalogued in `tests/__baseline__/known-fails.txt` (89 entries;
5 known-fail entries no longer fail — new passes are allowed by the gate). Zero
pass→fail regressions. The suite total grew from the 1988-test baseline (2026-08-09) to
2131 because new tests were added since; failure count dropped 88 → 84.

## 2. Federation e2e lifecycle (tests/federation/e2e.mjs)

```bash
node tests/federation/e2e.mjs   # full log: /tmp/9r306-e2e.log
```

Result: **E2E PASSED — 17/17 checks, exit 0, 7.2s.** Live 3-instance lifecycle on scratch
ports + temp dirs:

- standalone boot: 3 instances boot clean (FEDERATION_MODE unset)
- seed central: provider connection + model alias (200/200)
- edges replicate: both at central watermark (revision 3)
- edges LINKED after heartbeat
- edge proxy: /v1/models via edge-a reaches central (`source=central`)
- kill central → edges flip DEGRADED after outage threshold
- degraded serving: both edges serve /v1 (models + chat/completions) from local replica
  (`source=local-replica`, `X-Federation-State: degraded`)
- degraded write: queued locally (202 + `X-Federation-Queued-Write-Id`)
- restart central → edges recover to LINKED (replay drain + delta catch-up)
- reconcile: queued degraded write applied on central (marker present)
- post-recovery central write accepted + replicated to both edges

Log: `/tmp/9r306-e2e.log` (49 lines, complete PASS summary).

## 3. Live FED-011 check — authenticated /v1 through a LINKED edge (real build)

The harness e2e uses a local /v1 stand-in and does not exercise central's real auth layer,
so the FED-011 fix (client key relayed via `X-9r-Client-Authorization`) was re-verified
against a **fresh production build** of HEAD (`npm run build`, Next 16.3.0 standalone,
assembled per `Dockerfile.federation` → `/tmp/9r306-app`). Layout mirrors the 2026-08-12
L3 run; scratch ports because 20128 is occupied by a pre-existing dev server.

- central: `FEDERATION_MODE=central`, port 20231, fresh DATA_DIR
- edge: `FEDERATION_MODE=edge`, `FEDERATION_CENTRAL_URL=http://127.0.0.1:20231`, port 20232,
  sync 2000ms / heartbeat 1000ms / outage 5000ms
- upstream: mock Ollama on 11499 (copy of the dogfood mock with its log redirected to
  `/tmp/9r306-live/logs/` — the `/tmp/dogfood-9router/` evidence dir was not touched)
- seed via real dashboard API: login → `POST /api/keys` (`sk-1413d3d24d80a507-i3l910-…`)
  → `POST /api/providers` (`ollama-local` → `http://127.0.0.1:11499`)
- edge converged: `last_state=linked`, `lastAppliedRevision=3` = central watermark,
  `revisionLag=0` (apiKeys + providerConnections replicated)

FED-011 check (client → edge → central → upstream):

```bash
$ curl -X POST http://127.0.0.1:20232/v1/chat/completions \
    -H "Authorization: Bearer sk-1413d3d24d80a507-i3l910-fd677fc9" \
    -d '{"model":"ollama-local/mock-model-7b","stream":false,"messages":[{"role":"user","content":"ping"}]}'
HTTP 200
{"id":"chatcmpl-1787396110654","object":"chat.completion","model":"mock-model-7b",
 "choices":[{"index":0,"message":{"role":"assistant","content":"Hello from the MOCK
 OLLAMA upstream. Federation dogfood run works."},"finish_reason":"stop"}],...}
```

The mock upstream's request log shows the `POST /api/chat` call — the completion truly
flowed client → edge (proxy, federation token + relayed client key) → central (auth
resolved the RELAYED client key, not the federation token) → upstream. Negative control:
the federation token presented as a client key → **HTTP 401** (it is never accepted as a
client key). Bearer-only `GET /api/federation/status` on central → **HTTP 200**
(FED-012 surface still correct). Stream mode intentionally unused — the mock's SSE is not
valid Ollama streaming (known mock limitation, same as both prior runs).

Driver script + full output: `/tmp/9r306-live/run-live-check.sh`, `/tmp/9r306-live-check.log`
(**LIVE FED-011 CHECK: PASS**, exit 0). Instance logs under `/tmp/9r306-live/logs/`.

## 4. Fixes made

**None required.** All three verification legs passed on the first run; no code, test, or
CHANGELOG changes were needed, and nothing was added to `known-fails.txt`.

## 5. Evidence index

| artifact | path |
|---|---|
| full-suite vitest JSON | `/tmp/9router-306-full.json` |
| full-suite stdout | `/tmp/9router-306-full-stdout.log` |
| e2e lifecycle log | `/tmp/9r306-e2e.log` |
| live-check transcript | `/tmp/9r306-live-check.log` |
| live-check driver | `/tmp/9r306-live/run-live-check.sh` |
| instance + mock logs | `/tmp/9r306-live/logs/` |

## Verdict

**NR-GAP-031 PASSES.** The full suite has zero regressions against the known-fails
baseline (gate exit 0), the harness 3-instance federation lifecycle passes 17/17, and the
FED-011 client-auth relay is proven working end-to-end on a real production build of the
current `federation` HEAD — including the negative control (federation token rejected as a
client key) and a Bearer-only federation API check.
