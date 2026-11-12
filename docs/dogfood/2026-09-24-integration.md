# 9router dogfood — integration report, 2026-09-24

**Target:** `9router` (federation fork, `totalwindupflightsystems/9router`, branch `federation`, HEAD `eb8fee31`)
**Angle:** the two surfaces no prior dogfood run had touched — **the dashboard UI as the primary
bootstrap path** (every run before this one wired providers via curl because that is what an
agent user reaches for; a human reaches for the UI first) and **the embeddings endpoint as a real
consumer** (listed in the README's capability matrix, never driven in any of the 11 prior runs).
**Environment:** scratch instance `PORT=20127 DATA_DIR=/tmp/dogfood-9r-0924` (fresh production
build at HEAD; fleet router on :20128 untouched), upstream = LM Studio over the tailnet
(15 chat + 6 embedding models), real OpenAI python SDK 2.24.0 + raw curl clients, and one
**fresh ephemeral bunker agent** (`bunker-las-03`, agent `6b0e3ee4`, destroyed) for the install leg.
**Verdict: SHIPPABLE** — for the first time in this log, no P0/P1 broken promise on the driven
surface; the findings that remain are an env-pin disclosure gap, an accounting inconsistency,
and chain-ergonomics friction.

---

## Why this angle and not the previous ones

`.coding-hermes/dogfood-log.md` carries 11 entries (2026-08-08 → 2026-09-20). The 09-20 run
swept the README's headline claims (RTK, fallback, rotation, usage) through curl + SDK; the
09-19 run swept federation acceptance A/A+/B/C/D. What NO run did:

1. **Bootstrap through the dashboard UI** — first login, provider wiring, key minting, all
   as a human user would. The 09-20 report literally documents the curl route. Every
   friction a NEW HUMAN hits lives on this surface.
2. **`/v1/embeddings` with real consumers** — it is in the README capability matrix and in
   `skills/9router/SKILL.md` (`/v1/models/embedding`), but no run ever POSTed embeddings.

Result: the UI path works end-to-end (a real user goes from bare instance to serving chat in
~10 minutes); the embeddings path works and returns sane vectors; the defects found are new
classes the previous runs' surfaces could not expose.

---

## Scratch setup (what a real user does, UI-first)

```bash
# fresh production build at HEAD (the .next from 09-19 predated 40+ commits)
npm run build                       # ~3 min
PORT=20127 HOSTNAME=0.0.0.0 DATA_DIR=/tmp/dogfood-9r-0924 \
JWT_SECRET=... INITIAL_PASSWORD=... API_KEY_SECRET=... MACHINE_ID_SALT=... npm run start
# Ready in ~2s; DB landed at $DATA_DIR/db/data.sqlite (isolation verified via /proc/<pid>/environ)
```

Everything below was then done **in the browser** (Chromium via CDP, 780×493 viewport):

| step | UI path | result |
|---|---|---|
| first login | `/dashboard` → redirect `/login` → password | `mustChangePassword:false` — straight in |
| node create | Providers → **Add OpenAI Compatible** | name/prefix/baseUrl + models hint field; node listed immediately |
| connection | node card → **Add API Key** → (Name, Key, Default Model) → Save | `1 connection`, state `active` |
| models | **Import from /models** | **96 ids** (`dlm/…`) imported in seconds |
| client key | Endpoint & Key | default key auto-exists; reveal + copy works |
| usage | Usage | 4 requests / 2,207 in / 90 out — **matches SQLite exactly** |

First completion via the OpenAI SDK (`dlm/qwen3.8-27b`): `UI-CHAIN-OK`. Time from fresh
instance to first successful completion through the UI-wired path: **~10 min**, of which the
build was 3.

## Embeddings — the never-dogfooded endpoint WORKS

```python
from openai import OpenAI
c = OpenAI(base_url="http://127.0.0.1:20127/v1", api_key=KEY)
e = c.embeddings.create(model="dlm/text-embedding-nomic-embed-text-v1.5",
    input=["the router proxies my requests", "the router forwards my traffic",
           "totally unrelated text about cooking pasta"])
```

- 3 vectors, **768 dims**, round-trip ~1.3s.
- **Cosine sanity: PASS** — the two paraphrases score 0.7261, paraphrase-vs-unrelated 0.3491.
  The router neither transposes nor mangles vectors.
- `usage.prompt_tokens` is **0** on embeddings responses (upstream LM Studio reports none),
  and **no usageHistory row is written for embeddings calls at all** (verified in SQLite:
  6 chat rows, 0 embeddings rows) → filed as the accounting half of DF-9ROUTER-39's scope.
- Also driven through a **two-hop chain** from the fresh bunker install (below): dims 768
  in ~1s. The endpoint is end-to-end functional behind a chained router.

## Regression checks on the 09-20 P0s — both fixes HOLD

- **DF-9ROUTER-32** (unparseable body when `stream` omitted): SDK request with NO stream key
  parsed cleanly; content correct; **no `data: [DONE]` tail**. Fixed at HEAD.
- **DF-9ROUTER-33** (usage dead on streaming): streaming call returned a final usage chunk
  (prompt 2032 / completion 24) and a matching usageHistory row. Fixed at HEAD.

## Fresh-machine install leg — PASS (bunker-las-03, agent 6b0e3ee4, destroyed)

```
git clone --depth 50 -b federation https://github.com/totalwindupflightsystems/9router.git   3s
cp .env.example .env && npm install                                                         39s rc=0
npm run dev                                                                                 Ready 436ms
login with documented .env.example default password (`change-me`)                            success
node → scratch instance → LM Studio chain: {"content":"FRESH-CHAIN-OK"}                      2s
chain embeddings: 768 dims                                                                   1s
```

- Node 22.23.2 / npm 10.9.8 on the bare agent; **no host-wide deps installed, no repo
  visibility or credential changed** (public clone only). Agent destroyed after the run.
- **DF-9ROUTER-35 does not reproduce at HEAD:** the fresh node exposed **90 models**
  (was 1 in the 09-20 run). Import-from-models through a 9router-as-upstream works.
- Two NEW chain findings (DF-9ROUTER-40): model ids **double-prefix** through a chained
  9router (`up/dlm/qwen3.8-27b`), and a wrong/typo model id **hangs ~95s** then 400s with a
  misleading `No credentials for provider: openai`.

## Restart persistence — PASS

kill → restart: node, connection, 96 models, client key, usage rows all intact; chat
(`POST-RESTART-OK`) and embeddings (768 dims) immediately after reboot. No re-wiring,
no corruption.

## The defects (each becomes a board row)

### P1 · DF-9ROUTER-38 — 'Require API key' is a silent no-op under the documented quickstart
Flipping the toggle ON (real click, aria-checked=true) leaves `requireApiKey=false` on the
server and unkeyed `/v1/chat/completions` returning **200**. Mechanism: README quickstart
`cp .env.example .env` ships `REQUIRE_API_KEY=false` (.env.example:32), and
`settingsRepo.getSettings()` re-applies the env pin **on every read**, after the DB merge —
by design (QA-9ROUTER-5), but the UI neither disables the switch nor discloses the pin;
PATCH returns 200. Instrumented fetch also caught a **non-deterministic double-PATCH**
(true then false ~2s apart) on some clicks. A user following the README cannot enable
API-key enforcement from the product's own UI and believes they did. (Control: PATCH
`stickyRoundRobinLimit:5` persists → the endpoint itself works; the field is env-shadowed.)

### P2 · DF-9ROUTER-39 — usage accounting inconsistent across stream paths
Non-stream rows store a **local estimate** (prompt 61) where streaming stores the **upstream
number** (2032) — the same request the SDK measured at 2061. ~30x under-count exactly on
reasoning models, exactly on the request shape most SDK clients send. Embeddings calls
record **no usage row at all**. The Usage page totals silently mix measured and estimated.

### P2 · DF-9ROUTER-40 — chained-9router ergonomics: double-prefix ids + 95s hang on bad id
Covered above (install leg). Fail-fast + model-scoped error + id normalization needed.

### P3 · DF-9ROUTER-41 — dashboard polish frictions (first fully UI-driven pass)
Add-API-Key **Check** button gives no feedback for 4s+; 'Require API key' switch clipped at
the viewport bottom; connection save has no success toast. None block use; all erode trust.

---

## Time-to-first-success and friction

| phase | time | friction |
|---|---|---|
| build + instance up, isolated | ~3.5 min | 1 (stale .next → rebuild needed; silent port default) |
| UI login → node → connection → import → key → first completion | ~6.5 min | 3 (Check no-feedback, no save toast, key-reveal icon-only) |
| embeddings first success | ~1 min | 0 |
| fresh box → install → chain (chat + embeddings) | ~1 min + 43s install | 2 (double-prefix ids, 95s hang on typo'd id) |
| restart persistence | ~2 min | 0 |

**Friction count: 6 product findings** (DF-9ROUTER-38/39/40/41 + embeddings-accounting +
double-PATCH race), all new classes — none of the 09-20 P0s reproduce.

## Bunker install leg

`bunker-las-03`, agent `6b0e3ee4`, 2h TTL, **destroyed** after the run (`Agent 6b0e3ee4
destroyed`). Clone 3s / install 39s / dev boot 436ms / two-hop chat+embeddings chain OK.

## Federation snapshot leg — the UI-configured state replicates to an edge and serves

After the UI bootstrap (and with the same scratch DB), the instance was rebooted as
`FEDERATION_MODE=central` (same `DATA_DIR`, nothing re-wired) and a second instance was
booted as `FEDERATION_MODE=edge` (`FEDERATION_CENTRAL_URL` → the central, shared
`FEDERATION_TOKEN`). Results, all measured:

| check | result |
|---|---|
| edge `local-status` | `role:edge, last_state:linked, lastAppliedRevision:111, revisionLag:0` |
| edge replica DB rows | `providerNodes` 1 = central's UI-created node (`dogfood-lmstudio`, same UUID), `providerConnections` 1 (`dlm-main`, credentials replicated), `apiKeys` 1 (client key replicated) |
| edge `/v1/models` | **96 ids** — the UI-imported catalog, replicated verbatim |
| edge-served completion through the replicated provider | `{"content":"EDGE-SNAPSHOT-OK"}` (upstream usage prompt_tokens 2062) |
| edge-served embeddings | **768 dims** |

The snapshot path carries the entire dashboard-configured state — node, connection
(including its upstream credential), client key and the 96-model import — and the edge
serves real chat + embeddings traffic from the replica alone. This closes criterion (3) of
the dogfood task: restart persistence PASS + federation snapshot PASS.

Operations note (finding, not a defect of the product): port `:20129` on the control host is
held by a leftover federation-e2e container (`9router-edge-a` mapping host 20129); the
dogfood edge was run on `:20131` instead. `docker pause` does NOT free a container's bound
sockets (listener survives the pause — the edge boot failed twice with EADDRINUSE before the
port change). The leftover container was paused for ~20s, unpaused immediately, verified
healthy (health 200), and left untouched.

## If I had one hour of the maintainer's time

1. **DF-9ROUTER-38** — env-pinned settings must be disclosed in the UI (disabled switch +
   "pinned by REQUIRE_API_KEY in .env"). Security controls that silently no-op are worse
   than absent ones.
2. **DF-9ROUTER-39** — take usage from the upstream response object on the non-stream path
   (it is in hand before the body is returned); write embeddings rows (even 0-token) so the
   Usage page counts them.
3. **DF-9ROUTER-40** — fail fast on model-not-found from compatible nodes with a
   model-scoped message, and strip/dedupe prefix composition on chained routers.
