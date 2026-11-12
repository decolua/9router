# 2026-10-20 — 9router as a PUBLISHED PACKAGE on a fresh machine (dogfood)

Lane: `9router-dogfood` (tick 2026-10-20-09-03-45). Angle: the artifact a first-time user
actually touches — the npm package `9router@0.5.104` — driven on a machine that has never
seen the project, plus an audit of what that install tells the user.

Repo state at test time: fork `federation` HEAD `01235645`; published package `9router@0.5.104`
(npm, published 2026-10-15T15:00:13Z); live deployment `:20128/:20129/:20130` = `0.5.99`
(`hasUpdate:true`).

## 1. Does the documented quickstart install on a clean machine?

Host: ephemeral bunker agent `d7673bc5` on `bunker-mvp` (Ubuntu 24.04.4, uid 1421, 8 vCPU,
no project toolchain). Only `git`, `curl`, `tar`, `python3`, `docker` present.

| step | command (as documented) | result |
|---|---|---|
| prerequisite | — | `node` MISSING, `npm` MISSING, `npx` MISSING |
| node 22 (NOT documented by 9router) | nodejs.org `latest-v22.x` tarball, extracted to `$HOME/node` | node v22.23.3 / npm 10.9.9 in **4 s** |
| README:116 | `npm install -g 9router` | rc=0, **10 s**, binary `9router` → `0.5.104` |
| start | `9router --port 20299 --skip-update --no-browser` | `/api/health` 200 in **6 s** |
| README:158 source path | `git clone https://github.com/totalwindupflightsystems/9router.git` | **1 s**, HEAD `699edac` (= `master`, the upstream mirror — NOT the `federation` work branch) |
| README:1668 | `npm install` (in the clone) | 594 packages, **77 s**, rc=0 |

Installability verdict: **PASS** — a clean machine can install `9router` from the public
registry and reach a serving router in ~20 s (4 s node + 10 s package + 6 s boot).
The gap: the documented first step assumes a Node runtime a bare machine does not have (already
filed as DF-9ROUTER-60). The source clone is public and fast, but the default branch is the
upstream mirror, not the fork's feature branch.

## 2. First-use chain (fresh instance, published package)

```
curl -s -X POST http://127.0.0.1:20203/api/auth/login -H 'Content-Type: application/json' -d '{"password":"123456"}'
  → 200 {"success":true,"mustChangePassword":false}
curl -s -b cookies.txt -X POST http://127.0.0.1:20203/api/keys -H 'Content-Type: application/json' -d '{"name":"df20-me-audit"}'
  → 201, key sk-… (35 chars)
curl -s -H "Authorization: Bearer $KEY" http://127.0.0.1:20203/v1/models
  → 200, 317,196 bytes, 824 model ids
```
Login, key minting, the dashboard and the model list all work on a fresh install with no
provider configured. The default password is `123456` (source fallback) and the README does not
say so (already filed DF-9ROUTER-53).

## 3. What that fresh install can actually DO — 0 of 824

Every advertised id that was tried refused a standard OpenAI chat completion:

| model (advertised by `/v1/models`) | result |
|---|---|
| `alicode-intl/glm-5`, `anthropic/claude-sonnet-4.5`, `opencode/gpt-5` | 404 `{"error":{"message":"No active credentials for provider: <p>","type":"invalid_request_error","code":"model_not_found"}}` in **7 ms** |
| `oc/jev-1.13-free` (credentialless, deliberately advertised) | 400 upstream `ModelProtocolUnsupported` (also with `stream:true`) |
| `mmf/mimo-auto` (credentialless, deliberately advertised) | 400 upstream `"Unsupported model mimo-auto"` |

Reproduced on three independent fresh instances (scratch `:20202` before any provider was
configured, scratch `:20203`, and the fresh bunker machine) — always **824 ids**, always 0
completions. Once a provider node + connection existed on `:20202` the same endpoint returned
**5** ids (the credentialless set), i.e. the surface swings between "824, all dead" and
"5, all dead".

This is a recurrence of a defect the repo believes it fixed. `src/app/api/v1/models/route.js`
:444-454 tracks `connectionsLoaded` and :536-566 states the intent — a fresh install must
advertise only providers that genuinely need no credentials, "Listing the whole static catalog
here is what advertised ~1000 models that immediately fail chat with 404"; the all-static list
is the fail-open path for a FAILED lookup only (`const failOpen = !connectionsLoaded`, :546).
The fresh install nevertheless serves the full static catalog. Board ancestors already
`complete`: DF-9ROUTER-2, DF-9ROUTER-7, DF-9ROUTER-54. Filed as **DF-9ROUTER-2-R2**.

**Impact:** the first thing a user does with a new router is point a tool at `/v1/models` and
pick a model. They get 824 choices and a 404/400 whichever they pick; the useful subset is the
5 credentialless ids, and those fail upstream on this endpoint too.

## 4. Cost in time (Step 2b) — nothing a user would notice

| operation | cold (fresh machine) | warm (`%{time_total}`, 6-8 runs) |
|---|---|---|
| node runtime bootstrap | 4 s | n/a (one-shot) |
| `npm install -g 9router` | 10 s | n/a (one-shot) |
| boot → `/api/health` 200 | 6 s | n/a (one-shot) |
| `GET /api/health` | — | 2.45–3.60 ms |
| `GET /v1/models` (824 ids, 317 KB) | — | 5.73–10.02 ms |
| `GET /login` | 11.74 ms (first) | 2.38–3.03 ms |
| `GET /dashboard` | — | 307 redirect, 2.58 ms |

No PERF row: no path here makes a user wait.

## 5. Time-to-first-success and friction

- **Time to a serving router:** ~20 s on a machine that has never seen the project.
- **Time to first successful completion:** never — 0 of 5 attempts across 3 fresh instances.
- **Friction count: 6** — (1) Node runtime is an undocumented prerequisite; (2) default
  password `123456` is not in the README; (3) 824 advertised models, none routable on a fresh
  install; (4) the credentialless models the code deliberately advertises also fail upstream
  (protocol / unsupported-model 400); (5) no `docs/qa/use-cases.md` catalog exists, so these
  user goals have no durable UC/REG record outside this log; (6) `.gitignore:102` (`9router-*`)
  silently ignores new per-surface skill directories, so the dogfood convention of adding
  `skills/9router-<surface>/SKILL.md` no longer works with a plain `git add` (this run folded
  its findings into the tracked `skills/9router/SKILL.md` instead).

## 6. Evidence (ephemeral host paths, listed for the record)

- `/tmp/df20-me/leg-fresh-machine.log` — full fresh-machine leg (per-step rc, timings)
- `/tmp/df20-me/models-fresh-machine.json` — the 824-id catalog as served on the fresh machine
- `/tmp/df20-me/bunker-leg.sh` — the leg script itself (re-runnable)
- `/tmp/df20-me/log/*.json` — scratch-instance login/key/models/chat responses
- agent `d7673bc5` (bunker-mvp) destroyed; `bunker list` back to its pre-run count

## 7. Run integrity note

This tick was delivered **twice** into one session, so a second executor ran the same tick
concurrently (live-chain/SSE angle + the `bunker-qa.sh` battery on agent `f4c5e00f`). This
document covers only the published-package / fresh-machine angle; board rows and the
dogfood-log entry were written once, with the id minted by `board_next_id.py` and re-checked
for uniqueness immediately after the append.
