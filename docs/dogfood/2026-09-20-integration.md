# 9router dogfood — integration report, 2026-09-20

**Target:** `9router` (federation fork, `totalwindupflightsystems/9router`, branch `federation`)
**Angle:** the upstream product promises that had never been exercised end-to-end in a dogfood
run — **RTK token saver, auto/model fallback, multi-account rotation, usage accounting** — driven
through a real client talk track rather than the test suite.
**Environment:** scratch instance `PORT=20127 DATA_DIR=/tmp/dogfood-9router` on the control host
(the fleet router on `:20128` was never touched), upstream = LM Studio over the tailnet, plus one
**fresh ephemeral bunker agent** (`bunker-las-03`, agent `6e0618e5`) for the install leg.
**Verdict: PROMISING-BUT-ROUGH** — the ROI feature (RTK) is real and works; the accounting and
fallback features around it are broken or undocumented.

---

## Why this angle and not the previous ones

`.coding-hermes/dogfood-log.md` carries 10+ entries. The federation acceptance suite
(A/A+/B/C/D) was fully swept on 2026-09-19 and re-swept clean; the CLI/CAG surface and the gateway
endpoints have been swept repeatedly. What **no** run had touched is the upstream product's own
differentiators: the README's headline is "Save 20-40% tokens with RTK + auto-fallback to FREE &
cheap AI models", plus "Multi-account round-robin" and usage/quota tracking. Those are the claims a
user actually buys the tool for, and they had never been driven end-to-end.

Result: the previous run's conclusion ("remaining roughness is onboarding friction, not broken
promises") does not survive contact with this surface. Two of the four headline promises are broken
in ways the test suite cannot see.

---

## Scratch setup (what a real user does)

```bash
# 1. run the instance out of the existing checkout, isolated from the fleet router
mkdir -p /tmp/dogfood-9router/data
cat > /tmp/dogfood-9router/scratch.env <<'EOF'
PORT=20127
HOSTNAME=0.0.0.0
DATA_DIR=/tmp/dogfood-9router/data
JWT_SECRET=dogfood-scratch-secret-not-a-real-secret
INITIAL_PASSWORD=dogfood-pass-2026
API_KEY_SECRET=dogfood-scratch-apikey-secret
MACHINE_ID_SALT=dogfood-scratch-salt
NEXT_PUBLIC_BASE_URL=http://127.0.0.1:20127
REQUIRE_API_KEY=false
EOF
cd <9router checkout>
set -a; source /tmp/dogfood-9router/scratch.env; set +a
npm run start            # ready in ~2s off a warm .next build
```

Isolation was verified by reading the running process's environment and confirming the SQLite file
landed at `/tmp/dogfood-9router/data/db/data.sqlite` while `~/.9router` kept its Sep-14 mtime.

```bash
# 2. dashboard auth
curl -s -c cookies.txt -X POST http://127.0.0.1:20127/api/auth/login \
  -H 'Content-Type: application/json' -d '{"password":"dogfood-pass-2026"}'
# {"success":true,"mustChangePassword":false}

# 3. wire an OpenAI-compatible upstream — TWO objects are required
#    (a) the NODE = where the upstream lives. Note type vs apiType:
NODE=$(curl -s -b cookies.txt -X POST http://127.0.0.1:20127/api/provider-nodes \
  -H 'Content-Type: application/json' \
  -d '{"name":"dogfood-lmstudio","prefix":"dlm","apiType":"chat","baseUrl":"http://<lmstudio>:1234/v1"}' \
  | jq -r .node.id)
#    (b) the CONNECTION = the credential that activates the node
curl -s -b cookies.txt -X POST http://127.0.0.1:20127/api/providers \
  -H 'Content-Type: application/json' \
  -d "{\"provider\":\"$NODE\",\"apiKey\":\"not-needed-for-lmstudio\",\"name\":\"dogfood-lmstudio-conn\"}"

# 4. client key, then real traffic
KEY=$(curl -s -b cookies.txt -X POST http://127.0.0.1:20127/api/keys \
  -H 'Content-Type: application/json' -d '{"name":"dogfood-client"}' | jq -r .key)
curl -s http://127.0.0.1:20127/v1/models -H "Authorization: Bearer $KEY"   # -> dlm/<model> ids
```

**Field contract that cost time:** the node body uses `type` for the node KIND
(`openai-compatible`) and `apiType` for the PROTOCOL (`chat`|`responses`). Sending
`apiType:"openai"` returns `400 Invalid OpenAI compatible API type`; omitting `apiType` while
supplying `type:"openai-compatible"` does **not** error — it silently stores `apiType:"chat"` and
a placeholder `prefix:"compatible"` derived from the type string (finding DF-9ROUTER-37).
A fresh README section (`README.md:326`) now documents the two-object model, so the 09-19
onboarding gap is fixed; the field semantics are still only discoverable by reading the route.

---

## What was verified working (real use, not tests)

### 1. RTK token saver — the headline claim HOLDS

Measured by importing the real modules **and** end-to-end through `/v1`:

| tool output | bytes in | saved | % |
|---|---|---|---|
| `grep -rn console.log src/lib/` | 11259 | 3618 (32.1%) | grep filter |
| `find src -type d` | 7266 | 5340 (73.5%) | find filter |
| `git log --oneline -60` | 5561 | 0 | correctly refused |

End-to-end: the server printed
`[RTK] saved 3618B / 11259B (32.1%) via [grep] hits=1` and `prompt_tokens` fell **3316 → 2592**;
with `X-9Router-Token-Saver: off` the same body cost **3483** tokens — the documented bypass works
and the reduction (~25.6% on that request) sits inside the advertised 20-40% band.

The **safety contract is real and worth noting**: on a synthetic worst-case grep blob (every line
unique) the `grep` filter produced *larger* output (11119 → 12420 bytes) and `safeApply` correctly
kept the original text — RTK cannot silently lose or inflate context.

### 2. Restart persistence — PASS

`kill` → restart: node, 2 connections, combo, 91-entry model listing and live completions all
survived. No corruption, no re-login, no re-wiring.

### 3. Multi-account round-robin — works when enabled

Two connections on one node, 4 requests → **4/4 on the newest connection** (fill-first default).
After `PATCH /api/settings {"providerStrategies":{"<node-id>":{"fallbackStrategy":"round-robin"}}}`:
6 requests → conn2 ×3 then conn ×3 (sticky limit 3). So rotation works; the README's flat claim
"Round-robin between accounts per provider" describes an opt-in that is invisible in the docs.

### 4. Fresh-machine install leg — PASS

Ephemeral agent `6e0618e5` on `bunker-las-03` (destroyed after the run):

```
git clone … totalwindupflightsystems/9router.git   # rc=0, public clone works
git checkout federation                            # rc=0
cp .env.example .env && npm ci                     # rc=0 in 43s
PORT=20127 npm run dev                             # ✓ Ready in 396ms
```

Then a real two-hop chain on the fresh box: login with the `.env.example` password (`change-me`),
create a node pointing at the control-host 9router, mint a key, and issue a completion —
**`{"content":"CHAIN-OK"}` came back through fresh-install → control-host → LM Studio.** RTK also
fired on the fresh box (`[RTK] saved 3618B / 11259B (32.1%) via [grep]`). A user can genuinely go
from bare Debian to working routing in a few minutes.

---

## The defects (each becomes a board row)

### P0 · DF-9ROUTER-32 — a default OpenAI request returns unparseable JSON

Omitting `stream` (what the OpenAI SDK does when you don't pass the flag) returns a **non-stream**
JSON body with the SSE terminator glued on:

```
…"system_fingerprint":"qwen3.8-27b"}data: [DONE]
```

`json.loads` fails with `Extra data: line 33 column 2`. Explicit `stream:true` → correct SSE;
explicit `stream:false` → clean JSON. Upstream LM Studio probed directly is clean, so the router's
non-stream assembly adds the tail. Reproduced on the control-host instance and on the fresh bunker
install. Any consumer that does not pass `stream` explicitly (most simple integrations) gets a
body its JSON parser rejects.

### P0 · DF-9ROUTER-33 — usage recording is dead on the streaming path

Controlled on one instance, row count read from SQLite:

```
rows before = 1
stream:true   ->   2
stream omitted->   2   (NO ROW)
stream:false  ->   3
```

Root cause located: `open-sse/handlers/chatCore/requestDetail.js:~205` bails with
`if (inTokens === 0 && outTokens === 0) return;`, and the streaming path never populates those
counts — the server prints `📊 DONE … IN 0 · OUT 0` for traffic the client measured at
`prompt_tokens 2592 / completion_tokens 105`. Net effect: `usageHistory` stays at 0 rows and
`GET /api/usage/stats?period=7d` returns `{"totalRequests":0,…}` for a box that served a dozen
completions. The README's quota-tracking story ("use every bit before reset") is the whole point of
the tier design, and it silently reports nothing. First flagged in the 2026-09-16 run; this run
adds the discriminator and the guard's location.

### P1 · DF-9ROUTER-34 — combo fallback never advances on a model-scoped 4xx

Combo `[dlm/no-such-model-xyz, dlm/qwen3.8-27b]` → the **first** model's upstream 400 is returned
verbatim, model #2 never tried:

```
⚠️ [COMBO] Model dlm/no-such-model-xyz failed (no fallback) {"status":400}
```

`combo.js:335` calls `checkFallbackError`, whose 4xx guard (`accountFallback.js:57`) is correct for
**account** health but is inherited by the **model**-level loop, where the next candidate is a
different model rather than a cold credential. Directly contradicts "Auto fallback … zero downtime".

### P1 · DF-9ROUTER-35 — a new compatible node exposes ~1 model through the gateway

On the fresh install, a healthy 9router upstream (91 ids) surfaced as exactly **one** id —
`u9/dogfood-fallback`, a combo name the upstream happened to have — stable across 3 probes; a
completion through the same node worked. On the instance that had already synced `dlm/`, the same
kind of node listed 90 models (upstream 96 minus 5 embedding-only). Working hypothesis (not
proven): a node exposes only the intersection with ids already in the local catalog, so an
un-synced prefix degrades to a placeholder list. `/v1/models` is the single call a user makes to
configure a CLI tool, so this is the difference between "add a node and use it" and "add a node and
guess".

### P1 · DF-9ROUTER-36 — round-robin default contradicts the README

Covered above; the fix is one README sentence plus an existing-but-hidden dashboard switch.

### P2 · DF-9ROUTER-37 — provider-nodes field errors mislead and invent defaults

Covered above.

---

## Time-to-first-success and friction

| phase | time | friction |
|---|---|---|
| server up on scratch port, isolated | ~2 min | 1 (had to discover `HOSTNAME=0.0.0.0` for cross-host use; silent 127.0.0.1 default) |
| login + node + connection + key + first completion | ~6 min | 3 (`type` vs `apiType` message, undocumented placeholder-prefix behaviour, connection-must-follow-node) |
| fresh-machine clone → install → working chain | ~5 min | 1 (`npm ci` fine; `.env.example` DATA_DIR commentary is confusing but the default works) |
| RTK verification end-to-end | ~15 min | 0 (works as advertised) |
| fallback / rotation / usage | ~20 min | 6 (two broken promises, one doc-vs-reality gap) |

**Friction count: 6 distinct product findings** (+3 environment/operator notes). The 09-19
estimate of "6 min to a working local endpoint" still holds — the wiring is now documented in
README:326, which fixed the biggest onboarding cost.

## Bunker install leg

`bunker-las-03`, agent `6e0618e5`, 2h TTL, **destroyed** after the run (`Agent 6e0618e5 destroyed`,
`No agents found`). Fresh-install clone/install/boot/smoke all PASS; no host-wide deps were
pre-installed and no repo visibility or credential was changed.

---

## If I had one hour of the maintainer's time

1. **DF-9ROUTER-32** — a default request returning unparseable JSON is the kind of thing that makes
   someone else's integration fail with a mystery error. 30 minutes with an acceptance test.
2. **DF-9ROUTER-33** — usage accounting is the feature the tier design is *sold* on. Derive counts
   from the stream's final usage chunk; never silently skip a successful request.
3. **DF-9ROUTER-34** — make model-scoped errors advance the combo. The guard already exists, it
   just needs the model-level caller to bypass it.
