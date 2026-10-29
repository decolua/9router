---
name: 9router
description: Entry point for 9Router — local/remote AI gateway with OpenAI-compatible REST for chat, image, TTS, embeddings, web search, web fetch. Use when the user mentions 9Router, NINEROUTER_URL, or wants AI without writing provider boilerplate. This skill covers setup + indexes capability skills; fetch the relevant capability SKILL.md from the URLs below when needed.
---

# 9Router

Local/remote AI gateway exposing OpenAI-compatible REST. One key, many providers, auto-fallback.

## Setup

```bash
export NINEROUTER_URL="http://localhost:20128"      # or VPS / tunnel URL
export NINEROUTER_KEY="sk-..."                      # from Dashboard → Keys (only if requireApiKey=true)
```

All requests: `${NINEROUTER_URL}/v1/...` with header `Authorization: Bearer ${NINEROUTER_KEY}` (omit if auth disabled).

Verify: `curl $NINEROUTER_URL/api/health` → `{"ok":true}`

## Discover models

```bash
curl $NINEROUTER_URL/v1/models                  # chat/LLM (default)
curl $NINEROUTER_URL/v1/models/image            # image-gen
curl $NINEROUTER_URL/v1/models/tts              # text-to-speech
curl $NINEROUTER_URL/v1/models/embedding        # embeddings
curl $NINEROUTER_URL/v1/models/web              # web search + fetch (entries have `kind` field)
curl $NINEROUTER_URL/v1/models/stt              # speech-to-text
curl $NINEROUTER_URL/v1/models/image-to-text    # vision
```

Use `data[].id` as `model` field in requests. Combos appear with `owned_by:"combo"`.

Response shape:
```json
{ "object": "list", "data": [
  { "id": "openai/gpt-5", "object": "model", "owned_by": "openai", "created": 1735000000 },
  { "id": "tavily/search", "object": "model", "kind": "webSearch", "owned_by": "tavily", "created": 1735000000 }
]}
```

## Capability skills

When the user needs a specific capability, fetch that skill's `SKILL.md` from its raw URL:

| Capability | Raw URL |
|---|---|
| Chat / code-gen | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-image/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-web-fetch/SKILL.md |

## Errors

- 401 → set/refresh `NINEROUTER_KEY` (Dashboard → Keys)
- 400 `Invalid model format` → check `model` exists in `/v1/models/<kind>`
- 503 `All accounts unavailable` → wait `retry-after` or add another provider account
- 400 `No credentials for provider: openai` after a ~95s hang → the model id does not exist
  on that upstream (NOT a credential problem). Copy the id verbatim from `/v1/models`.
  Known gap (DF-9ROUTER-40): fail-fast + model-scoped message not yet implemented.

## Wiring an OpenAI-compatible upstream (what works, 2026-09-24)

Two objects are required, in order — connection follows node:

1. Providers → **Add OpenAI Compatible** → Name, Prefix, Base URL (e.g.
   `http://host:1234/v1`), optional model hint list.
2. Open the node card → **Add API Key** → Name + key + Default Model → Save → state `active`.
3. On the node card → **Import from /models** → one id per upstream model, prefixed
   `<Prefix>/<model>` (96 imported in seconds from a 96-model upstream).

Restart the server after adding a provider connection — running config is loaded at boot.

Client key: Dashboard → **Endpoint & Key** → the default key exists already (reveal/copy).
A completion and an embeddings call through the wired node, via the OpenAI SDK:

```python
from openai import OpenAI
c = OpenAI(base_url="http://127.0.0.1:20127/v1", api_key=KEY)
c.chat.completions.create(model="dlm/qwen3.8-27b", max_tokens=300,
                          messages=[{"role": "user", "content": "ping"}])
c.embeddings.create(model="dlm/text-embedding-nomic-embed-text-v1.5",
                    input=["hello world"])   # 768-dim, sanity-verified pass-through
```

Gotchas (measured 2026-09-24, DF-9ROUTER-38..41):

- **'Require API key' can silently no-op**: if the instance was started with `.env` copied
  from `.env.example`, `REQUIRE_API_KEY=false` in that file pins the setting and the UI
  toggle saves but never takes effect. Verify with an unkeyed request before trusting the
  toggle; enforcement can currently only be pinned from the env.
- **Chained 9routers double-prefix ids** (`up/dlm/…` when node `up` points at a 9router
  whose own models are `dlm/…`) — request the id exactly as listed.
- **Embeddings calls record no usage row**; chat rows on the stream-omitted path store a
  local token *estimate* that under-counts reasoning models ~30x vs the SDK-reported number.
- Restart persistence: models/keys/connections/usage all survive a kill+restart; no
  re-wiring needed.
- **Federation snapshot: UI-configured state replicates verbatim.** Boot the instance as
  `FEDERATION_MODE=central` + a second as `FEDERATION_MODE=edge` (shared `FEDERATION_TOKEN`,
  `FEDERATION_CENTRAL_URL`): the edge's replica carries the node, connection (credentials
  included), client key and full model import (96 ids, revisionLag 0) and serves chat +
  embeddings from the replica alone (`EDGE-SNAPSHOT-OK`).

## Fresh install from the published package (verified on a clean machine, 2026-10-20)

The artifact a new user touches is the npm package, not this repo. Measured on a bare
Ubuntu 24.04 box (no Node runtime, no toolchain):

```bash
# 1. Node is a PREREQUISITE THE README OMITS (engines: node >=18):
#    nodejs.org latest-v22.x linux-x64 tarball -> $HOME/node, export PATH="$HOME/node/bin:$PATH"  (~4 s)
# 2. README:116
npm install -g 9router                       # rc=0, ~10 s → binary `9router`
9router --port 20128 --skip-update --no-browser    # /api/health 200 in ~6 s
# 3. first login: the default password is the source fallback 123456 (not in the README)
curl -s -X POST $URL/api/auth/login -H 'Content-Type: application/json' -d '{"password":"123456"}' -c cookies.txt
curl -s -b cookies.txt -X POST $URL/api/keys -H 'Content-Type: application/json' -d '{"name":"my-client"}'
```

**Trap — a fresh install's `/v1/models` is a list of things that do not work.** With no
provider configured it returns the whole static catalog (measured: 824 ids, 317 KB) and every
id 404s on chat with `No active credentials for provider: <p>` (7 ms); the deliberately
credentialless ids the server advertises (`mmf/mimo-auto`, `oc/*-free`) return 400 upstream
(`ModelProtocolUnsupported` / `Unsupported model`). Save a provider node + connection first,
then query models, then chat — and never cache the list: once a connection existed the same
endpoint answered 5 ids, not 824. Filed as `DF-9ROUTER-2-R2` (recurrence of DF-9ROUTER-2/7/54).

Source path (`README:158`): `git clone https://github.com/totalwindupflightsystems/9router.git`
(~1 s, public) — but the default branch is the **upstream mirror** (`master`); the fork's
feature work lives on `federation`. `npm install` in the clone: 594 packages, ~77 s.

Timings from that run: health 2.45-3.60 ms warm, `/v1/models` (824 ids) 5.73-10.02 ms,
`/login` 2.38-11.74 ms, `/dashboard` 307 @2.58 ms — nothing a user would notice.

Full run report: `docs/dogfood/2026-10-20-published-package-fresh-install.md`.

## Chaining two 9routers (compat-node hop) — traps, measured 2026-10-20 on the published 0.5.104

Wiring a fresh instance to another 9router (or any OpenAI-compatible upstream) from the
API side needs the node's GENERATED id, not the user-visible prefix:

1. `POST /api/provider-nodes` `{"name":"up","prefix":"up","apiType":"chat","baseUrl":"http://host:PORT/v1"}`
   — baseUrl MUST include `/v1`; the executor appends `/chat/completions` directly.
2. `POST /api/providers` `{"provider":"<node .id from step 1>","apiKey":"<upstream key>","name":"up"}`
   — passing the prefix returns a bare 404 "OpenAI Compatible node not found".
3. Models appear as `<prefix>/<upstream-id>`; chat `{"model":"up/<id>"}`.

Two traps (DF-9ROUTER-63, DF-9ROUTER-55-R2):

- **Connections snapshot the node.** `baseUrl`/`apiType` are copied into the connection at
  create time; `PUT /api/provider-nodes/<id>` fixing a wrong baseUrl does NOT fix existing
  connections — recreate the connection after any node correction.
- **The chained hop breaks the default wire shape.** With a request whose `stream` key is
  ABSENT (what every SDK sends), a chained hop answers `content-type: text/event-stream`
  with the JSON body and `data: [DONE]` glued to it (jq: "Invalid numeric literal");
  explicit `"stream":false` returns clean JSON; `"stream":true` duplicates the sentinel.
  Always send explicit `"stream": false` through a chained 9router until DF-9ROUTER-55-R2 lands.

Fresh instances on a headless host can die silently ~15-20 min after boot (empty logs, no
kernel OOM; data survives restarts) — DF-9ROUTER-64. Supervise the process; don't trust it
unattended until the fix lands.

## Repo hygiene note

`.gitignore:102` (`9router-*`) ignores new per-surface skill directories, so a new
`skills/9router-<surface>/SKILL.md` cannot be added with a plain `git add` — the dogfood
convention (12 tracked `9router-*` skill dirs) predates the rule. Add the surface section to
this file instead, or amend the ignore rule deliberately.

