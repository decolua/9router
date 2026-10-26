# Dogfood 2026-10-20 — live-chain SSE defect, node-connection snapshot trap, headless death (second angle of tick 2026-10-20-09-03-45)

Second executor angle of the same tick. The sibling run
(736dd292, published-package/fresh-machine) owns the 824-dead-catalog finding
(DF-9ROUTER-2-R2) and the fresh-machine install numbers; this run owns the
chained-router real-use leg, the SSE wire shape, the bunker-qa battery, and the
perf pass. Target: the published npm package `9router@0.5.104` booted on a
scratch HOME (`/tmp/9router-df20`, port 20202), wired to the live central
(v0.5.99 on :20128) as an OpenAI-compatible node, driven as a real consumer:
login → key mint → node → connection → catalog → completions → usage →
dashboard UI → consumer CLI (`show`, `connect`).

## What works (v0.5.104 published package)

- `npm install` (11 pkgs, 5.7s) and `npm run cli:pack` (Next build 44s compile
  + 3.4s static gen; full pipeline ~100s under heavy box load → 16.3 MB tgz,
  3518 files) — both documented commands produce working artifacts.
- Boot to serving ≤4s warm / ≤9s with runtime installs (mtime-bounded; the
  in-poll timing loop was killed by a tool watchdog twice, so the number is a
  bound, not a mean).
- First-user chain: `/login` 200 (default pw 123456), `POST /api/keys` 201,
  `/v1/models` 200, dashboard UI renders Providers ("central-df 3 Connected",
  "OpenCode Free Ready") and Usage (7 requests, 51,702 in / 101 out, per-request
  rows, ~$0.05 est) matching the API ground truth exactly.
- Real task: fresh box → central → `cmc/zai-org/GLM-5.2` completion returned
  `dogfood-ok-1020` with usage recorded on the fresh instance.
- Consumer CLI: `show` lists per-tool config honestly ("not configured");
  `connect http://127.0.0.1:20202 --tools opencode` logged in, minted
  `cli-<hostname>`, wrote the tool config into the scratch HOME with a backup
  flow and an undo hint. `--model not listed by server` warning fired correctly
  (the compat node's models are not in `/v1/models` unless imported).
- Restart persistence: key, node, connections and usage survived two crash
  restarts of the process (see the death finding below).

## Finding 1 (P1, recurrence) — the glued-`data: [DONE]` defect is back on the chained path

The exact DF-9ROUTER-55 signature reproduces on v0.5.104 whenever the request
crosses an OpenAI-compatible node hop (fresh instance → central). Same body,
same minute, three shapes:

| request | status | content-type | tail |
|---|---|---|---|
| central direct, stream key absent | 200 | application/json | clean `}}` |
| chained, `stream:false` explicit | 200 | application/json | clean `}}` |
| chained, stream key ABSENT | 200 | text/event-stream | JSON body + `data: [DONE]` glued (no `\n` before it) → `jq` parse error "Invalid numeric literal" |
| chained, `stream:true` | 200 | text/event-stream | `data: [DONE]` TWICE |

Every OpenAI SDK and `curl | jq` consumer hits the stream-absent shape. The
central (v0.5.99) on the identical body is clean, so the corruption is added by
the edge/router hop on the chained path. DF-9ROUTER-62's failing test names
(`forceStream provider config keeps forced-stream providers streaming for JSON
clients when body.stream is undefined/false`) is the behavioral twin — the
v0.5.104 backport merge that broke those tests in CI is the probable root
cause; the battery evidence for that is in DF-9ROUTER-62 and in this run's
install leg. Filed as DF-9ROUTER-55-R2.

## Finding 2 (P2) — editing a node does not fix existing connections

`POST /api/provider-nodes` stores `baseUrl`; `POST /api/providers` then SNAPSHOTs
`baseUrl`/`apiType` into the connection's `providerSpecificData` (route.js
openai-compatible branch). `PUT /api/provider-nodes/<id>` correcting a wrong
baseUrl returns 200 but existing connections keep serving the old URL — my
wrong `http://127.0.0.1:20128` (no `/v1`) kept producing 404 HTML 503s until I
created a NEW connection. Nothing in the API, the UI flow, or the docs says the
snapshot exists or that a connection must be recreated after a node fix.

Companion gap: the connection POST's `provider` must be the node's FULL id
(`openai-compatible-chat-<uuid>`), not the user-chosen prefix — `{"provider":
"openai-compatible-cdf"}` returns 404 "OpenAI Compatible node not found". Only
source-reading reveals this; the dashboard does it for you, but the API path
(and any automation) hits it blind. Filed with the snapshot defect as one row.

## Finding 3 (P2) — fresh instances die silently on a headless host

Across ~50 minutes, two freshly-booted published-package instances on :20202
disappeared without a trace: `next-server` gone, zero new lines in the launcher
log, no kernel OOM (dmesg clean, earlyoom avoids node). Deaths at ~09:40 and
~10:00, each 15-20 min after boot, both while idle. Data survived (restart
persistence verified). Suspect (labeled hypothesis, not proven): the launcher's
tray/lifecycle path (systray2 lazy-install, no DISPLAY) triggers launcher
cleanup, which per cli/README kills the detached server group. There is no
`--no-tray`/headless flag to escape that path. Host-side attribution is
unproven — this box runs many agents — but two silent deaths with empty logs in
50 minutes on a fresh install is exactly the "server vanished, logs say
nothing" wall a real user cannot get past. Filed as its own row.

## Install leg — ephemeral bunker battery (bunker-qa.sh)

Launched on bunker-mvp agent f4c5e00f (ttl 4h) against HEAD
012356453661785d6be4bfa61e88f94d57d66709. Cells graded remotely before collect:
repo-head OK, toolchain-bootstrap OK (incl. compose + buildx plugins — the old
compose-v1 rc=125 blocker is gone), fresh-install OK (46 pkgs, 2s),
ci-pass FAILED (act `test` job rc=1) — re-run of `verify-no-regression.mjs` on
the agent against the battery's own current.json names 15 pass→fail
(force-stream ×2, security-audit source-audit ×12, mimo-free live ×1). The
same 15 fail locally (sibling run). Note: this run's collect --evidence pull
completes after the chat report; the evidence file path is
`/tmp/bunker-qa-evidence-20261020T093444Z-3362680.jsonl`.

## Perf (Step 2b)

Nothing a user would notice, no PERF row:
- warm `/api/health` n=20: p50 3ms, max 4ms
- warm `/v1/models` n=20: p50 7ms, p90 9ms
- chained non-stream chat n=5: min 1.17s / mean 2.74s / max 7.90s (upstream-
  bound; the central adds ~1.4s of model time at these token counts)
- cold one-shots: node tarball ~4s, `npm install` (global-equivalent) 5.7s,
  boot ≤4-9s, `cli:pack` ~100s under load.
The only waits a user feels are upstream model latency and the one-shot
installs — both expected, neither router-attributed.

## Environment

- Published package from the local pack + npm registry cross-check
  (registry `9router@0.5.104` == local cli/package.json 0.5.104).
- Scratch isolation: HOME=/tmp/9router-df20/npmhome, DATA_DIR=/tmp/9router-df20/data.
  One wart measured: `npm install` in cli/ ran postinstall which provisioned the
  REAL `~/.9router/runtime` (sqlite/tray deps) despite the scratch intent — the
  published package's postinstall writes to the invoking user's HOME by design;
  fine for a desktop user, worth knowing for sandboxed installs.
- Scratch residue: /tmp/9router-df20 (instances, logs, keys — keys are
  scratch-minted against scratch instances; the central-minted key was created
  on the live central under name `dogfood-1020-fresh` and left in place, it
  grants catalog/chat access to the already-keyed central).
