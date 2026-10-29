# 2026-10-13 — Live-deployment real-use pass (unexercised consumer ladder)

**Run:** 9router-dogfood tick 2026-10-13. **Verdict: FAILED** — the flagship surface of the live
deployment is broken by a stale deploy, not by code. Everything the repo HEAD fixes, the running
containers predate.

## Promise vs reality

Promise: point any OpenAI-compatible client at the gateway with an API key and get working
completions. Reality on the live central (:20128, container v0.5.69, booted 09-28):

- `POST /v1/chat/completions` **without** `stream` — the OpenAI SDK/CLI default — returns HTTP 200
  with an invalid body: `...completion_tokens_details":{"reasoning_tokens":5}}}data: [DONE]\n\n`.
  Strict `json.loads` fails (`Extra data: line 1 column 505`), 3/3 repro, both glm-5.3-flash and
  glm-5.2. This is DF-9ROUTER-32, fixed by b3b4f9d1 in v0.6.0-federation.1 — the container
  predates it (`/app/open-sse/handlers/chatCore.js:120` still has `body.stream !== false`).
- Key revocation is broken the same way: DELETE a key (200, tombstone `deleted:1, isActive:1`)
  and the key **keeps authenticating** — validateApiKey() in the running image lacks the
  NOT_DELETED predicate fixed by 0e56da21 (also in v0.6.0-federation.1). A revocation that does
  not revoke.
- Both edges (:20129/:20130, v0.5.55) show the same glued terminator.

**Single fix direction for both: redeploy central + edges from v0.6.0-federation.2 and re-run the
probes below.**

## What worked (real-use evidence)

- Login → key mint (POST /api/keys → 201) → /v1/models (166 models, 0.47s) → streaming chat
  (clean SSE, 10 chunks, 0.76s) → non-stream chat content correct (only the tail is corrupt).
- Fail-closed ladder: no auth on a fresh install → correct OpenAI 401 envelope
  (`invalid_api_key`); bad key on live → 401; unknown model → 404 model_not_found (message
  misleadingly blames "provider: openai" — DF-9ROUTER-56).
- Fresh-install leg on bunker-mvp agent 62bac767: clone 6.5s, node22 4.4s, npm i 43s, dev Ready
  ~1.25s, destroy clean (destroy gate correctly refuses while the dev server is live), residue
  clean after 90s.

## Perf (nothing router-attributed slow, no PERF row)

Non-stream chat warm 0.76–2.2s (upstream-bound), streaming 0.76s, /v1/models 0.47s, dashboard
~8ms. One 14.1s edge-a sample (upstream wait). These match the 10-10 numbers; the deployment is
not slower than the code — it is older than the code.

## Re-deploy acceptance probes

1. Non-stream: `curl -s $BASE/v1/chat/completions -H "Authorization: Bearer $K" -H 'Content-Type:
   application/json' -d '{"model":"ocg/glm-5.3-flash","messages":[{"role":"user","content":"hi"}]}'
   | python3 -m json.tool` must parse.
2. Revocation: mint key → complete (200) → DELETE key → immediate complete must be 401.
3. `/api/version` must report ≥ 0.6.0-federation.1 on central AND both edges.
