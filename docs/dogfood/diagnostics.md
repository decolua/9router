# 9Router Federation — Diagnostics Trail (2026-08-08 dogfood)

_How the federation feature is built, what the dogfood run found, and the right way to
understand/fix it. Written by the 2026-08-08 dogfood run; board tasks FED-011..FED-016._

## 1. The architecture in one paragraph

9router is a Next.js 16 app (plain JS ESM, `@/*` → `src/*`) that fronts 40+ AI providers
with an OpenAI-compatible `/v1` API + dashboard. The federation fork adds three layers,
all gated on `FEDERATION_MODE` (default `standalone` = zero drift):

1. **DB layer** (`src/lib/federation/stamp.js`, migrations `00NN_federation*`): versioned
   config tables (`federation_version`, `updated_at`, `deleted` tombstones on the 8 config
   tables), `federation_meta` (role, edgeId, lastAppliedRevision, schemaVersion,
   leaseOwner/leaseExpiry, last_state, fencing_token), `pendingWrites`.
2. **Central API** (`src/lib/federation/server.js` + `src/app/api/federation/*` route
   wrappers): `snapshot`, `delta`, `verify`, `status`, `replay`, `local-status`,
   `config-status`, guarded by `src/lib/federation/roleGuard.js` (Bearer
   `FEDERATION_TOKEN`, SHA-256 pre-hash constant-time compare).
3. **Edge machinery** (`src/lib/federation/edgeClient.js` replication poll,
   `failover.js` heartbeat/state machine, `proxy.js` forwarding layer,
   `queue.js` degraded write queue) — wired into `custom-server.js`, which wraps
   `http.createServer` for the Next standalone server and sits **before** Next dispatch.

The forwarding decision is `proxy-up-by-default`: any request that matches `/v1/*` or a
mutating dashboard API path is proxied to central unless the edge is DEGRADED.

## 2. How the dogfood run found what it found

Reproduction-first, with real servers, in ~50 minutes:

- Assembled the exact `Dockerfile.federation` runtime layout in `/tmp` (standalone output
  + `custom-server.js` + `open-sse` + full `src/` + `node_modules/@` → `src` alias).
- Booted central (20131) + edge (20132) with `node custom-server.js` — the containers' CMD.
- Mock Ollama upstream (`/api/chat`, `/api/tags`) so real chat completions flowed.
- Watched the edge's replica DB (`better-sqlite3` read-only) and logs for ~6 minutes.
- Killed central with SIGKILL; watched state; restarted central; watched again.

## 3. Errors hit and their root causes (yours AND the project's)

| Error observed | Root cause | Task |
|---|---|---|
| `{"error":"Invalid API key"}` from central when proxying a valid client key via the edge | `buildUpstreamHeaders` moves `Authorization` → `X-9r-Client-Authorization`; central /v1 auth never reads it ("inert when absent"). Client key never reaches central's auth. | FED-011 |
| `{"error":"Unauthorized"}` on `/api/federation/status|verify|snapshot` with correct Bearer token; also on `local-status` with no auth | dashboardGuard (`src/proxy.js`) deny-by-default for `/api/*`; `/api/federation` missing from `PUBLIC_API_PATHS`. Guard runs before roleGuard. | FED-012 |
| Edge replica stays empty forever; `last_state` stays null; no log lines | `edgeClient.start()` / `failover.start()` never called outside the e2e harness. `custom-server.js` loads modules but never starts loops. | FED-013 |
| DEGRADED edge answers `/v1` with `Invalid API key` (replica empty) | consequence of FED-013 (no replication) — the failover machinery itself works (flip persisted `degraded`, queue accepted writes) | FED-013 |
| After central restart: edge stuck DEGRADED, `pendingWrites` never drain, central never reconciles | no heartbeat loop → nothing detects recovery (consequence of FED-013) | FED-013 |
| `npm run start` edge: no proxy at all, silently | `next start` doesn't load `custom-server.js`; only the Docker CMD does | FED-014 |
| Plain `Dockerfile` image edge: federation imports fail open, silently inert | image ships only `src/mitm`; Next tracing doesn't follow dynamic imports; only `Dockerfile.federation` copies `src/` | FED-015 |
| Central `/api/federation/status` shows `revisionLag: 3` on itself; `local-status` shows `linked` while nothing ever ran | status metrics computed naively; `last_state` defaults to LINKED on an empty meta row — masks "never started" | FED-016 |
| `mock-model-7b` → `No active credentials for provider: openai` | model IDs need the provider prefix (`ollama-local/mock-model-7b`); routing falls back to a default provider otherwise | (cosmetic, docs) |

## 4. The right way (what the fixes must look like)

1. **Start the loops where the process boots.** `custom-server.js`'s `listening` handler is
   the natural place (it already lazy-loads the modules): call `edgeClient.start()` +
   `failover.start()` there when `FEDERATION_MODE=edge`, with the env-driven intervals.
   `src/instrumentation.js` is the fallback for non-custom-server boots. The e2e harness
   should stop being the only starter.
2. **Make the guard pass the protocol through.** Add `/api/federation` (and
   `/api/federation/*`) to `PUBLIC_API_PATHS` in `src/dashboardGuard.js`. roleGuard already
   enforces the Bearer token with constant-time compare; `local-status`/`config-status` are
   intentionally token-less. This is the documented contract (FEDERATION.md §4/§5).
3. **Preserve client auth through the proxy.** Either central's /v1 auth falls back to
   `X-9r-Client-Authorization` when `Authorization` is the federation token, or the proxy
   keeps the client's `Authorization` and moves the federation token to a dedicated header
   (e.g. `X-Federation-Token`) that only central's federation API accepts. The latter is
   cleaner: `/v1` and dashboard API keep looking exactly like direct requests.
4. **Make inert loud.** A `FEDERATION_MODE=edge` boot without the modules (plain Docker
   image) or without the custom-server wrapper (`npm run start`) should print a clear
   error/warning naming the missing piece — never fail open silently.
5. **Fix the status surface.** `local-status` should report `uninitialized` when
   `lastAppliedRevision IS NULL`; central's `revisionLag` should not count its own writes.

## 5. How to verify the fixes (L3 acceptance — real use, not unit tests)

See the acceptance checks in `docs/dogfood/2026-08-08-integration.md`. Minimum: an edge
started via the documented Docker/README path converges its replica within ~15s, serves an
authenticated `/v1` completion through the proxy, flips DEGRADED on central death, still
serves from the replica, queues writes, and recovers + reconciles when central returns.

**Status (2026-08-12): re-verified PASS — see
`docs/dogfood/2026-08-12-federation-l3-reverify.md`.** All four acceptance checks (A: converge,
B: authenticated proxying, C: Bearer-only API, D: kill/restart lifecycle with drain) now pass
against the current `federation` branch. The re-run surfaced and fixed one new integration bug
(queued `POST /api/keys` replays failed with `machineId is required` — server.js now derives
machineId like the direct route).

## 6. Why the e2e harness missed all of this

`tests/federation/e2e.mjs` + `e2e-child.mjs` build a **framework-free** node:http server
(`next/server` is not importable outside a Next build), start `edgeClient`/`failover`
**explicitly** (lines 262/266), and inline roleGuard semantics — so it never exercises:
custom-server.js wiring, dashboardGuard, the real route wrappers, or the real /v1 auth.
It proves modules, not product. Any future e2e must boot the real app (the dogfood repro
layout is the blueprint: standalone output + custom-server.js + src) and hit it over HTTP.

---

# Addendum 2026-08-20 — second dogfood run: what still breaks, and why

_After the 2026-08-12 reverify (A–D PASS), a second real-use run re-verified A–D
(ALL PASS — see `docs/dogfood/2026-08-20-integration.md`) and then probed
replica integrity. The row-level version metadata on edges is corrupted by the
delta path. This is the "what the reverify missed" record._

## 7. The delta-apply version drop (FED-020) — a test-shaped blind spot

**Symptom:** on a converged edge, `local-status` reports
`lastAppliedRevision:5, maxVersion:1, revisionLag:0` — an applied watermark
*above* the local row watermark, with lag clamped to 0. Direct DB comparison:

| row | central | edge |
|---|---|---|
| key created before edge bootstrap (snapshot path) | v1 | v1 ✅ |
| key created after (delta path) | v4 | **v0, updated_at NULL** ❌ |
| provider row re-stamped on central (delta path) | v5 | **v0** ❌ |

**Root cause (read the wire, then the code):** the central delta handler
serializes entries as `{table, row, federation_version, updated_at, deleted}`
— version metadata at ENTRY level. `applyRevisionBatch`'s delta branch
destructures `{ table, row }` and calls `upsertLogicalRow(db, table, row)`,
which reads `entry.federation_version` — always undefined on the delta path →
`0`. The snapshot branch passes full entries, so bootstrap rows are correct.

**Why the tests missed it (the lesson):** `replication.test.js` (24 tests)
asserts row COUNTS and the `lastAppliedRevision` watermark — both stay green
while versions corrupt. The 2026-08-12 reverify also only checked counts +
lag. The check that catches this: compare the edge row's
`federation_version`/`updated_at` to central's after a delta-delivered update,
or assert `local-status.maxVersion == lastAppliedRevision` on a converged
edge. **Assert the data, not just the counters.**

**Right way:** delta branch passes the full entry —
`for (const entry of rows) upsertLogicalRow(db, entry.table, entry)` — plus a
regression test that updates a row on central after bootstrap and asserts the
edge replica keeps the entry's version/updated_at.

## 8. The status metric's second failure mode (FED-021)

`revisionLag = max(0, localWatermark - lastAppliedRevision)` — even after
FED-020, lag measured against the EDGE's own (possibly corrupted, possibly
stale) rows can't tell "healthy" from "stale". The edge already receives
central's true watermark (`maxVersion`) in every snapshot/delta payload —
compute lag against that. FED-016 fixed central's self-lag; this is the
edge-side twin: a metric that only reports what the replica's own (mutable,
corruptible) rows say.

## 9. Settings: an eighth table that never moves (FED-022)

The docs/constants promise 8 replicated tables; in practice `settings`
replicates only via snapshot timing. Boot seed `src/lib/db/migrate.js:116` is
a raw insert that skips stamping → `federation_version=NULL` → the delta query
(`> ?`) excludes it forever. `settingsRepo.js:107` stamps, so dashboard-driven
settings changes would flow — but the seed (password hash, defaults) never
does, and an edge that snapshots before central's first seed keeps `settings=0`
indefinitely. Decide: stamp the seed, or document settings as per-instance and
drop it from `REPLICATE_TABLES`.

## 10. The right way to verify federation (updated playbook)

1. Boot central + edge via `npm run build && node custom-server.js` (repo
   root works — FED-017) with fresh DATA_DIRs and fast intervals
   (SYNC 2000 / HEARTBEAT 1000 / OUTAGE 5000).
2. Check the edge boot log for `[federation] replication + failover loops
   started` — no line, no federation.
3. Seed via dashboard API (login → keys → providers), then run acceptance
   A–D from `docs/dogfood/2026-08-20-integration.md`.
4. **Then check integrity** (the step both prior runs skipped): compare row
   `federation_version`/`updated_at` between central and edge for rows that
   changed AFTER the edge bootstrapped; assert
   `local-status.maxVersion == lastAppliedRevision` on a converged edge.
5. `stream:false` only for mock-upstream verification; `stream:true` fails
   503 with the mock on central AND edge (mock format limitation, not a
   federation bug — re-verify against a real Ollama before shipping).

## 11. Run 3 (2026-09-01): the fixes held — what re-verification looks like when it passes

Run 3 repeated the full L3 playbook at HEAD (`cd90fd9e`) and every check
passed, including row-level probes. Three lessons worth keeping:

1. **The row-level probe is the sensitive canary, not the status metric.**
   The delta-apply corruption (FED-020) never showed in `revisionLag` while
   it was live, and its absence now only becomes *proven* by comparing
   `federation_version`/`updated_at` per row across central and edge after a
   delta update. Run 3 did this for apiKeys (v4 delta), settings (v6), and
   combos (v7): versions and `updated_at` matched on both sides. Keep this
   step first when any future acceptance check regenerates doubt.
2. **A fix can regress only where the test suite can't see.** The three
   fix commits (25790823, f825ae5b, fa3cb076) each shipped with unit tests
   — yet the 08-20 bug also had "coverage" and shipped. What actually
   caught the original bug was real-boot behavior (loops starting from real
   entry points), and what proves the fixes is still real-boot behavior.
   The vitest federation suite passing at HEAD (run 3: 12 files, 189 tests,
   0 fail, ~2s) is corroborating evidence, never the verdict.
3. **Recovery latency is observable but undocumented.** Edge re-link after
   central restart took ~15–20s in run 3 (SYNC 2000/HEARTBEAT 1000/OUTAGE
   5000): heartbeat successes flip state quickly, but the drain + delta
   catch-up + replay cycle dominates. During the outage the edge logs one
   `[federation] pull failed: fetch failed` per sync interval (filed R3-03).
   Expect a bounded window of `degraded` after restart and don't panic-fix.

## 12. Run 4 (2026-09-19, HEAD 585bd31c): standalone + federation both hold; the gap moved to onboarding

Run 4 was a full fresh-user pass — scratch standalone instance AND a real
central+edge federation pair, all acceptance checks A/A+/B/C/D passing. What
the run taught:

1. **The hard part of local-endpoint wiring is the two-object model.** A
   "provider node" (`providerNodes` table, user-defined prefix → baseUrl) and
   a "provider connection" (`providerConnections`, holds the credential) are
   separate rows; chat traffic only works when BOTH exist and the connection's
   `provider` field equals the node id. `POST /api/provider-nodes` creating a
   node with no credential attached is the trap: the model routes
   (`src/sse/services/model.js` matches the prefix) but auth finds zero
   connections and the user sees `No active credentials` with no hint that a
   second call is needed. Right way: node first, then
   `POST /api/providers {provider: <node.id>, apiKey: …}`.
2. **Executor protocol families are invisible at the API surface.**
   `ollama-local` speaks Ollama's native `/api/chat`; an OpenAI-shaped server
   behind it yields HTTP 200 + `data: [DONE]` + `IN 0 · OUT 0` — a silent
   empty success rather than a protocol error. The generic escape hatch is an
   `openai-compatible` node (`apiType: "chat"`), which translated
   transparently. Lesson: when a local upstream "returns nothing", suspect the
   executor family first, before debugging the gateway.
3. **The outage window between central death and the edge's DEGRADED flip is
   fail-hard, not fail-open.** For ~1.5×OUTAGE_THRESHOLD_MS after the kill,
   `/v1` answers `FED_UPSTREAM_ERROR` while the replica is fully fresh
   (lag 0). Serving from the replica would be safe there; today the user sees
   the worst possible moment for an error. Filed DF-9ROUTER-31; watch this if
   failover state machine work ever lands.
4. **Re-verification recipe unchanged and still authoritative.** Boot from
   repo-root production path, run the four acceptance checks (A replication,
   A+ row-level version/updated_at equality, B edge-authenticated /v1, C
   Bearer-only federation API, D kill/queue/recover lifecycle) — all passed
   at this HEAD with zero config beyond the FEDERATION_* envs. The 09-01
   conclusion stands: unit green ≠ federation works; only the real-boot
   playbook is the verdict.

## 13. Run 5 (2026-09-20, HEAD 321268d5): the product promises under the federation plumbing

Every previous run judged federation and onboarding. This one went after what the README actually
sells — RTK token saving, auto-fallback, multi-account rotation, usage accounting — and found that
the layer below the federation work is where the lies live. The test suite is structurally unable
to see any of it, and it is worth understanding *why* before touching the code.

### How the money feature is wired (and that it is genuinely real)

RTK is not a marketing wrapper. The chain is:

`POST /v1/chat/completions` → `src/sse/handlers/chat.js` (combo/account selection, reads the
Token-Saver header) → `open-sse/handlers/chatCore.js:259`
`compressMessages(translatedBody, tokenSaverEnabled && rtkEnabled)` → `open-sse/rtk/index.js`,
which walks every tool-result shape (OpenAI `role:"tool"` string and array forms, Claude
`tool_result` blocks, OpenAI-Responses `function_call_output`, and the Kiro
`conversationState` shape) and replaces each blob in place → `open-sse/rtk/autodetect.js` picks a
filter from the first 4 KB by regex (`git-log`/`git-diff`/`git-status` → build output → grep →
find → tree → ls → read-numbered → dedup-log → smart-truncate) → the filter runs inside
`safeApply`.

Three properties are worth internalising, because they are what make the claim credible:

1. **`safeApply` is a real safety property, not a comment.** `compressText` rejects the filter
   output when it is empty or *larger* than the input, and keeps the original. Measured: a
   synthetic all-unique grep blob went 11119 → 12420 bytes and RTK returned the original
   unchanged; real `grep -rn` output went 11259 → 7641 (32.1% saved) and real `find` output
   7266 → 1926 (73.5%). A token saver that can *inflate* context would be worse than none.
2. **The saving is visible in the actual prompt.** The upstream sees a smaller prompt, not a
   differently-labelled one: `prompt_tokens` 3316 → 2592 for the RTK request, and back to 3483
   with `X-9Router-Token-Saver: off`.
3. **The per-request bypass header works** (`X-9Router-Token-Saver: off`), which is the right
   affordance for the case where you *want* the model to see raw output.

Lesson for future test authors: the RTK unit tests exercise the filters well but nothing asserted
the **end-to-end** saving, which is why "RTK works" had never been verified from outside. If you
ever change the executors' request assembly, re-measure `prompt_tokens` with and without the
header — that difference is the only honest test of this feature.

### Why usage accounting is empty — the guard that eats a whole feature

`open-sse/handlers/chatCore/requestDetail.js` records usage for the API-key/per-model/quota views
through `saveRequestUsage`. Directly above that call sits:

```js
const inTokens  = effective.input_tokens  ?? effective.prompt_tokens     ?? 0;
const outTokens = effective.output_tokens ?? effective.completion_tokens ?? 0;
if (inTokens === 0 && outTokens === 0) return;   // <-- drops the record
```

The guard reads as defensive (don't store junk), but it hides a contract break: on the **streaming**
path the counters are never populated, so every streaming request silently exits here. The
discriminator is one instance and one SQLite count:

| request | client sees | `usageHistory` rows |
|---|---|---|
| `stream:true` | SSE chunks | +1 |
| **`stream` omitted** | non-stream JSON | **+0** |
| `stream:false` | non-stream JSON | +1 |

Because coding CLIs stream by default, the rows stay at zero and `/api/usage/stats` reports
`totalRequests: 0` for a box that served a dozen completions — while the console prints
`📊 DONE … IN 0 · OUT 0` as if that were normal. **The right way** to fix this is to take the
counts from the stream's final usage chunk (the upstream already sends them) or estimate from
text length, and to make a *successful* request with all-zero usage a loud warning rather than a
silent skip. Never let a guard that protects data quality quietly amputate a product feature.

### The `data: [DONE]` tail: what actually triggers it

Symptom: `…"system_fingerprint":"…"}data: [DONE]` — a JSON body that no strict parser accepts.
Isolation: probe the upstream directly (clean), then vary exactly one field:

```bash
curl -s -X POST $B/v1/chat/completions -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json'   -d '{"model":"…","messages":[…]}' | tail -c 20        # }data: [DONE]   <-- broken
```

`stream:true` → proper SSE; `stream:false` → clean JSON; **`stream` absent → the broken hybrid**.
So the defect is in the branch taken when the flag is missing, and it is a *default* path — the
OpenAI SDK omits the key unless told otherwise. This is the same family as the old
"empty-as-success" gap: the response is assembled from the wrong shape for the path that most
clients take, and nothing errors. When a body must be JSON, assert it with a strict parser at the
boundary — a `res.json()` round-trip in a test would have caught this years ago.

### Fallback: the same guard, the wrong scope

`open-sse/services/combo.js` advances to the next model only when
`checkFallbackError(status, errorText)` says so. That helper
(`open-sse/services/accountFallback.js:57`) returns `shouldFallback:false` for 4xx except
401/402/403/429, with a good reason in its comment: a request-shaped 400 says nothing about the
*credential*, so cooling an account down would be wrong. But the combo caller is asking a
different question — "is the next *model* worth trying?" — and inherits the account answer. Hence
a combo whose first model doesn't exist dies on model #1 forever. If you fix this, keep the two
questions separate: **credential health** and **candidate viability** are not the same predicate,
and one function answering both is how a correct guard becomes a broken feature.

### Model discovery on a fresh node: what the 1-model listing tells you

On a brand-new install, `/v1/models` for a node pointing at a healthy 91-model upstream returned a
single id — a *combo name* the upstream's catalog happened to contain. A completion through the
same node succeeded, so routing works and only the listing is wrong; on the instance that had
synced the `dlm/` prefix, the same kind of node listed 90 ids. The observable rule is *an
un-synced prefix degrades to a placeholder set*, and the mechanism is not yet proven — treat the
board row (DF-9ROUTER-35) as a fix-me, not a doc-me. **The right way to test model listing from
now on:** create a node against an upstream with a prefix the local catalog has never seen, then
compare the gateway list against the upstream's own `/v1/models` count. A count mismatch is the
test; "the dashboard looks fine" is not.

### Re-verification playbook for this surface (new, keep it)

```bash
# 0. isolated instance (never the fleet router on :20128)
PORT=20127 DATA_DIR=/tmp/dogfood-9router data-dir … npm run start
# 1. wiring: login → node → connection → key (two objects, prefix field)
# 2. RTK: POST a real `grep -rn` blob as role:"tool" and compare prompt_tokens
#    with and without -H 'X-9Router-Token-Saver: off'   (expect a 20-40% drop)
# 3. usage: read the row count from SQLite around one streaming and one
#    explicit non-streaming request (expect +1 each)
# 4. fallback: combo [<nonexistent model>, <working model>] must answer 200
# 5. install leg: fresh bunker agent, clone → npm ci → dev → same completions
```

Numbers from this run are in `2026-09-20-integration.md`; the board rows are
DF-9ROUTER-32..37. Nothing in this run required a repo fix — the findings are tasks for the
foreman, and the diagnostics above are the "why", not a log dump.

## 14. Run 6 (2026-09-24, HEAD eb8fee31): the UI as a first-class bootstrap path, and the endpoint nobody drove

Eleven runs into this log, two surfaces had never been touched: the dashboard UI as the way a
HUMAN wires the product (agents before this always reached for curl), and `/v1/embeddings`.
Run 6 drove both. Headline: **the UI path works end-to-end and the 09-20 P0s no longer
reproduce** — but the pass found three defect classes that only this surface could expose.

### An env pin that outruns the UI: why 'Require API key' can be a silent no-op

The settings read path is `readRaw()` (the `settings` row) → `mergeWithDefaults()` — and at
`src/lib/db/repos/settingsRepo.js:91` the env override is applied **after** the DB merge:

```js
const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
const envRequireApiKey = envRequireApiKeyOverride();   // exact 'true'/'false' in REQUIRE_API_KEY
if (envRequireApiKey !== undefined) merged.requireApiKey = envRequireApiKey;
```

This is deliberate (QA-9ROUTER-5: a deployment can pin enforcement from the environment) and
it is fine *as far as it goes*. The gap is the contract between that design and the dashboard:
the README quickstart is `cp .env.example .env`, `.env.example:32` ships
`REQUIRE_API_KEY=false`, so **the documented quickstart permanently pins the field**. The UI
then PATCHes `requireApiKey:true`, the settings row really changes, the switch shows ON — and
the next read re-pins it from env. Unkeyed `/v1/chat/completions` keeps returning 200. The
PATCH route answers 200 because the *write* succeeded; only the *effective value* is
env-shadowed, and nothing in the response or the UI says so. Control experiment that proves
the endpoint itself is healthy: `PATCH {stickyRoundRobinLimit:5}` → GET returns 5.

The lesson generalises: **an env-over-DB precedence rule needs a UI contract** — the pinned
field must render disabled with the env var named, and the PATCH must refuse or annotate
instead of silently storing a value the next read discards. Instrumented `window.fetch` also
caught a non-deterministic **double-PATCH** (true then false, ~2s apart) on single clicks of
the same switch — a state race worth its own fix. When a security control can no-op, the
no-op must be observable.

### One feature, two accountants: estimate vs upstream on the non-stream path

The DF-33 fix made usage rows appear on both stream shapes — but the numbers differ in kind.
Streaming rows carry the **upstream's** usage chunk (2032 prompt tokens, matching the SDK).
Non-stream rows carry a **local estimate** (61 for the same request the SDK measured at 2061)
with no `estimated` marker. On reasoning models — the ones where prompt tokens balloon — the
estimate is off by ~30x, and the Usage page totals mix both kinds silently. And the
embeddings endpoint writes **no usage row at all**. The right way: one source of truth (the
upstream response object, which the non-stream path holds in hand before returning), estimate
only as labelled fallback, embeddings rows even at zero tokens. Quota tracking that mixes
measured and guessed numbers is worse on each side than either alone.

### Chaining 9router into 9router: prefix composition and the 95-second silence

Fresh-install leg wired a bunker box's 9router to the control-host scratch 9router (both
healthy). Two observations worth keeping:

1. **Ids double-prefix**: the fresh node lists `up/dlm/qwen3.8-27b` — the upstream's own node
   prefix stacks under the new prefix. A completion with the *natural* id (`up/qwen3.8-27b`)
   is what a user writes, and the router cannot resolve it.
2. **That mistake costs 95 seconds of silence** and then a *credential*-shaped error:
   `[400]: No credentials for provider: openai (reset after 1m 35s)`. The connection HAS
   credentials; the model id simply does not exist upstream. The combo retry window (a good
   idea for transient upstream failures) is the wrong shape for a request that can never
   succeed, and the final message names the wrong subsystem. Model-not-found from a
   compatible upstream should fail in <5s with a model-scoped message.

Also: DF-35's one-model fresh-node listing **does not reproduce at HEAD** (90 models listed
through the same wiring) — the import path was fixed sometime between 321268d5 and eb8fee31.

### Embeddings, first drive: the router passes vectors through honestly

`/v1/embeddings` with LM Studio's nomic-embed model: 3 vectors, 768 dims, ~1.3s, and a cosine
sanity check (paraphrases 0.726 vs paraphrase-vs-unrelated 0.349) confirming the router
neither transposes nor reorders vectors — through one hop AND through a two-hop chain from
the fresh box. The endpoint has been in the README's capability matrix since the beginning;
this is its first recorded real use, and it passes.

### Re-verification playbook for this surface (updated)

```bash
# 0. isolated instance (never the fleet router on :20128)
# 1. UI bootstrap: login → Providers → Add OpenAI Compatible → Add API Key → Import from /models
#    (count the imported ids; a fresh node must list ≈ the upstream's /v1/models count)
# 2. auth posture: with .env copied from .env.example, toggle 'Require API key' ON, then
#    POST /v1/chat/completions WITHOUT a key — a 200 here is DF-38 (must 401 or the UI must
#    disclose the pin)
# 3. embeddings: POST 3 inputs (2 paraphrases + 1 unrelated) — cosine(paraphrases) must
#    exceed cosine(paraphrase, unrelated); check a usageHistory row lands
# 4. usage parity: one stream:true and one stream-omitted request against a reasoning model;
#    the two promptTokens values must agree within ~5% (DF-39)
# 5. chain ergonomics: point a fresh instance at a 9router upstream; request the NATURAL id;
#    a model-scoped error must arrive in <5s (DF-40)
# 6. restart: kill + restart; models/keys/connections/usage must survive
# 7. federation: reboot the scratch as FEDERATION_MODE=central (same DATA_DIR), boot an edge
#    (FEDERATION_MODE=edge + FEDERATION_CENTRAL_URL + shared FEDERATION_TOKEN); the edge's
#    local-status must show linked/revisionLag:0, its replica DB must carry the UI-configured
#    node/connection/key/models, and /v1/chat + /v1/embeddings must serve FROM THE EDGE.
#    (Port note: the leftover federation-e2e container owns host :20129 — use :20131.)
```

Numbers from this run are in `2026-09-24-integration.md`; the board rows are
DF-9ROUTER-38..41. Install leg: bunker-las-03 agent 6b0e3ee4 (clone 3s, install 39s,
two-hop chain OK, agent destroyed). Nothing in this run required a repo fix.

## 15. The bump that only a fresh machine could feel: undici 8 x patched fetch x Next (2026-09-25)

**How the layers fit together.** 9router routes every upstream call through a patched
`globalThis.fetch` (`open-sse/utils/proxyFetch.js`): the wrapper is tagged with a
process-wide symbol so module re-evaluation cannot stack copies (QA-9ROUTER-18),
unwraps to the real fetch at call time, and only injects an undici `ProxyAgent`
dispatcher when a proxy is configured. Media handlers (image/TTS/STT/search) then call
`providerResponse.json()` on the result (`imageGenerationCore.js:183`,
`ttsProviders/gemini.js:81`) and parse Gemini's JSON. Transparency of gzip decoding is
therefore a load-bearing property of the whole chain — nobody's code ever asks
"am I compressed?" because fetch is *supposed* to have handled it.

**What broke and why only fresh installs.** Commit 89c0084f bumped undici
`^7.19.2 -> ^8.11.0`. On undici 8, somewhere in the wrapper/dispatcher/Next-runtime
combination, the response body that reaches `.json()` is still raw gzip
(`\x1f\x8b` bytes), so JSON.parse throws `Unexpected token '\u001f'`. The error
handler then locks the (single) account for 30s, so retries show a *different*
wrong error. The three deployed instances never saw it because their node_modules
were baked before the bump (the :20128 rig is next 16.3.4 / undici 7.x and serves
the same calls 200) — and the e2e suite can't see it either, because vitest runs
without the Next runtime and without the proxyFetch install, so `.json()`
decompresses fine in tests. The proof chain (all on one throwaway bunker agent):
commit 699edac3 (undici 7) chat 200 → checkout HEAD + npm install chat 503 →
`npm install --no-save undici@7.19.2` + restart, same HEAD, chat 200.

**The right way to prevent this class.** A dependency bump of the HTTP stack needs
a fresh-install smoke that fires one real upstream call, not just a unit suite;
the install leg of dogfood exists exactly for this and caught it within minutes.
Candidate fix directions (for the foreman, filed as DF-9ROUTER-42): pin undici
back to ^7, or make the patched fetch guarantee decompression, plus a regression
test that boots the real server (or at least imports proxyFetch the way Next does)
and round-trips a gzip upstream response through `providerResponse.json()`.

### The cooldown mask (DF-9ROUTER-45, general lesson)

One bad upstream response → `[AUTH] all 1 accounts locked ... reset after 30s`,
and the *user-visible* error becomes the lock, not the cause. For a single-connection
free-tier user the provider is fully down for 30s per mistake, and debugging the
original error is impossible from the surface. Request-scoped failures (400 bad
request, unsupported MIME, unknown model) should never trip an availability cooldown;
the surfaced message should carry the upstream error text.

### Re-verification playbook for the multimodal surface

```bash
# 0. fresh clone + npm install (the install leg IS the test for DF-42)
# 1. image: POST /v1/images/generations {model:gemini/gemini-2.5-flash-image,...} -> PNG magic bytes
# 2. tts:   POST /v1/audio/speech  {model:gemini/gemini-2.5-flash-preview-tts,...} -> RIFF WAVE
# 3. stt:   POST the WAV back, once WITHOUT and once WITH ';type=audio/wav' (DF-43)
# 4. search:POST /v1/search {"provider":"gemini","query":...} -> 200 with results
# 5. fetch: POST /v1/web/fetch {"provider":"gemini",...} -> expect the honest 400
#           'does not support web fetch' (Gemini has no fetchConfig; needs jina/tavily creds)
# 6. lock:  after ANY failure above, wait out the 30s lock before the next probe
```

Numbers from this run are in `2026-09-25-integration.md`; board rows
DF-9ROUTER-42..46. Install leg: bunker-las-03 agent 0b251c72 (clone 3s,
npm install 87s, boot <60s, bisect chain complete, agent destroyed).

## 16. Run 15 (2026-09-25, HEAD b9f1e162): the compose deployment surface — the federation promise holds with containers as the unit

**Why this run exists.** 14 prior runs exercised bare-process deployments and every
product surface; none ever drove the docker-compose path (bunker battery compose
cells always died on the plugin; a 09-13 attempt left `dogfood9routerfed-*` images
and no doc trace). The compose files are a primary promise for a self-hosted
gateway, so run 15 used them the way a user does — `up`, seed, traffic, outage,
recovery, upgrade — with containers as the unit.

**How the pieces fit.** `docker-compose.yml` = standalone with published images
(`decolua/9router` — upstream code, no federation) + headroom sidecar.
`docker-compose.local-build.yml` is an OVERRIDE that swaps only the 9router image
for a locally built `9router:local`. `docker-compose.federation.yml` builds three
instances from `Dockerfile.federation` (standalone image + full `src/` + the `@/`
alias symlink that untraced dynamic federation imports need). All shared secrets
come from the repo `.env` via `env_file` (7f25e31a) — identical values on every
instance is what makes edges trust central. Port/prefix vars move only the HOST
side; the intra-network URL stays `http://central:20128`.

**What was proven live** (full detail in `2026-09-25-compose-integration.md`):
federation lifecycle A/A+/B/C/D all PASS with `docker stop`/`start` as the outage
unit — replica serving during the outage, 202 + queued-write header, ~20s re-link,
reconcile to both sides, row-level integrity byte-identical (the FED-020 probe run
inside the containers). Standalone quickstart, headroom sidecar wiring, upgrade
in place (249s, data kept), and a fresh-daemon cold install (271s → completion)
all PASS.

**The lesson this run teaches.** Container names and ports were made overridable
(981c7f6e) but compose PROJECT identity was not: `FEDERATION_STACK_PREFIX` renames
containers while the project name (default `9router`) still owns the network and
volume names, and `docker-compose.yml` even pins volume `name: 9router-data`
globally. The documented coexistence command therefore resolves onto the LIVE
stack's volumes silently — `compose config` shows zero warnings (DF-9ROUTER-48).
The mental model for the fix: prefix vars = container identity; `-p` = state
identity; a deploy command needs BOTH. Second lesson: DOCKER.md documents the
open-the-dashboard step but never the login (DF-9ROUTER-49) — a deployment doc
that ends at "open http://localhost:20128" ends one step before the user's first
success.

**Numbers** (N100 control host): federation build+boot 247s; standalone up 19s
warm; swap-to-local 249s; cold fresh-daemon install 271s; /v1/models through the
router 180-209ms (vs 363ms direct — the model cache wins); steady completions
610-670ms through the router vs 326ms direct; restart→serving 3s; edge re-link
~20s. One 17.9s first-completion outlier, upstream-attributed (model load).
No PERF row — nothing a user would notice.

Board rows: DF-9ROUTER-48..51. No bunker leg this run (all las hosts
unreachable / bunkerd stuck) — SKIPPED row filed; compensating fresh-daemon
install proven on-host.

## 17. Run 16b (2026-10-20, published npm 0.5.104, second angle of the same tick): the chained hop re-introduces the glued-SSE defect, and a fresh install can die silently

Why this run exists: the same-day sibling (736dd292) proved the
published-package fresh-machine angle (824 advertised ids, 0 completable —
DF-9ROUTER-2-R2). This angle drove the CHAINED path: fresh v0.5.104 instance →
live central v0.5.99 → real completion. The chain works when you know the
incantation, and the wire shape it returns is broken in exactly the way
DF-9ROUTER-55 described and DF-9ROUTER-62's failing force-stream tests predict.

The mechanism, reproduced in one minute (docs/dogfood/2026-10-20-live-chain-sse-integration.md
has the full table): central direct with no stream key → clean application/json;
same body through a compat-node hop with no stream key → 200 text/event-stream
with `data: [DONE]` glued to the JSON (jq: "Invalid numeric literal"); explicit
`stream:false` → clean; `stream:true` → sentinel twice. The stream-absent shape
is what every SDK sends, so the chained surface is broken for every real
consumer at v0.5.104. The probable root cause is the same force-stream backport
that broke the 8 CI tests (DF-9ROUTER-62) — two independent observations of one
merge, one in CI, one on the wire.

Two smaller traps a fresh operator hits that no surface documents:
(1) connections snapshot the node's baseUrl/apiType at create time — correcting
a node with PUT does not fix existing connections, and the connection POST
wants the node's generated id (openai-compatible-chat-<uuid>), not the
user-visible prefix; (2) fresh instances on a headless host die silently
15-20 min after boot, twice in 50 minutes, empty logs, no kernel OOM — the
launcher's tray/lifecycle path is the suspect and there is no flag to disable
it. Restart persistence is solid, so the data survives; the process does not.

The install leg ran the full ephemeral battery for the first time since the
compose plugin gap was closed: toolchain-bootstrap now installs compose+buildx
and fresh-install is a 2s OK. The ci-pass cell FAILED on the 15 pass→fail
regressions (force-stream ×2 + security-audit source-audit ×12 + mimo live ×1)
— same set as local, same root merge as the SSE defect above.

Perf: nothing user-noticeable (health p50 3ms, models p50 7ms, chained chat
1.2-7.9s upstream-bound). No PERF row.

Board rows: DF-9ROUTER-55-R2 (P1 recurrence, chained glued-SSE), 
DF-9ROUTER-63 (P2 node-connection snapshot + prefix/id contract),
DF-9ROUTER-64 (P2 silent headless death), DF-9ROUTER-62 (P1, sibling's,
extended with this run's wire-shape evidence as its upstream twin).

## 18. Run 17 (2026-10-23, live central 0.5.99): combos work as advertised; the ledger next to them does not count what was served

**How the thing is built.** A combo is a row in `combos` (`src/lib/db/localDb.js`
`createCombo/getComboByName/getComboModels`) plus a per-combo strategy in the
`settings.comboStrategies` map keyed by combo NAME. A request naming a combo as
`model` is caught in `src/sse/handlers/chat.js:235` (`getComboModels`) *after*
per-key access control (`chat.js:221` `enforceKeyAccess`) and before any
credential lookup, which is why "an allowed combo grants its members" holds.
Expansion then goes to `open-sse/services/combo.js`: `reorderByCapabilities()`
stably reorders seats by the request's hard/soft capabilities (never dropping a
seat, so fallback stays intact), `handleComboChat` walks them, and
`resetComboRotation` is called from the `[id]` route whenever a combo's
models/strategy/name change so stale round-robin state can't survive an edit.
Combos are advertised to clients by `/v1/models` with `owned_by:"combo"`
(`src/app/api/v1/models/route.js:346` `comboMatchesKinds`, plus
`comboSeatLimits` for the synthesized context window).

**The right way to drive it (verified this run).** `POST /api/combos
{name, models[]}` → the name becomes a model id → `POST /v1/chat/completions
{model:"<combo-name>"}`; strategies are per-combo via the dashboard `<select>`
(persisted into `settings.comboStrategies`) or the global `comboStrategy`
default. Nested combos work: a combo name is a valid seat of another combo.
Locked-out seats are skipped instantly, so the *first* request after a lane dies
pays the probe (7.6s here) and later ones do not (0.9s).

**Error class hit this run (not a product bug).** `bunker-qa.sh` derives the
agent SSH port from a two-entry table (`mvp|bunker-mvp) 22 ;; *) 2223`). On
2026-10-23 `bunker-mvp` was down and the live hosts (`bunker-las-02`,
`cube-las-00`, `dedi-2`) answer agents on **22**, so `launch` died with
`repo sync failed: ssh: connect to host … port 2223: Connection refused` and
`collect` reported `unreachable-agent` even though `bunker info` showed the
agent running and a manual `ssh` on 22 worked. Workaround: export
`BUNKER_QA_SSH_PORT=22` for BOTH `launch` and `collect` (the documented
override). `cube-las-00` additionally refused spawn outright
("deterministic reachability error") while its port was open; `dedi-2` spawned
an agent whose ssh was refused, so the battery ran on `bunker-las-02`.

**Why the ledger disagrees with the response.** `extractUsageFromResponse`
(`open-sse/handlers/chatCore/requestDetail.js:24`) only understands an
OpenAI-shaped `usage`. Gemini's raw body carries `usageMetadata` and is
translated to OpenAI shape AFTER the point where the usage is harvested
(`nonStreamingHandler.js:421` extract → `:431` persist → `:436` translate), so
the persisted value falls back to `estimateUsage()` over the CLIENT body while
the client is served the upstream's count. Measured on one request in the same
second: served `prompt_tokens: 2002`, ledger `2`. Constant ~2000-token delta
across models. This is the same family as DF-9ROUTER-39 (whose fix only
persisted the `estimated` flag) — the gemini-format hole was never covered.
`translator/concerns/usage.js:24` `USAGE_EXTRACTORS.gemini` already maps
`promptTokenCount` faithfully once translation happens; the harvest step simply
runs too early.

**Rows filed:** DF-9ROUTER-39-R2 (P1, the ledger), DF-9ROUTER-65 (P3, all-seats
fail names only the last seat), DF-9ROUTER-66 (P3, per-key access control
undocumented + `code=insufficient_quota` on a permission denial).
