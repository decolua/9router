# FED-GAP-04 — real `/api/health` route + free-tier completion, asserted (2026-09-18)

Successor of the value-claims matrix in
`docs/dogfood/2026-09-18-federation-value-claims.md` (§3 rows B6 / C2 / C5, §5
row `FED-GAP-04`). Those rows rested on manual dogfood output —
"the published package served health" and "an active free OpenCode model
returned `dogfood-ok` through OpenAI streaming" — that no command reproduced:
`grep -rn 'api/health/route' tests/ --include=*.test.js` had **no match**, and
no automated check performed a completion at all.

This artifact records what is now asserted, by which check, and what is still
not covered.

## 1. What the gap was

| Missing half | Why it mattered |
|---|---|
| The real `GET /api/health` route body | The only health assertions were `tests/unit/cli-port-resolution.test.js:460` against a **stub** child and `tests/unit/cli-build-artifacts.test.js:64` against a build's file list. A regression in `src/app/api/health/route.js` (status, body shape, CORS) was invisible. |
| A free-tier completion | `tests/unit/openai-stream-done-sentinel.test.js` proved the `[DONE]` contract with a mocked upstream; `tests/unit/provider-free-tier-honesty.test.js` proved how the free tier is classified. Nothing showed the free-tier *completion path* working. |
| The federation E2E's `/api/health` | `tests/federation/e2e.mjs` answered `/api/health` from a **framework-free harness branch** returning `{ok, role, edgeId, state}` — a harness-only contract that would have stayed green if the application route broke. |

## 2. What is asserted now

### 2.1 The real route boundary

`src/app/api/health/route.js` is a 15-line module exporting `GET` (200
`{"ok":true}` + `Access-Control-Allow-Origin: *`) and `OPTIONS` (204 +
preflight headers). The harness no longer re-implements it:

* `tests/federation/e2e.mjs` + `tests/federation/e2e-child.mjs` — the child
  imports the tracked route module and dispatches it through the **Next route
  contract** (web `Request` in → the module's own `Response` written to the
  socket, streamed body and all). Checks:
  * `real route: GET /api/health on :<port> returns 200 {ok:true} (src/app/api/health/route.js)` — on all three standalone instances;
  * `real route: OPTIONS /api/health answers the module's 204 CORS preflight`;
  * `real route: /api/health is served by the tracked module (file + sha256 provenance)` — the instance reports the module it loaded *and its sha256*, compared against the repo file, so a re-implemented endpoint cannot pass;
  * `standalone harness: /api/e2e/instance reports role=standalone on :<port>` — the lifecycle observation that used to live on `/api/health` moved to the harness-only path `/api/e2e/instance`.
* `tests/federation/health-route-and-free-tier.test.js` — imports the module
  directly (real `NextResponse`, no `next/server` mock) and asserts
  `200` + `toEqual({ok: true})` (exact key set) + content type + CORS, and the
  `OPTIONS` 204 contract.

### 2.2 The free-tier completion

The model is **derived from the app's own catalog**, never hardcoded
(`tests/federation/free-tier-fixture.mjs` → `resolveFreeTierTarget()`):
`FREE_PROVIDERS` filtered to `noAuth` and not `requiresVendorClient` →
`mimo-free` (`mmf`) → `mmf/mimo-auto`. At this revision that yields exactly one
provider, the one whose `auth.js` path injects the virtual `Public`
connection (`{id:"noauth", accessToken:"public"}`).

The request travels the real route (`src/app/api/v1/chat/completions/route.js`
→ `handleChat` → `chatCore` → the provider's executor): API-key gate →
free-tier credential injection → provider selection → request translation →
SSE aggregation → terminal sentinel. Only the provider's **outbound transport**
is answered locally, and that fixture *records* what it served
(`bootstrapRequests`, `chatRequests`, `offTargetBlocked`, `lastChatRequest`),
so "the free-tier provider really ran" is asserted, not inferred. A request to
the same host on an undeclared path is refused with `501` (counted separately)
instead of silently escaping to the live endpoint.

Checks:

* standalone instance: `real /v1/chat/completions streams the free-tier model to a terminal [DONE]` (200 + `text/event-stream` + last frame `[DONE]` + the fixture's two joined deltas = `e2e-free-tier-ok`) and `the app's free-tier executor drove the provider transport (fixture evidence, no live network)` (1 bootstrap + 1 chat + 0 off-target + model `mimo-auto` + the anti-abuse system marker injected by `transformRequest`);
* negative control: `an invalid API key is rejected 401 by the real route (the /v1 stand-in never checks keys)` — the discriminator between "the application answered" and "the harness answered";
* LINKED edge → central: the client key is relayed in `X-9r-Client-Authorization`, central authenticates the **end client** (FED-011) and runs the app pipeline — asserted by the completion plus **central's own** fixture evidence;
* DEGRADED edge with central killed: the edge serves it from its **own** app pipeline (`X-Federation-State: degraded`), asserted by the edge's fixture evidence.

### 2.3 Red-proofs (each new criterion was made to fail)

| Mutation | Expected | Observed |
|---|---|---|
| `src/app/api/health/route.js` replaced by the pre-task harness-only body (`{ok, role, edgeId, state}` as `NextResponse.json`, `OPTIONS` → 200) | the health assertions fail | `expected { ok: true, role: 'standalone', …(2) } to deeply equal { ok: true }` + `expected 200 to be 204` — 2 failed / 3 passed |
| the free-tier dispatch removed from the child (the pre-task behaviour: the `/v1` stand-in answers every model) | the free-tier checks fail | **7 checks fail, 31/38 pass**; each names the fallthrough: `ct=text/event-stream frames=3 content="ok!"` and `evidence={"chatRequests":0,...}`; the invalid-key control also flips (`status=200`, no 401) |
| the fixture answers the free provider's chat endpoint with JSON instead of SSE | the terminal-`[DONE]` assertion fails | `expected undefined to be '[DONE]'` — 1 failed / 4 passed |

The in-run red-proof (a second instance booted with only that one route file
replaced, via `9ROUTER_E2E_SRC_OVERLAY`) is itself a check:
`red-proof: the old harness-only /api/health body FAILS the real-route assertion`
— detail `body={"ok":true,"role":"standalone","edgeId":"edge","state":null}`.
A future change that hand-rolls `/api/health` again turns the real-route
checks red instead of green.

## 3. Exact reproduction (no network, no credentials, no `RUN_REAL`)

```bash
cd /home/kara/9router

# focused (vitest) — the two route boundaries, in-process
cd tests && ./node_modules/.bin/vitest run federation/health-route-and-free-tier.test.js && cd ..
# → Test Files 1 passed (1) · Tests 5 passed (5) · ~15s

# federation E2E — 38 checks, three instances + the mutation red-proof
npm run test:e2e
# → === FEDERATION E2E SUMMARY (19.6s) === … 38/38 checks passed · E2E PASSED

# repository regression gate
npm test -- --reporter=json --outputFile=/tmp/9router-vitest-results.json
node tests/__baseline__/verify-no-regression.mjs /tmp/9router-vitest-results.json
```

Observed check excerpts (this revision):

```
PASS real route: GET /api/health on :41763 returns 200 {ok:true} (src/app/api/health/route.js) — status=200 body={"ok":true} acao=*
PASS real route: /api/health is served by the tracked module (file + sha256 provenance) — served=/home/kara/9router/src/app/api/health/route.js sha=d36fab88e22d expected=/home/kara/9router/src/app/api/health/route.js sha=d36fab88e22d
PASS free-tier completion: real /v1/chat/completions streams the free-tier model to a terminal [DONE] — status=200 ct=text/event-stream frames=4 content="e2e-free-tier-ok"
PASS free-tier completion: the app's free-tier executor drove the provider transport (fixture evidence, no live network) — evidence={"bootstrapRequests":1,"chatRequests":1,"offTargetBlocked":0,"lastChatRequest":{"url":"https://api.xiaomimimo.com/api/free-ai/openai/chat","model":"mimo-auto","stream":true,"messageCount":2,"systemMessages":1}}
PASS free-tier completion: an invalid API key is rejected 401 by the real route (the /v1 stand-in never checks keys) — status=401 body="{\"error\":{\"message\":\"Invalid API key\",…}}
PASS red-proof: the old harness-only /api/health body FAILS the real-route assertion — status=200 body={"ok":true,"role":"standalone","edgeId":"edge","state":null}
PASS real free-tier completion: LINKED edge-a → central streams the free-tier model to a terminal [DONE] — via edge-a status=200 ct=text/event-stream frames=4 content="e2e-free-tier-ok"
PASS real free-tier completion: DEGRADED edge-a serves it from its own app pipeline (central down) — state=degraded status=200 ct=text/event-stream frames=4 content="e2e-free-tier-ok"
```

## 4. Honest limits (not claimed)

1. **Next's router is not in the loop.** The harness dispatches the route
   module through the Next route contract itself (web `Request` →
   `Response`, streamed body relayed) rather than through a `next build` +
   `node custom-server.js` boot. The route **logic** and its response are the
   app's; Next's routing/telemetry around it is not exercised. The packaged
   boot remains `FED-GAP-05`. (`FEDERATION_MODE=edge` cannot run under
   `next dev` — `npm run dev` exits FATAL — so a dev-server variant is not an
   option either.)
2. **The free-tier transport is a local fixture.** The provider's outbound
   HTTP is answered by `tests/federation/free-tier-fixture.mjs`; the live free
   endpoint is never contacted, and a transport change fails loudly with `501`
   instead of reaching the network. Everything on the app side of that
   boundary is real.
3. **Not an OpenCode repro.** The dogfood ran `oc/…` models; `opencode`
   carries `requiresVendorClient: true` and answers `403 FreeTierError`
   outside OpenCode's own client (DF-9ROUTER-1), so a 9router-side OpenCode
   free completion is defined not to work. The check uses `mimo-free`, the
   provider the app itself classifies as genuinely credentialless — and
   derives that choice at run time, so it follows the catalog rather than a
   hardcoded id.
4. **The `[DONE]` sentinel is the app's own.** Deleting the terminal frame
   from the fixture still yields `data: [DONE]` for the client (the pipeline's
   done-sentinel path repairs it) — the assertion therefore tests the app's
   client-visible guarantee, not the upstream's spelling; the JSON-transport
   mutation above is what makes that assertion fail.
5. **`/v1/responses` and non-streaming free-tier completions** are out of
   scope for this change: the free-tier dispatch covers
   `POST /v1/chat/completions`. The rest of `/v1` keeps the harness stand-in,
   so the E2E's federation lifecycle phases are unchanged.
