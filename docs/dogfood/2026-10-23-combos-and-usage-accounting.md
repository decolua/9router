# 2026-10-23 — Combos as a real user, on a live instance that had almost no working lanes

**Tick:** `9router-dogfood-2026-10-23-13-55-53` · **Target:** 9router (HEAD `9e50cba4`, branch `federation`)
**Surface driven:** live central `http://127.0.0.1:20128` (container `9router-central`, `/api/version` = `0.5.99`),
dashboard UI + `/v1` API + dashboard API, with a minted scratch key.
**Angle:** the combo/failover feature — the one thing this router exists for — driven for the first
time in real use (the instance carried **zero combos** before this run), on an instance whose lanes
were mostly dead at the time.

---

## 1. The promise being tested

> "Group models under one name, then pick a strategy per combo: Fallback — tries models in order
> (next on failure); Round Robin — rotates models across requests to spread load; Fusion — panel +
> judge. Use in CLI: `premium-coding`."
> — dashboard Combos page text + README §"Create Combos"

Null hypothesis: a user can build a 3-seat chain in the dashboard, point a CLI at the combo name,
and keep working when individual lanes die — and the cost/usage numbers they see afterwards are the
ones the provider will bill.

## 2. What the machine actually looked like when the run started

`GET /api/providers` (7 connections, `testStatus`):

| connection | provider | testStatus | live evidence |
|---|---|---|---|
| ocg-primary | opencode-go | unavailable | `[401] api_key_expired` (last error 2026-10-23T14:11:57Z) |
| ocg-account2 | opencode-go | unavailable | `[401] api_key_expired` |
| commandcode-primary | commandcode | unavailable | `[429] weekly usage limit … resets 2026-10-24T23:07:30Z` |
| commandcode-wojonstech | commandcode | unavailable | `[429]` same weekly window |
| xkiro-primary / xkiro-account2 | openai-compatible-chat-b322f9df… | unavailable | `[404]` on their test model; one live call answered `[503]` in 14.7s |
| **df-crosscheck** | **gemini** | **active** | 8/8 models answered 200 |

Direct probes against the same `/v1/chat/completions` the user's CLI uses:

```
xkiro/google/gemini-3.6-flash   -> 503 in 14.70s   "[openai-compatible-chat-…] [503] service_unavailable (reset after 23s)"
cmc/deepseek/deepseek-v4-flash  -> 503 in  0.007s  "[429] You've reached your weekly usage limit … resets 2026-10-24T23:07:30.625Z"
gemini/gemini-3.5-flash-lite    -> 200 in  0.97s   content "DOGFOOD-OK"
```

So the only lane a user could actually complete on was `gemini`. That is the ideal condition for
testing combos honestly: the feature's whole value claim is "the dead ones cost you nothing".

Container identity: `docker inspect 9router-central` → image created `2026-10-13T22:24:09Z`,
started `2026-10-23T14:09:19Z`. `/api/version` also reports `latestVersion 0.5.109` and the
dashboard shows an `Update now` button — the running instance is 10 releases behind what it
advertises. Not filed as a defect (the product surfaces it itself), but it bounds every claim in
this document to **0.5.99**.

## 3. What the user did, and what happened

### 3.1 Create a chain (dashboard API + dashboard UI)

```
POST /api/combos  {"name":"dogfood-chain-1023",
                   "models":["ocg/glm-5.3-flash",           # dead: 401 expired
                             "cmc/deepseek/deepseek-v4-flash", # dead: 429 weekly
                             "gemini/gemini-3.5-flash-lite"]}  # live
-> 201 {"id":"ccf82feb-…","name":"dogfood-chain-1023", …}
```

Read back in the dashboard at `/dashboard/combos`: the card renders the three seats in order, with
per-seat capability badges (`Vision`, `Reasoning`), `ctx 1M · max 384k`, a per-combo strategy
`<select>` (fallback / round-robin / fusion), and Copy / Edit / Delete. **The UI path works.**

The combo also appears in `/v1/models` as a first-class model id (170 ids instead of 169):

```
{"id":"dogfood-chain-1023","object":"model","owned_by":"combo",
 "capabilities":{…,"contextWindow":1000000},"context_length":1000000,"max_completion_tokens":65536}
```

That matters: it means a CLI's model picker can find the combo. It is also where the first
"wait, is that honest?" question shows up — the synthesized capabilities claim `vision`, `pdf`,
`audioInput`, `videoInput`, `search`, `tools`, `reasoning` **all true** even though one seat
(`cmc/deepseek/deepseek-v4-flash`) advertises no vision. The runtime does reorder seats by
capability, so this is a presentation claim, not a routing lie; noted, not filed.

### 3.2 Use it as a model id

```
curl -s $H/v1/chat/completions -H "Authorization: Bearer $KEY" \
  -d '{"model":"dogfood-chain-1023","messages":[{"role":"user","content":"Reply with exactly: DOGFOOD-OK"}],"max_tokens":60}'
```

| run | http | wall | content |
|---|---|---|---|
| 1 | 200 | **7.64s** | DOGFOOD-OK |
| 2 | 200 | **1.42s** | DOGFOOD-OK |
| 3 | 200 | **0.89s** | DOGFOOD-OK |

Server log shows why run 1 is slower and why 2-3 are not — the dead seats get locked after a
failure, and later requests skip them:

```
[14:14:30] [COMBO] Trying model 3/3: gemini/gemini-3.5-flash-lite
[14:14:32] [COMBO] Model gemini/gemini-3.5-flash-lite succeeded
```

3/3 successful completions on a chain whose first two seats were dead. **The failover promise
holds** — and it is the only reason this instance could answer at all through a combo.

### 3.3 Stream through it

```
"stream": true  -> 200 in 1.44s, 909 bytes, exactly 1 "data: [DONE]",
                   model field = "gemini-3.5-flash-lite" (the resolved seat, not the combo name)
```

Clean: no glued sentinel (the 10-13/10-20 `DF-9ROUTER-55-R2` defect does **not** reproduce on the
direct central path), and the SSE chunk names the model that actually served, which is what a user
needs when debugging "which seat answered?".

### 3.4 Nested combo

```
POST /api/combos {"name":"dogfood-outer-1023","models":["dogfood-chain-1023","gemini/gemini-3.5-flash-lite"]}
-> call model="dogfood-outer-1023" -> 200 in 0.89s, content "NESTED-OK"
```

A combo as a seat of another combo works.

### 3.5 Round Robin, chosen from the UI

Set through the dashboard's per-combo `<select>` (a real DOM change event, not the API):

```
GET /api/settings -> {"comboStrategies":{"dogfood-chain-1023":{"fallbackStrategy":"round-robin"}}}
```

Four consecutive calls: **4/4 200**, 1.12s / 0.79s / 0.63s / 0.66s. Log shows it rotating the
start index and still falling through:

```
[14:24:29] Combo "dogfood-chain-1023" with 3 models (strategy: round-robin, sticky: 1)
[14:24:29] [COMBO] Trying model 2/3: gemini/gemini-3.5-flash-lite   <- started at cmc, fell through
[14:24:30] [COMBO] Trying model 1/3: ocg/glm-5.3-flash             <- next request started at ocg
```

Round Robin does not turn dead seats into user-visible errors — it absorbs the failures and rotates.
This is the strongest part of the feature.

### 3.6 All seats fail

```
POST /api/combos {"name":"dogfood-allfail-1023","models":["ocg/glm-5.3-flash","cmc/deepseek/deepseek-v4-flash"]}
call -> HTTP 503 in 8ms
{"error":{"message":"[commandcode/deepseek/deepseek-v4-flash] [429]: You've reached your weekly usage limit
 for your plan. Your limit resets at 2026-10-24T23:07:30.625Z. … (reset after 2m 41s)"}}
```

Fail-fast is right (8ms, no timeouts). What is wrong is the diagnosis: only the **last** seat is
named. The first seat's `401 api_key_expired` — the actually actionable one, because it needs a
credential rotation — never reaches the client. Filed: **DF-9ROUTER-65**.

### 3.7 Per-key access control (found while testing the combo)

```
POST /api/keys {"name":"dogfood-restricted-1023"}                       -> 201
PUT  /api/keys/<id> {"access":{"restricted":true,"allow":["dogfood-chain-1023"]}} -> 200
call model=dogfood-chain-1023                -> 200 in 0.93s "OK"       (allow granted through the combo)
call model=gemini/gemini-3.5-flash-lite      -> 403 in 0.004s
  {"error":{"message":"This API key is not allowed to use model \"gemini/gemini-3.5-flash-lite\"",
            "type":"permission_error","code":"insufficient_quota"}}
```

The capability works, including "an allowed combo grants the members it routes to". Two gaps:
README never documents it (and `POST /api/keys` only accepts `{name}`, so a raw-API user cannot
discover it), and the deny carries `type=permission_error` with `code=insufficient_quota` — the
code is the field SDKs branch on, and `insufficient_quota` reads as retryable billing.
Filed: **DF-9ROUTER-66**.

## 4. The finding that hurts: the usage ledger disagrees with the response it served

The cost/journal surface is the other half of the product's promise ("usage tracking", the Usage
page, `apiKeys` quotas). While measuring the combo I checked the ledger against what the response
itself reported — same request, back to back:

```
14:25:14  POST /v1/chat/completions {"model":"gemini/gemini-3.5-flash-lite",
                                     "messages":[{"role":"user","content":"hi"}],"max_tokens":5}
          -> 200 in 1.31s
          -> body .usage = {"prompt_tokens":2002,"completion_tokens":1,"total_tokens":2003}

14:25:15  GET /api/usage/request-logs
          -> "23-10-2026 14:25:15 | gemini-3.5-flash-lite | GEMINI | df-crosscheck | 2 | 1 | ok"
                                                                                              ^ 2 prompt tokens
```

**1001x under-report on one identical request.** The gap is a constant ~2000 prompt tokens:

| request body | served `usage.prompt_tokens` | ledger row |
|---|---|---|
| `"hi"` (max_tokens 5) | 2002 | 2 |
| `"hi"` (gemini-3.8-flash) | 2002 | 2 |
| `"hi"` (gemma-4-31b-it) | 2004 | 2 |
| `"Reply with exactly: DOGFOOD-OK"` (combo, streamed) | 2009 | 9 |
| system + "count from 1 to 40…" | 2030 | 30 |

The aggregate surface inherits it: `GET /api/usage/stats` → `gemini: {requests:19, promptTokens:157,
cost:0.00089}` for calls whose own responses served ≈38 000 prompt tokens.

**Root cause (source-read, file:line):** `open-sse/handlers/chatCore/requestDetail.js:24-50`
`extractUsageFromResponse()` understands an OpenAI-shaped `usage` (`prompt_tokens` / `input_tokens`)
and nothing else. A raw Gemini non-streaming body carries `usageMetadata` and is translated into
OpenAI shape **later**, at `nonStreamingHandler.js:436` (`translateNonStreamingResponse`). So at
`nonStreamingHandler.js:421` the extract returns `null`, `resolveUsage()`
(`requestDetail.js:125-131`) falls back to `estimateUsage(body, contentLength)` over the **client**
body, and `nonStreamingHandler.js:431` persists that estimate — while the client is served the
translated upstream count. The streaming path shows the same split (`streamingHandler.js:159`
recorded `9` for a served `2009`). The `estimated` meta flag added by the DF-9ROUTER-39 fix does
not help here: the number is wrong, not just mislabelled.

**Deliberately left open:** *why* the upstream reports ~2000 more prompt tokens than the client sent
is not resolved in this run. The router's own translators show no big injected prompt for the plain
`gemini` format (`openai-to-gemini.js:149` builds `systemInstruction` only from a real system
message; RTK injectors are off — `cavemanEnabled:false`, `ponytailEnabled:false`; headroom/pxpipe
off), so either 9router's outbound body carries content the log line (`1 MSG`) does not account for,
or Google's `promptTokenCount` includes router-invisible steering. The discriminator is a captured
outbound gemini body (mock gemini-format peer). Either way the ledger must record the billed count,
which is what the row asks for. Filed as the recurrence **DF-9ROUTER-39-R2** (P1) with this
discriminator written into the row so the fixer does not have to re-derive it.

## 5. Performance (Step 2b)

| operation | cold | warm | note |
|---|---|---|---|
| `GET /api/health` | — | 12ms | |
| `GET /v1/models` (169→170 ids, 74 343 B) | — | 0.374s / 0.391s | catalog assembly |
| combo call, all seats unlocked | 7.64s | 0.89–1.42s | cold = first request paid the failover walk |
| combo call, dead seats already locked | — | 0.63–1.12s | round-robin, 4/4 |
| direct gemini call (same model) | — | 0.97–2.0s | |
| all-seats-fail combo | — | 0.008s | fail-fast |

**Nothing is slow enough for a PERF row.** The combo adds no measurable overhead versus calling the
gemini seat directly (warm 0.89s combo vs 0.97s direct on the same model); the only user-visible
wait is the *first* request after a lane dies, which is the price of probing it once. The real cost
signal in this run is the ~2000-token prompt accounting gap (§4), not latency.

## 6. What this run did not do

- **Fusion strategy** (`queries all models in parallel, then a judge synthesizes`) was **not driven**:
  it bills every panel seat + the judge, and this instance had exactly one live lane, so the probe
  would have measured one seat failing repeatedly rather than the panel. Left for a tick with ≥2
  healthy providers.
- The **dashboard create/edit modal** was not driven click-by-click (combos were created through the
  same `/api/combos` POST the modal issues, and the resulting cards + per-combo `<select>` were
  verified in the rendered DOM). The model-picker modal over 169 ids remains untested here.
- The deployed instance is `0.5.99` while HEAD is `9e50cba4`; every observation above is bounded to
  the deployed build. The code pointers in §4 were read at HEAD and match the deployed behaviour.

## 7. Teardown

Scratch combos (`dogfood-chain-1023`, `dogfood-allfail-1023`, `dogfood-outer-1023`), the two minted
keys, and the per-combo strategy entry were removed from the live instance at the end of the run;
the instance carried zero combos before and after. No repository code was modified by this lane.

## 8. Install leg (fresh machine) and the one red that is not baseline

`bunker-qa.sh` on `bunker-las-02` agent `fc083fea` (Debian 13, toolchain bootstrap node v22.22.3 /
npm 10.9.8 / go 1.27.3), QA HEAD = `9e50cba4`. Evidence:
`/tmp/bunker-qa-evidence-20261023T141854Z-1886922.jsonl` (20 rows), plus `ci.log` and the 487 KB
`native.log` pulled off the agent before destroy.

| cell | verdict |
|---|---|
| repo-head | OK (`9e50cba4`, ff-only) |
| toolchain-bootstrap | OK — node v22.22.3, npm 10.9.8, go 1.27.3, gcc/g++, make 4.4.1, compose+buildx plugins installed |
| fresh-install | OK — `added 46 packages in 4s` |
| upgrade | OK — `v0.6.0-federation.1` tree → HEAD reinstall clean |
| ci-pass | **FAIL** — native rc=1: 27 files failed / 393 passed / 18 skipped (438); 46 tests failed / 4359 passed / 14 expected fail / 132 skipped (4552) in 222.61s. act leg: build job OK (production build 3m00s, artifacts asserted), e2e job OK (14.1s), **test job FAIL** at "Run vitest + regression gate" (2m36s, rc=1) |
| ui-probe | FAIL = harness artifact (307 → `/login` while Next logged `Compiling /login`) |
| docker-deploy / chaos-shutdown | SKIPPED by the controller safety gate (controller is the live Hermes host) |
| chaos-corruption | N/A (no db/state files in repo) |
| chaos-resource | INFO (OOM under cap) |
| chaos-errorpath | INFO — start probe did not start the app (`probe_started=no`) |
| chaos-disconnect | UNVERIFIED — suite failed first |

**Triage of the 46 failures.** 26 of the 27 failing test FILES are catalogued in
`tests/__baseline__/known-fails.txt`. The single uncatalogued one is
`unit/cli-no-tray-headless.test.js` — the guard added by the DF-9ROUTER-64 launcher fix:

```
FAIL  unit/cli-no-tray-headless.test.js > … > default (no flag): unchanged fingerprint
      — non-TTY menu resolves to exit, launcher exits 0 on its own
AssertionError: expected { code: 1, signal: null } to deeply equal { code: 0, signal: null }
```

Same file, same HEAD, dev host: `cd tests && npx vitest run unit/cli-no-tray-headless.test.js` → 5/5
pass (8.67 s). So the fork's clean-machine CI gate is red on a test that only fails off the dev box,
and it is red on the very promise that fix made ("default path unchanged, exits 0"). Filed:
**DF-9ROUTER-70**.

**Harness friction worth knowing** (`bunker-qa.sh`): its known-server SSH table maps `bunker-mvp` → 22
and *everything else* → 2223, while `bunker-las-02` / `cube-las-00` / `dedi-2` answer agents on 22.
`launch` therefore died with `repo sync failed: ssh: connect to host … port 2223: Connection refused`
and `collect` reported `unreachable-agent` while `bunker info` showed the agent running and a manual
ssh on 22 worked. Both phases need `BUNKER_QA_SSH_PORT=22` exported. `cube-las-00` refused spawn
outright ("deterministic reachability error") with its port open; `dedi-2` spawned an agent whose ssh
was refused. This is the QA harness, not the product.

## 9. Sibling delivery of the same tick

This tick was delivered twice. The other executor committed `1c17f739` (launcher lifecycle +
fresh-machine install angle: DF-9ROUTER-67/68/69, DOC-28, FED-PR-005-R2) before this angle landed.
No defect is described twice: theirs cover build/launcher/`.gitignore`/PR staleness, this document
covers combos, usage accounting and the clean-machine CI red. That commit also swept this angle's
three combo/accounting rows into its diff, so they read as landed from `1c17f739`.
`boardctl validate` before (parent board dump) and after: `RESULT: OK (375 warning(s))` both —
delta 0.
