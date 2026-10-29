# 9router Dogfood Integration — 2026-09-19 (HEAD 585bd31c, branch federation)

Real-use run as a fresh user: build → boot → dashboard login → connect a real
local upstream (LM Studio behind an ssh tunnel) → drive OpenAI + Anthropic
traffic → deploy central+edge federation → run acceptance checks A/A+/B/C/D.
All scratch ports/DATA_DIRs; the fleet router on 20128 was never touched.

## What works at HEAD (verified live, not from tests)

- Production boot `npm run build && npm run start` (custom-server.js path):
  ready in ~40s from cold start, migrations 1–5 applied, clean logs.
- Dashboard auth: `POST /api/auth/login` with `INITIAL_PASSWORD` → JWT cookie;
  documented exactly in README (the 09-13 auth-contradiction finding is fixed).
- OpenAI `/v1/chat/completions`: stream AND non-stream return real completions
  with usage (`prompt_tokens 2044 / completion 34` observed end-to-end).
- Anthropic `/v1/messages`: real Anthropic event stream (message_start →
  content_block_delta → …) — the 09-13 "OpenAI body on /v1/messages" P0 is
  fixed.
- Usage tracking: `usageHistory` + `usageDaily` rows recorded per request.
- Federation at HEAD 585bd31c — all four acceptance checks PASS:
  - A: edge `local-status` → `linked`, `revisionLag: 0` after central writes.
  - A+: row-level integrity — replicated `apiKeys` rows match central on
    `federation_version` AND `updated_at` byte-for-byte.
  - B: client API key created on central authenticates through the edge and
    returns a real completion (proxying works).
  - C: `/api/federation/*` answers Bearer-only — no token = 401.
  - D: full lifecycle — SIGKILL central → edge flips `degraded` (~threshold),
    `/v1` keeps serving from replica, dashboard write returns 202 with
    `X-Federation-Queued-Write-Id`, central restart → edge back to `linked`
    (~15-20s), queued row drained to central (revision 7 on both sides).

## Friction found this run (filed as board rows)

1. **DF-9ROUTER-29 (P1)** — wiring a local OpenAI-compatible endpoint is a
   three-step, mostly undocumented path. The obvious routes all dead-end:
   `POST /api/providers {provider:"ollama-local", baseUrl:…}` accepts the body
   but `baseUrl` is only honored by the ollama-native executor (silent
   mismatch); `POST /api/providers {provider:"openai-compatible-…"}` → 400
   "Invalid provider"; provider NODES are the real mechanism
   (`POST /api/provider-nodes` with `type/apiType/prefix/baseUrl`) but that API
   stores no key — you must ALSO create a connection
   (`POST /api/providers {provider:<node.id>, apiKey:…}`) before traffic works.
   I had to read `src/sse/services/model.js` + `src/lib/db/repos/nodesRepo.js`
   to learn this. Time-to-first-success ≈ 6 min, friction 4.
2. **DF-9ROUTER-30 (P2)** — protocol mismatch surfaces as a silent empty
   completion: pointing `ollama-local` at an OpenAI-shaped server returns HTTP
   200 with just `data: [DONE]` (0 tokens), central logs a normal-looking
   `DONE · IN 0 · OUT 0`. Nothing tells the user the executor/upstream
   protocols disagree. Same class as DF-9ROUTER-23 (empty-as-success).
3. **DF-9ROUTER-31 (P3)** — outage-window behavior: in the ~10s between
   central death and the edge's DEGRADED flip, `/v1` answers
   `FED_UPSTREAM_ERROR` even though the replica is fresh (lag 0); serving from
   the replica would be safe there. Minor, but a real user sees a hard error
   during the exact window federation exists for.

## Verdict

PROMISING-BUT-ROUGH → the core gateway and the federation flagship both work
end-to-end at HEAD; remaining roughness is onboarding friction (local-endpoint
wiring) and silent-failure polish, not broken promises. All five 09-13
dogfood P0/P1 findings re-checked: none reproduce.

## Repro notes (scratch environment)

- Scratch instance: `DATA_DIR=/tmp/dogfood-9router-19 PORT=20199 npm run start`.
- Local upstream: ssh -N -L 127.0.0.1:11234:127.0.0.1:1234 master001 (LM Studio).
- Federation: /tmp/df19-fed-boot.sh (central 20131, edge 20132), acceptance
  recipe in skills/9router-federation-usage/SKILL.md (all still accurate).
