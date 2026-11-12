# Federation value claims → automated proofs (2026-09-18)

**Board rows covered:** `DF-9ROUTER-10` (P1), `DF-9ROUTER-15` (P1), `DF-9ROUTER-20` (P2) — all
`source: dogfood-dagger`, cycle 2026-09-13, all open on `.coding-hermes/board/tasks.jsonl`.
**Branch:** `federation` @ `67b9759918aeebfb67709bb8cce689b983043cf4` (HEAD at the start of this work;
`chore(board): tick 382`).
**Remote:** `origin` = `https://github.com/totalwindupflightsystems/9router`.
**Scope:** documentation only — no source, test, config or board file was modified.

This artifact exists because two things changed after the 2026-09-13 dogfood cycle and neither is
recorded anywhere a reviewer can check: commit `f65977c7` added completion-path assertions to the
federation E2E, and the "20-40% token savings" figure in the row is an upstream 9router marketing
claim about the RTK token saver, not a federation deliverable. Every claim named in the three rows
above is mapped below to an automated check that exists in this repo — or recorded as having none.

## 1. Method

Claims were read from the two sources the brief names:

* `docs/federation-spec.md` §1 Goal (lines 7–19), §2 Verified Codebase Facts (line 21), §3.2 Edge
  proxy (line 72), §3.3 Replication (line 88), §3.4 Failover (line 112), §7 Done Criteria (line 218).
* `README.md` lines 25–60 — the fork section is lines 26–45; the upstream marketing it sits above
  starts at line 47.

Every claim named in `DF-9ROUTER-10` / `DF-9ROUTER-15` / `DF-9ROUTER-20` was then added to the
matrix even where the fork makes no such claim; those rows carry the README/spec line that actually
carries the claim and the verdict `OUT-OF-FORK-SCOPE`.

Proof search surface: `grep` over the 286 test files in `tests/` (14 under `tests/federation/`, 247
under `tests/unit/`, the rest under `tests/translator/` and `tests/auth/`), plus the `check()` call
sites in `tests/federation/e2e.mjs`. Every proof cited below was executed in this tick; no live
network, no credentials, no `RUN_REAL`.

Verdict vocabulary used exactly as specified: `PROVEN` (check exists and ran green here), `PARTIAL`
(check exists but covers only part of the claim — the missing part is named), `UNPROVEN` (no check
exercises it anywhere in the repo), `OUT-OF-FORK-SCOPE` (upstream 9router marketing, not this fork's
deliverable; in-repo proof of the mechanism is still recorded).

## 2. The E2E run (step 4, first command)

```
$ cd /home/kara/9router && npm run test:e2e
...
[e2e] === FEDERATION E2E SUMMARY (7.4s) ===
[e2e]   PASS standalone boot: 3 instances boot clean
[e2e]   PASS standalone health: role=standalone on :39713
[e2e]   PASS standalone health: role=standalone on :38987
[e2e]   PASS standalone health: role=standalone on :46833
[e2e]   PASS seed central: provider connection created — status 200
[e2e]   PASS seed central: model alias set — status 200
[e2e]   PASS edges replicate: both at central watermark — revision 3
[e2e]   PASS edges LINKED after heartbeat
[e2e]   PASS edge proxy: /v1/models via edge-a reaches central — source=central
[e2e]   PASS edge proxy: LINKED completion via edge-a reaches central — status=200 source=central state=null
[e2e]   PASS edge proxy: LINKED streamed completion relays SSE from central — status=200 ct=text/event-stream frames=3 deltas=2 sources=central
[e2e]   PASS edges flip DEGRADED after outage threshold
[e2e]   PASS degraded serving: edge-a serves /v1 from local replica — source=local-replica header=degraded
[e2e]   PASS degraded serving: edge-b serves /v1/chat/completions from local replica — source=local-replica header=degraded
[e2e]   PASS degraded serving: edge-b streams /v1/chat/completions from local replica — status=200 ct=text/event-stream header=degraded deltas=2 sources=local-replica
[e2e]   PASS degraded write: queued locally with 202 + queued-write-id — status=202 header=degraded
[e2e]   PASS edges recover to LINKED (replay drain + delta catch-up)
[e2e]   PASS reconcile: queued degraded write applied on central — marker="queued-during-outage"
[e2e]   PASS post-recovery central write accepted — status 200
[e2e]   PASS post-recovery write replicated to both edges
[e2e]   20/20 checks passed
[e2e] E2E PASSED
```

**Pass/fail count: 20/20 passed, exit 0, 7.4 s.** 18 `check()` call sites
(`grep -n 'check(' tests/federation/e2e.mjs` → 19 matches, one of which is the function definition at
line 52); line 244 runs inside a 3-iteration loop, so the run reports 20 check results.

### 2.1 The three `f65977c7` checks, by name, with this run's result

| Check name (verbatim from the run) | Source line | Result in this run |
|---|---|---|
| `edge proxy: LINKED completion via edge-a reaches central` | `tests/federation/e2e.mjs:362` | PASS — `status=200 source=central state=null` |
| `edge proxy: LINKED streamed completion relays SSE from central` | `tests/federation/e2e.mjs:381` | PASS — `status=200 ct=text/event-stream frames=3 deltas=2 sources=central` |
| `degraded serving: edge-b streams /v1/chat/completions from local replica` | `tests/federation/e2e.mjs:442` | PASS — `status=200 ct=text/event-stream header=degraded deltas=2 sources=local-replica` |

Commit provenance:

```
$ git log --oneline -1 f65977c7
f65977c7 test(federation): assert the completion path through the edge proxy (proxied + streamed)
$ git show --stat f65977c7
 tests/federation/e2e-child.mjs |  42 ++++++++++++++++
 tests/federation/e2e.mjs       | 107 ++++++++++++++++++++++++++++++++++++++++-
 2 files changed, 148 insertions(+), 1 deletion(-)
```

The central marker the first two checks assert is produced only by the central child
(`tests/federation/e2e-child.mjs:79` — `ROLE === "central" ? "central" : "local-replica"`;
SSE branch at `:82`–`:86`), so a `source=central` delta proves the request traversed the edge's
proxy. The third check asserts the opposite marker from the local replica while DEGRADED.

### 2.2 Federation suite (step 4, second command)

```
$ cd /home/kara/9router/tests && npx vitest run federation/
 Test Files  14 passed (14)
      Tests  199 passed (199)
   Duration  4.52s (transform 7.47s, setup 0ms, import 6.80s, tests 19.10s)
EXIT=0
```

### 2.3 Per-file runs of the further cited proofs

Each file below was run once, on its own, in this tick:

| Command (`cd tests && npx vitest run <path>`) | Observed summary |
|---|---|
| `federation/failover.test.js` | `Test Files 1 passed (1)` / `Tests 16 passed (16)` / exit 0 |
| `federation/replication.test.js` | `Test Files 1 passed (1)` / `Tests 28 passed (28)` / exit 0 |
| `federation/local-status.test.js` | `Test Files 1 passed (1)` / `Tests 17 passed (17)` / exit 0 |
| `federation/queue.test.js` | `Test Files 1 passed (1)` / `Tests 13 passed (13)` / exit 0 |
| `federation/proxy.test.js` | `Test Files 1 passed (1)` / `Tests 16 passed (16)` / exit 0 |
| `unit/rtk.test.js` | `Test Files 1 passed (1)` / `Tests 45 passed (45)` / exit 0 |
| `unit/rtk.e2e.test.js` | `Test Files 1 skipped (1)` / `Tests 4 skipped (4)` / exit 0 |
| `unit/combo-routing.test.js` | `Test Files 1 passed (1)` / `Tests 4 passed (4)` / exit 0 |
| `unit/antigravity-quota-routing.test.js` | `Test Files 1 passed (1)` / `Tests 15 passed (15)` / exit 0 |
| `unit/base-executor-retry.test.js` | `Test Files 1 passed (1)` / `Tests 7 passed (7)` / exit 0 |
| `unit/fresh-install-model-catalog-339.test.js` | `Test Files 1 passed (1)` / `Tests 9 passed (9)` / exit 0 |
| `unit/provider-free-tier-honesty.test.js` | `Test Files 1 passed (1)` / `Tests 5 passed (5)` / exit 0 |
| `unit/dashboard-guard.test.js` | `Test Files 1 passed (1)` / `Tests 35 passed (35)` / exit 0 |
| `unit/auth-status.test.js` | `Test Files 1 passed (1)` / `Tests 3 passed (3)` / exit 0 |
| `unit/api-keys-put-rename.test.js` | `Test Files 1 passed (1)` / `Tests 8 passed (8)` / exit 0 |
| `unit/db-sqlite-vs-lowdb.test.js` | `Test Files 1 passed (1)` / `Tests 23 passed (23)` / exit 0 |
| `unit/api-reference-auth-claims.test.js` | `Test Files 1 passed (1)` / `Tests 14 passed (14)` / exit 0 |
| `unit/provider-display-split.test.js` | `Test Files 1 passed (1)` / `Tests 4 passed (4)` / exit 0 |
| `unit/openai-stream-done-sentinel.test.js` | `Test Files 1 passed (1)` / `Tests 4 passed (4)` / exit 0 |
| `unit/cli-port-resolution.test.js` | `Test Files 1 passed (1)` / `Tests 28 passed (28)` / exit 0 |
| `unit/cli-build-artifacts.test.js` | `Test Files 1 passed (1)` / `Tests 4 passed (4)` / exit 0 |

No cited run failed. Two non-green lines exist and both are by design, not failures:
`unit/rtk.e2e.test.js` → `4 skipped (4)` (gated by `RUN_E2E`, `tests/unit/rtk.e2e.test.js:12`), and the
repo's standing baseline (`tests/__baseline__/known-fails.txt` — 84 entries on 88 lines, the other 4
being 3 comment lines and 1 blank) which this artifact does
not re-run — no full-suite claim is made here beyond the runs quoted above.

## 3. Main matrix

Sources abbreviated: **R** = `README.md`, **S** = `docs/federation-spec.md`, **B** =
`.coding-hermes/board/tasks.jsonl` row `detail`.

| Claim (quoted) | Source file:line | Verdict | Automated proof (file:line + test name) | Evidence (command + observed result) |
|---|---|---|---|---|
| A1 "A central node and two edges started successfully" | B `DF-9ROUTER-10` detail; fork claim S:11 (§1.1) + R:31–32 | **PROVEN** | `tests/federation/e2e.mjs:241` check `standalone boot: 3 instances boot clean`; `:250` central spawn; `:259`/`:273` edge spawns; `:338` check `edges LINKED after heartbeat` | `npm run test:e2e` → both quoted checks `PASS`; `20/20 checks passed` |
| A2 "a key created through edge A replicated to central and both edges" | B `DF-9ROUTER-10` detail | **PARTIAL** | `tests/federation/queue.test.js:338` `queues the write and responds 202 with X-Federation-State + X-Federation-Queued-Write-Id`; `tests/federation/failover.test.js:597` `replays POST /api/keys without machineId — derives it machineId server-side (L3 dogfood regression)`; `tests/federation/replication.test.js:530` `stamps every replicated table (settings, nodes, pools, keys, combos, kv)`. **Missing:** no single check asserts the three-hop chain for an API-key row (write at an edge → present at central → delivered to BOTH edges). `tests/federation/e2e.mjs:522` proves that full chain only for a model alias | queue 13 passed; failover 16 passed; replication 28 passed |
| A3 "with revisionLag 0" | B `DF-9ROUTER-10` detail | **PARTIAL** | `tests/federation/local-status.test.js:303` `caught-up edge (centralMaxVersion == lastAppliedRevision) reports lag 0`. **Missing:** the E2E never reads `revisionLag` — `grep -n revisionLag tests/federation/e2e.mjs` returns no match; the E2E's equivalent signal is the watermark equality at `tests/federation/e2e.mjs:325` (`edges replicate: both at central watermark — revision 3`) | local-status 17 passed; E2E `edges replicate: both at central watermark — revision 3` PASS |
| A4 "the run provided no successful model completion" (through the federation path) | B `DF-9ROUTER-10` detail; fork claim S:78 (§3.2 `/v1/*` forwarding) | **PROVEN** | `tests/federation/e2e.mjs:362` `edge proxy: LINKED completion via edge-a reaches central`; `:381` `edge proxy: LINKED streamed completion relays SSE from central`; `:442` `degraded serving: edge-b streams /v1/chat/completions from local replica` — added by `f65977c7` | `npm run test:e2e` → all three `PASS`; `20/20 checks passed` (see §2.1) |
| A5 "the claimed 20–40% token savings" | R:6, R:59, R:90, R:765, R:952, R:964, R:1036, R:1371, R:1697, R:1801 — upstream RTK marketing (the full `grep -n '20-40' README.md` set) | **OUT-OF-FORK-SCOPE** | Mechanism only: `tests/unit/rtk.test.js:519` `formats savings line with percentage` (asserts the log line renders `60.0%` for a synthetic 1000→400 B case — a formatting assertion, not the 20–40% range); filters assert `out.length` < `input.length` (`:232`, `:241`, `:251`, `:261`, `:269`, `:350`, `:366`, `:383`). The end-to-end RTK proof is opt-in and skipped by default: `tests/unit/rtk.e2e.test.js:12` `const RUN = process.env.RUN_E2E === "1"` | `unit/rtk.test.js` 45 passed; `unit/rtk.e2e.test.js` `1 skipped (1)` / `4 skipped (4)` |
| A6 "uninterrupted automatic fallback" (federation reading: central outage → edges keep serving) | R:33–35; S:12–13 (§1.2), S:115 (§3.4), S:122–129 (DEGRADED), S:130–131 (RECOVERING) | **PROVEN** | `tests/federation/e2e.mjs:407` `edges flip DEGRADED after outage threshold`; `:412` `degraded serving: edge-a serves /v1 from local replica`; `:424` `degraded serving: edge-b serves /v1/chat/completions from local replica`; `:493` `edges recover to LINKED (replay drain + delta catch-up)`; `:499` `reconcile: queued degraded write applied on central`; `tests/federation/failover.test.js:120` `flips to DEGRADED after failures span the jittered threshold; persists last_state`; `:348` `heartbeat success while DEGRADED → RECOVERING → drain → catch up → LINKED`; `tests/federation/proxy.test.js:346` `DEGRADED state → no forward; local handler receives the request` | E2E 20/20; failover 16 passed; proxy 16 passed |
| A7 "uninterrupted automatic fallback" (provider-tier reading: "Auto fallback - Subscription → Cheap → Free") | R:61, R:769 | **OUT-OF-FORK-SCOPE** | Mechanism only: `tests/unit/base-executor-retry.test.js:49` `falls over to the next url on 429 (shouldRetry)`; `tests/unit/antigravity-quota-routing.test.js:63` `skips exhausted account/model and selects the next account`; `tests/unit/combo-routing.test.js:5` `combo round-robin routing`. **No check drives a subscription→cheap→free tier transition** — the three-tier ladder itself is asserted nowhere | base-executor-retry 7 passed; antigravity-quota-routing 15 passed; combo-routing 4 passed |
| A8 "usability required 16 workarounds despite a 44-second first infrastructure success" | B `DF-9ROUTER-10` detail + `reasoning.note` (`t2fs 44s, friction 16`) | **UNPROVEN** | None. `grep -rln 'friction\|workaround\|t2fs\|time-to-first' tests/ docs/` matches only unrelated code comments (`tests/unit/passthrough-done-sentinel-gate.test.js:5`, `tests/unit/env-example-data-dir.test.js:8`) and prose dogfood logs (`docs/dogfood/2026-08-20-integration.md:147` "Friction log", `docs/dogfood/2026-09-01-integration.md:50`). No automated check counts frictions or measures time-to-first-success | n/a |
| B1 "40+ providers" | R:8 (upstream header claim) | **OUT-OF-FORK-SCOPE** | No count assertion exists. Registry mechanism: `open-sse/providers/registry/index.js` — `grep -c '^import p' ` → 119 active static imports, 123 entry files, with `p104`/`p114` commented out (devin-cli, windsurf). Shape (not count) is asserted by `tests/unit/provider-display-split.test.js:7` `AI_PROVIDERS entries still carry merged display + transport` | `provider-display-split.test.js` 4 passed |
| B2 "100+ usable models" | R:8 (upstream header claim) | **OUT-OF-FORK-SCOPE** | `tests/unit/fresh-install-model-catalog-339.test.js:90` `advertises only credentialless noAuth providers when the lookup succeeds with zero connections` — asserts WHICH models may be advertised, never how many; `:185` `GET /v1/models hides credential-required and vendor-client-only static models on a fresh install` | `fresh-install-model-catalog-339.test.js` 9 passed |
| B3 "automatic quota fallback" | R:61, R:769 | **OUT-OF-FORK-SCOPE** | Same mechanism proofs as A7 (`base-executor-retry.test.js:49`, `antigravity-quota-routing.test.js:63`); no cross-provider tier-transition check | 7 passed / 15 passed |
| B4 "reduced token use" | R:59 (same RTK claim as A5) | **OUT-OF-FORK-SCOPE** | Same as A5 — `tests/unit/rtk.test.js:519` is a formatting assertion; the RTK end-to-end file is `RUN_E2E`-gated | rtk 45 passed; rtk.e2e `4 skipped (4)` |
| B5 "central-outage continuity" | R:33–35; S:12–13 (§1.2) | **PROVEN** | Same proofs as A6 — `tests/federation/e2e.mjs:407`/`:412`/`:424`/`:493`/`:499`; `tests/federation/failover.test.js:120`/`:348`; `tests/federation/queue.test.js:338` (outage write absorbed, `202` + `X-Federation-Queued-Write-Id`). FED-GAP-04 extends this row: the outage also serves a real free-tier completion (`tests/federation/e2e.mjs` degraded-phase checks) | E2E 38/38 (20 at this artifact's revision + FED-GAP-04's 18); failover 16; queue 13 |
| B6 "proved a healthy gateway/dashboard, API-key creation, and streaming through two OpenCode Free models in standalone mode" | B `DF-9ROUTER-15` detail | **PARTIAL** | API-key **creation** PROVEN: `tests/unit/db-sqlite-vs-lowdb.test.js:50` `apiKeys: create/get/validate/delete` (asserts `k.key` matches `/^sk-/`, `isActive` true) and `tests/federation/failover.test.js:597` (central applies an edge-queued `POST /api/keys`, derives `machineId`). OpenAI streaming **contract** proven: `tests/unit/openai-stream-done-sentinel.test.js:121` `emits exactly one data: [DONE] when the upstream is a forced-stream Responses API`. OpenCode free tier disposition proven: `tests/unit/provider-free-tier-honesty.test.js:64` `flags opencode as vendor-client-only and leaves genuinely credentialless providers unflagged`. **Missing:** no check boots the gateway and performs a real completion through a free OpenCode model, and no check serves the real `/api/health` route. **Closed by FED-GAP-04 (2026-09-18) except the OpenCode-specific half:** the real `/api/health` route is now asserted, and a network-free free-tier completion streams to a terminal `[DONE]` through the real route — `tests/federation/health-route-and-free-tier.test.js` (focused) + `tests/federation/e2e.mjs` checks 2–5/16–18 (standalone, edge→central, degraded edge). The OpenCode free tier stays unreproducible by design: `open-sse/providers/registry/opencode.js` carries `requiresVendorClient: true` and answers `403 FreeTierError` outside OpenCode's own client, so the completion is proven with the app's genuinely credentialless free provider (`mimo-free`), derived from `FREE_PROVIDERS` at run time | 23 passed; 5 passed; 4 passed (see §2.3) |
| C1 "Time to first success was 43 seconds" | B `DF-9ROUTER-20` detail + `reasoning.note` (`t2fs 43s`) | **UNPROVEN** | None. `grep -rn '43 sec\|time to first\|t2fs' tests/ docs/` returns no match outside the board row itself | n/a |
| C2 "the published package served health" | B `DF-9ROUTER-20` detail | **PARTIAL** | `tests/unit/cli-port-resolution.test.js:460` asserts the launcher's readiness probe — `expect(await healthOn(envPort)).toEqual({ status: 200, body: '{"ok":true}' })` (helper at `:244`) — against the test's **stub** child, not the real route; `tests/unit/cli-build-artifacts.test.js:64` `merges complete API routes and provider chunks for the ${name} layout` asserts the packaged server build contains the API-route artifacts. **Missing:** no test imports `src/app/api/health/route.js`, so the real route's `{ok:true}` response is not asserted anywhere (`grep -rn 'api/health/route' tests/ --include=*.test.js` → no match). **Closed by FED-GAP-04 (2026-09-18):** `tests/federation/health-route-and-free-tier.test.js:45` imports the route module (real `NextResponse`, no `next/server` mock) and asserts `200` + exactly `{ok:true}` + the CORS headers + the `OPTIONS` 204 preflight; `tests/federation/e2e.mjs` asserts it over HTTP on three spawned instances with file+sha256 provenance, and boots one instance with the route file replaced by the old harness-only body to prove the assertion is load-bearing. What remains FED-GAP-05 is the *packaged* `node custom-server.js` boot (`grep -rn 'api/health/route' tests/ --include=*.test.js` now matches only the route-module import above, not a packaged boot) | cli-port-resolution 28 passed; cli-build-artifacts 4 passed; health-route-and-free-tier 5 passed |
| C3 "dashboard login ... worked" | B `DF-9ROUTER-20` detail | **PARTIAL** | `tests/unit/auth-status.test.js:44` `reports an authenticated session when the auth cookie is valid`; `tests/unit/dashboard-guard.test.js:304` (`dashboard guard local-only access`) and `:375` (`dashboard guard federation API access (FED-012)`) enforce the session/API-key gate; `tests/unit/api-reference-auth-claims.test.js:187` `ships the POST /api/keys example with the login step before the create call`. **Missing:** no test exercises `POST /api/auth/login` itself — the route is referenced by tests only as a path string (`grep -rn 'api/auth/login' tests/` → `api-reference-auth-claims.test.js:191`, `local-request-peer-trust-3294.test.js:188`) | auth-status 3 passed; dashboard-guard 35 passed; api-reference-auth-claims 14 passed |
| C4 "API-key round-trip worked" | B `DF-9ROUTER-20` detail | **PROVEN** (HTTP chain closed by FED-GAP-07, 2026-09-18; repo-level half unchanged) | `tests/federation/api-key-http-auth-chain.test.js` — 10 tests, real modules, **no mocked validator**: the real `src/app/api/keys/route.js` `POST` answers `201` with exactly `{key,name,id,machineId}` and its `id` is an ACTIVE row in `getApiKeys()` (`src/lib/db/repos/apiKeysRepo.js`); a REMOTE peer request (`x-9r-real-ip: 203.0.113.7`, no CLI token) to `/v1/models` — and to `/v1/chat/completions` — carrying `Authorization: Bearer <that key>` passes the real `src/dashboardGuard.js` `proxy()` (pass-through asserted as `status 200` + `x-middleware-next: "1"`); negative controls: no key → `401 {"error":"API key required for remote API access"}`, same-shape bogus key → the same `401`, and `updateApiKey(id,{isActive:false})` → the previously accepted request 401s again while reactivation restores it. Red-proven: loopback-peer fixture → 4 failed; `vi.mock` of the validator's module → the file's own realness assertion fails; guard key check bypassed → 3 failed. Prior half retained: `tests/unit/db-sqlite-vs-lowdb.test.js:50` `apiKeys: create/get/validate/delete` — create → `validateApiKey(k.key)` truthy, `validateApiKey("invalid")` falsy → delete → gone. The gap this row named (the HTTP guard path consuming a **mocked** `validateApiKey`, `tests/unit/dashboard-guard.test.js:25`) is what the new file closes | api-key-http-auth-chain 10 passed (10); db-sqlite-vs-lowdb 23 passed; dashboard-guard 35 passed; full suite 2822 total / 2677 passed / 84 failed / 61 pending + `verify-no-regression.mjs` → `✅ No regression. (now fails=84, baseline known=84, all known)` |
| C5 "an active free OpenCode model returned dogfood-ok through OpenAI streaming" | B `DF-9ROUTER-20` detail | **PARTIAL** | `tests/unit/openai-stream-done-sentinel.test.js:121` `emits exactly one data: [DONE] when the upstream is a forced-stream Responses API` (plus `:132`, `:139`, `:146`) proves the OpenAI streaming terminator contract; `tests/unit/provider-free-tier-honesty.test.js:64` proves how the free OpenCode tier is classified/displayed. **Missing:** no automated check performs a real completion, so the literal `dogfood-ok` payload through a free OpenCode model is not reproducible by a command. **Closed by FED-GAP-04 (2026-09-18) for the free-tier completion path:** a network-free run drives the real `POST /v1/chat/completions` route for the app's credentialless free provider (`mimo-free`, `FREE_PROVIDERS` → `noAuth` → the virtual `Public` connection), asserting `200` + `text/event-stream` + the terminal `data: [DONE]` + the fixture's delta content, at three levels (focused test, standalone instance, LINKED edge→central relay, DEGRADED edge with central down). The provider's own OUTBOUND transport is answered locally, and the fixture records the request it served, so "the free-tier provider really ran" is asserted rather than inferred (`tests/federation/free-tier-fixture.mjs`). Not reproduced: the literal `dogfood-ok` string and OpenCode specifically — `opencode` free models carry `requiresVendorClient: true` (403 `FreeTierError` outside OpenCode's client), so the honest check uses the provider the app classifies as genuinely credentialless | openai-stream-done-sentinel 4 passed; provider-free-tier-honesty 5 passed; health-route-and-free-tier 5 passed; E2E 38/38 |
| C6 "13 frictions and failures in the other advertised compatibility paths" | B `DF-9ROUTER-20` detail + `reasoning.note` (`friction 13`) | **UNPROVEN** | None. No compatibility-path sweep exists: the translator suites are per-provider format tests (`tests/translator/`), and `grep -rln 'compatibility path\|compat matrix' tests/ docs/` matches nothing. The only friction records are prose (`docs/dogfood/2026-08-20-integration.md:147`, `docs/dogfood/2026-09-01-integration.md:50`) | n/a |

**Verdict counts: PROVEN 4 · PARTIAL 7 · UNPROVEN 3 · OUT-OF-FORK-SCOPE 6** (20 claim rows; A1–A8
from `DF-9ROUTER-10`, B1–B6 from `DF-9ROUTER-15`, C1–C6 from `DF-9ROUTER-20`).

## 4. Why this row mixed two different claims

`DF-9ROUTER-10`'s detail places "no successful model completion", "the claimed 20–40% token savings"
and "uninterrupted automatic fallback" in one sentence. They come from two different sources with
two different owners:

1. **The 20–40% token savings figure is upstream marketing for RTK**, a ported Rust token-compression
   pipeline — not a federation feature. Its carrier lines are `README.md:6` ("Save 20-40% tokens with
   RTK + auto-fallback to FREE & cheap AI models."), `README.md:59` ("**RTK Token Saver** -
   Auto-compress tool_result content, save 20-40% tokens per request"), and its repetitions at
   `README.md:90`, `:765`, `:952`, `:964`, `:1036`, `:1371`, `:1697`, `:1801` — the ten lines the
   probe `grep -n '20-40' README.md` returns.
2. **The federation deliverable makes no token-savings claim at all.** The fork section is
   `README.md:26`–`:45`; it describes edge→central proxying, SQLite replication with queued writes,
   one frontend per host, and standalone-by-default. Neither `20-40` nor any token-savings statement
   appears in that range (`awk 'NR>=26 && NR<=45' README.md | grep -in 'token\|20-40'` matches only
   the env var `FEDERATION_TOKEN` on line 43). `docs/federation-spec.md` contains no `20-40` at all
   (`grep -n '20-40' docs/federation-spec.md` → no match); its only `token` matches are
   `count_tokens` (§3.2, line 79) and `FEDERATION_TOKEN` (lines 83, 96, 150, 178). `docs/FEDERATION.md`
   has no RTK or `20-40` reference either.

Consequently the savings figure is classified `OUT-OF-FORK-SCOPE` in the matrix, and no federation
claim above is described using that number. The federation's own continuity claim
(`README.md:33–35`, `docs/federation-spec.md:12–13`) is separately proven by the outage/recovery
checks at `tests/federation/e2e.mjs:407`–`:522`.

Note on scope of the second half: commit `f65977c7` (`tests/federation/e2e-child.mjs`, `e2e.mjs`,
+148/−1) closed the "no successful model completion" half of the row with three assertions; that is
recorded in rows A4 and §2.1 above. The row text predates that commit (board `ts`
`2026-09-13T13:10:59.889Z`; `f65977c7` dated 2026-09-18).

### 4.1 Side observation (verified, not a claim in these three rows)

`README.md:41` points readers to "`.env.example`, lines 41–51" for the federation variables, but
those lines hold cloud/proxy/SearXNG settings. The `FEDERATION_*` block is at `.env.example:53–70`:

```
$ grep -n 'FEDERATION' .env.example
53:# Federation variables (docs/federation-spec.md §4 — optional unless FEDERATION_MODE
61:FEDERATION_TOKEN=change-me-to-a-long-random-federation-token # Shared secret, ...
62:# FEDERATION_MODE=standalone            # standalone | central | edge
...
70:# FEDERATION_REDACT_FIELDS=             # Optional JSON-path redaction (proxy-only edges)
```

This is a stale line pointer in the fork section itself, not a federation behaviour defect; no
matrix row depends on it.

## 5. Gaps — one candidate board row per UNPROVEN or PARTIAL claim

These are candidate rows for the foreman to file; this artifact does not file them.

| Suggested id | Title | PASS criterion |
|---|---|---|
| `FED-GAP-01` | Assert the API-key replica chain end to end (edge write → central → both edges) | One check writes an API key through an edge and asserts the row exists at central and on BOTH edges after catch-up |
| `FED-GAP-02` | Read `revisionLag` in the federation E2E instead of inferring it from watermark equality | `tests/federation/e2e.mjs` asserts `revisionLag === 0` on both edges after they reach the central watermark |
| `FED-GAP-03` | Prove the subscription→cheap→free tier ladder, not just per-provider 429 handling | A check drives an exhausted subscription account into the cheap tier and then the free tier and asserts the selected provider per hop |
| `FED-GAP-04` | Automated check for gateway health / free-OpenCode completion (replaces manual `dogfood-ok`) | A runnable, network-free check asserts the real `GET /api/health` returns `{ok:true}` and the free-tier completion path returns a terminal `[DONE]` stream — **DONE 2026-09-18**: `tests/federation/health-route-and-free-tier.test.js` (5 passed) + `tests/federation/e2e.mjs` (38/38, adds 18 checks: real route over HTTP with file+sha256 provenance, the route-mutation red-proof, and the free-tier completion standalone / via a LINKED edge / from a DEGRADED edge). Achievement recorded in `docs/dogfood/2026-09-18-fed-gap-04-real-health-and-free-tier.md` |
| `FED-GAP-05` | Assert the published package serves the real `/api/health` route | A test boots the packaged/standalone server and asserts `GET /api/health` returns `200 {"ok":true}` from `src/app/api/health/route.js` |
| `FED-GAP-06` | Cover `POST /api/auth/login` end to end | A check posts credentials to `POST /api/auth/login` and asserts the session cookie it sets is accepted by a gated dashboard route |
| `FED-GAP-07` | Prove the HTTP API-key round-trip without a mocked validator | A check creates a key through the API and authenticates a `/v1` request with it against the real guard (no mocked `validateApiKey`) |
| `FED-GAP-08` | Make the RTK savings figure checkable or drop it from the fork's value story | Either a check asserts a measured token-reduction range on real tool outputs, or the fork's value artifact states the figure is upstream RTK marketing |
| `FED-GAP-09` | Record time-to-first-success as a reproducible measurement | A scripted run records a T2FS number with the exact steps and environment, so the 43 s/44 s figures are re-measurable |
| `FED-GAP-10` | Record the friction count for a dogfood run as data, not prose | A dogfood artifact lists each friction as a numbered, individually reproducible item so the 13/16 counts are auditable |

## 6. Reproduce

Run in this order from `/home/kara/9router` (no network, no credentials, no `RUN_REAL`):

```bash
# 0. confirm the revision this artifact describes
git -C /home/kara/9router rev-parse HEAD          # 67b9759918aeebfb67709bb8cce689b983043cf4

# 1. federation E2E (20 checks, includes the three f65977c7 completion-path checks)
cd /home/kara/9router && npm run test:e2e

# 2. federation vitest suite
cd /home/kara/9router/tests && npx vitest run federation/

# 3. per-file runs of the further cited proofs
cd /home/kara/9router/tests
npx vitest run federation/failover.test.js
npx vitest run federation/replication.test.js
npx vitest run federation/local-status.test.js
npx vitest run federation/queue.test.js
npx vitest run federation/proxy.test.js
npx vitest run unit/rtk.test.js
npx vitest run unit/rtk.e2e.test.js          # expected: 4 skipped (RUN_E2E gate)
npx vitest run unit/combo-routing.test.js
npx vitest run unit/antigravity-quota-routing.test.js
npx vitest run unit/base-executor-retry.test.js
npx vitest run unit/fresh-install-model-catalog-339.test.js
npx vitest run unit/provider-free-tier-honesty.test.js
npx vitest run unit/dashboard-guard.test.js
npx vitest run unit/auth-status.test.js
npx vitest run unit/api-keys-put-rename.test.js
npx vitest run unit/db-sqlite-vs-lowdb.test.js
npx vitest run unit/api-reference-auth-claims.test.js
npx vitest run unit/provider-display-split.test.js
npx vitest run unit/openai-stream-done-sentinel.test.js
npx vitest run unit/cli-port-resolution.test.js
npx vitest run unit/cli-build-artifacts.test.js
```

Read-only probes used for the structural claims (no writes):

```bash
grep -n '20-40' README.md                                  # the RTK marketing lines
grep -n '20-40' docs/federation-spec.md                    # no match — the fork makes no such claim
awk 'NR>=26 && NR<=45' README.md | grep -in 'token\|20-40' # only FEDERATION_TOKEN (line 43)
awk 'NR>=53 && NR<=70' .env.example                        # where the FEDERATION_* vars actually live
grep -c '^import p' open-sse/providers/registry/index.js   # 119 active registry imports
grep -n 'revisionLag' tests/federation/e2e.mjs             # no match (Gap FED-GAP-02)
grep -rn 'api/health/route' tests/ --include=*.test.js     # no match (Gap FED-GAP-05)
```

## 7. Files

* `docs/dogfood/2026-09-18-federation-value-claims.md` (this artifact) — the only file changed by
  this work.
