---
name: 9router-token-saving-and-accounting-usage
description: >-
  How to wire 9router's OPENAI-COMPATIBLE upstreams and use/verify the product
  features the README sells on top of routing: RTK token saving, combo
  model-fallback, multi-account rotation, usage/quota accounting, and the
  Token-Saver bypass header. Use when a task touches tool_result compression,
  "save 20-40% tokens", auto-fallback behaviour, account rotation strategy,
  empty /api/usage/stats, a `data: [DONE]` trailing response body, or wiring a
  custom OpenAI-compatible / LM Studio / local endpoint through the gateway.
  Includes the verified two-object wiring recipe, the measured RTK numbers, and
  the known-broken paths so agents do not misdiagnose them as their own bug.
version: 1.0.0
---

# 9router — token saving, fallback, rotation, usage accounting

Companion to `skills/9router-federation-usage` (federation) and
`skills/9router` (core gateway). This skill covers the **product layer** above routing:
what the README promises beyond "route a request", what actually works
(measured), and what is broken at HEAD `321268d5` (verified 2026-09-20).

## 1. Wire a custom OpenAI-compatible upstream — the TWO-object model

Chat traffic needs **both** a node and a connection; either alone fails with
`No active credentials`. The node says *where*, the connection is the *credential*.

```bash
B=http://127.0.0.1:20128          # your instance
C=cookies.txt                     # JWT cookie from POST /api/auth/login
curl -s -c $C -X POST $B/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"password\":\"$INITIAL_PASSWORD\"}"

NODE=$(curl -s -b $C -X POST $B/api/provider-nodes -H 'Content-Type: application/json' \
  -d '{"name":"my-local","prefix":"loc","apiType":"chat","baseUrl":"http://HOST:1234/v1"}' \
  | jq -r .node.id)

curl -s -b $C -X POST $B/api/providers -H 'Content-Type: application/json' \
  -d "{\"provider\":\"$NODE\",\"apiKey\":\"unused-for-lmstudio\",\"name\":\"my-local-conn\"}"
```

Field contract (the trap): **`type` = node kind** (`openai-compatible`, default) and
**`apiType` = protocol** (`chat` | `responses`). Sending `apiType:"openai"` → `400 Invalid
OpenAI compatible API type`; omitting `apiType` while passing `type:"openai-compatible"`
**does not error** — it stores `apiType:"chat"` and a placeholder `prefix:"compatible"`.
Always send `prefix` explicitly and read back `GET /api/provider-nodes` to confirm.

Models then appear as `<prefix>/<upstream-model-id>`, e.g. `loc/qwen3.8-27b`. Issue a client key with
`POST /api/keys` and call `/v1/chat/completions` with it.

**Known gap (DF-9ROUTER-35):** on a fresh instance, `/v1/models` for a node whose prefix the local
catalog has never seen can list ~1 id while the upstream has ~90. A completion through the node may
still work. Do not conclude the node is broken; compare `GET /v1/models` against the upstream's own
`/v1/models` count.

**Known gap (DF-9ROUTER-32):** a request that **omits** `stream` (the OpenAI SDK default) returns a
non-stream body with `data: [DONE]` glued on — `json.loads` fails. Pass `stream:true` or
`stream:false` explicitly, or expect a strict parser to reject the body.

## 2. RTK token saver — VERIFIED working, how to measure it

Enabled by default (`settings.rtkEnabled: true`); bypass per request with
`X-9Router-Token-Saver: off`.

Pipeline: `src/sse/handlers/chat.js` → `open-sse/handlers/chatCore.js` (`compressMessages`) →
`open-sse/rtk/index.js` (walks OpenAI `role:"tool"` string/array, Claude `tool_result` blocks,
OpenAI-Responses `function_call_output`, Kiro `conversationState`) → `rtk/autodetect.js` picks a
filter from the first 4 KB → filter runs inside `safeApply`.

Measured 2026-09-20 (real tool outputs):

| input | bytes | saved |
|---|---|---|
| `grep -rn console.log src/lib/` | 11259 | 3618 (32.1%) |
| `find src -type d` | 7266 | 5340 (73.5%) |
| `git log --oneline -60` | 5561 | 0 (correctly refused) |

**How to verify it yourself** (the only honest test — unit tests do not prove the saving):

```bash
# build a body with a real tool blob in a role:"tool" message, then:
curl -s -X POST $B/v1/chat/completions -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' -d @body.json | jq .usage.prompt_tokens
curl -s -X POST $B/v1/chat/completions -H "Authorization: Bearer $KEY" \
  -H 'X-9Router-Token-Saver: off' -H 'Content-Type: application/json' \
  -d @body.json | jq .usage.prompt_tokens     # expect 20-40% higher
# server log prints: [RTK] saved 3618B / 11259B (32.1%) via [grep] hits=1
```

**Safety contract (real, rely on it):** if a filter returns empty or *larger* output than the
input, RTK keeps the original text. A synthetic all-unique blob measured 11119 → 12420 bytes and
was left untouched. RTK cannot inflate or blank your context. Note `MIN_COMPRESS_SIZE = 500` bytes
and `RAW_CAP = 10 MiB` — smaller/larger blobs are skipped by design.

## 3. Usage accounting — BROKEN on the streaming path (DF-9ROUTER-33)

`usageHistory` / `/api/usage/stats` / dashboard usage panels record **nothing** for streaming
requests, which is what coding CLIs send. Console shows `📊 DONE … IN 0 · OUT 0`.

| request | usage row recorded? |
|---|---|
| `stream:true` | yes |
| **`stream` omitted** | **no** |
| `stream:false` | yes |

Cause: `open-sse/handlers/chatCore/requestDetail.js` (~line 205) returns early when
`inTokens === 0 && outTokens === 0`, and the streaming path never fills those counters.

**Agent guidance:** do not debug the dashboard or SQLite when usage looks empty —
count rows around one explicit `stream:false` request first. If that lands a row and the streaming
one does not, you have hit this known bug, not a config error.

## 4. Combo / model fallback — does not advance past a model-scoped 4xx (DF-9ROUTER-34)

`README`: "Auto fallback … zero downtime". Reality: combo `[<bad model>, <working model>]` returns
the first model's upstream 400 and never tries model #2
(`[COMBO] Model … failed (no fallback) {"status":400}`).
Cause: `combo.js` uses `checkFallbackError` (`open-sse/services/accountFallback.js:57`), which
returns `shouldFallback:false` for 4xx (except 401/402/403/429) — correct for *account* health,
wrong for *model* candidates.

**Agent guidance:** to demonstrate working fallback use a transient error (503/502/504) as the
first combo entry — that path does advance. A 400/404 first entry proves the bug, not a misconfig.

## 5. Multi-account rotation — opt-in, not the default (DF-9ROUTER-36)

Default strategy is **fill-first** (`src/sse/services/auth.js`: `fallbackStrategy || "fill-first"`),
so with several connections on one provider the newest is used until it fails. The README's
"Round-robin between accounts per provider" describes an opt-in:

```bash
curl -s -b $C -X PATCH $B/api/settings -H 'Content-Type: application/json' \
  -d '{"providerStrategies":{"<node-or-provider-id>":{"fallbackStrategy":"round-robin"}}}'
# stickyRoundRobinLimit (default 3) = consecutive uses before switching
```

Verified: with round-robin on, 6 requests → conn2 ×3 then conn ×3. Watch `ACC:<name>` in the
server log to see which connection served each request.

## 6. Persistence

Nodes, connections, combos, model listings and traffic all survive a kill/restart (verified).
State lives in `DATA_DIR/db/data.sqlite` (default `~/.9router`, Docker `/app/data`). Setting
`DATA_DIR` to an unwritable path when booting **has historically** caused a silent fallback to
`~/.9router` — verify where the DB actually landed by reading the running process's environment
before trusting an isolated run.

## 7. Scratch-instance hygiene (for dogfood/QA work)

- Never boot on the fleet's live port (`:20128` is often a docker container). Use a scratch `PORT`
  and an explicit `DATA_DIR`.
- `HOSTNAME` defaults to loopback — set `HOSTNAME=0.0.0.0` when another host must reach the instance.
- Confirm isolation by `tr '\0' '\n' < /proc/<pid>/environ | grep DATA_DIR` and checking the SQLite
  path on disk; do not rely on the log banner.

## 8. Board + evidence pointers

Board rows: `DF-9ROUTER-32..37` in `.coding-hermes/board/tasks.jsonl`; narrative in
`docs/dogfood/2026-09-20-integration.md`; mechanism/why in `docs/dogfood/diagnostics.md` §13.
