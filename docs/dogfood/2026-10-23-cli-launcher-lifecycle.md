# 2026-10-23 — The CLI launcher as a first-time user (lifecycle, ports, install)

**Tick:** `9router-dogfood-2026-10-23-13-55-53` · **Target:** 9router fork, HEAD `9e50cba4` (branch `federation`)
**Angle:** the **launcher** (`cli/cli.js` + `npm start`) — the process a user actually starts and stops.
Never driven by a prior dogfood run: earlier ticks covered the HTTP API, dashboard, federation,
multimodal, compose and the published npm package, but not the launcher's own contract.
**Environment:** fleet host (`/tmp/df23`, isolated `HOME`), plus one ephemeral bunker agent
(`df9router1023` on `bunker-las-02`) for the fresh-machine install leg.
**Sibling disclosure:** a second delivery of this same tick ran concurrently on the same checkout
(combos/usage-accounting angle, rows `DF-9ROUTER-65/66`). This report covers **only** the
launcher/install/PR surface; `docs/dogfood/diagnostics.md` was left to that run to avoid two writers
on one file.

---

## 1. The promise being tested

> "Run this fork from source … `npm ci` … `PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev`"
> — README, *Run from source (this fork)*

> "Every lifecycle exit also writes a timestamped line to stderr — `[<ISO time>] [9router] exiting: <reason>`
> — so a headless death is always diagnosable from the logs."
> "Port precedence (highest first): `--port/-p` → `PORT` env var → `20128` … An unusable `PORT` … is
> ignored with a one-line warning naming the value and the port actually used; an unusable `--port`
> argument falls back the same way. An occupied port is refused with an `EADDRINUSE` message that names
> both `--port <other port>` and `PORT=<other port>`."
> — `cli/README.md` §CLI Options

Null hypothesis: *a user can build this fork from the docs, start it, stop it cleanly, control which
port it binds, and recover from a typo or a busy port — all from the launcher, on a machine that has
only the documented prerequisites.*

---

## 2. What was actually driven

| # | Action | Command |
|---|---|---|
| 1 | Published launcher installed cold into an isolated prefix | `npm install -g --prefix /tmp/df23/prefix 9router@0.5.109` |
| 2 | Fork launcher help (HEAD source) | `node cli/cli.js --help` |
| 3 | Headless boot, four times | `node cli/cli.js --no-tray --skip-update --no-browser --port 2031x` |
| 4 | Stop paths: SIGINT, SIGTERM, SIGKILL | `kill -INT/-TERM/-KILL <launcher pid>` |
| 5 | Port contract: unusable `--port`, `--no-tray`+`--tray`, occupied port | `PORT=20313 node cli/cli.js --port abc …`; `--port 22` |
| 6 | First-user ladder on the scratch instance | login → `POST /api/keys` → `/v1/models` → one chat |
| 7 | Auth matrix incl. a **real remote peer** (LAN IP, not a spoofed `Host`) | `curl http://192.168.123.147:20317/v1/models` |
| 8 | Interactive menu, captured through a real PTY | `script -qec "node cli/cli.js --no-browser --port 20318" out.raw` |
| 9 | Documented CLI verbs | `show`, `show claude`, `connect`, `xai video --help` |
| 10 | Fresh-machine install of the **fork** from the documented source path | bunker agent `df9router1023`: node tarball → `git clone --branch federation` → `cp .env.example .env` → `npm ci` → `npm run build` → `npm start` |

## 3. Results

### 3.1 The launcher contract holds (verified, not assumed)

| Claim (cli/README) | Observed |
|---|---|
| `--no-tray` serves headless in the foreground | banner `🚀 9router v0.5.104 (headless)` + `Tray/UI disabled (--no-tray)`; **no** tray artifacts created under the isolated `HOME` |
| `--no-tray` wins over `--tray` | `--no-tray --tray` → still headless, still no tray artifacts |
| SIGINT/SIGTERM/SIGHUP run cleanup and kill the server group | launcher exited in **120 ms** (INT) and **118 ms** (TERM); no server process left; port released both times |
| Every lifecycle exit writes `[<ISO>] [9router] exiting: <reason>` | `[2026-10-23T14:04:47.733Z] [9router] exiting: signal {"signal":"SIGINT"}` (identical shape for TERM) |
| SIGKILL cannot be handled → orphan may keep serving | confirmed: launcher gone, **port still bound**; the docs disclose this honestly |
| Occupied port is refused, naming both fixes | `--port 22` → `rc=1`: `❌ Port 22 is already in use by another process (EADDRINUSE). Nothing was started. Free the port, or start with --port <other port> (or PORT=<other port>).` |
| Boot → serving | health 200 in **4.93 s / 3.18 s / 2.82 s / 3.83 s** (four boots, standalone build already present) |
| `show` covers every supported tool | 9 rows: Claude Code, Codex, OpenCode, Droid, Crush, Kilo, Cline, Pi, Oh My Pi — each naming its config path |
| `connect` without a URL | usage block, `rc=1` (correct refusal, not a crash) |

Auth on a scratch instance (`requireApiKey = true` per `GET /api/settings`):

| Client | `/v1/models` | `/v1/chat/completions` | `/api/providers` |
|---|---|---|---|
| loopback, no key | 200 | 401 `Missing API key` (OpenAI envelope) | 401 |
| **real remote peer** (LAN IP), no key | 401 `API key required for remote API access` | 401 same | 401 |
| real remote peer, bogus key | 401 same | 401 same | 401 |

A spoofed `Host:` header is **not** equivalent to a remote peer (my first probe returned 200 and was a
harness artifact — the request still arrived on loopback). The documented table in
`docs/api-reference.md` §Authentication reproduces exactly when the peer really is remote.

### 3.2 Fresh-install discovery: the fork's fix holds

A fork instance with **zero provider connections** advertises exactly **1** model
(`mmf/mimo-auto`) from `/v1/models` — not the 824 the *published* package advertised on 2026-10-20
(`DF-9ROUTER-2-R2`). The `DF-9ROUTER-2 / -7 / -54` credential-filter fix is live on the fork.
The single advertised id still fails upstream: `chat` → **400** `[400]: {"error":{"code":"400",
"message":"Unsupported model mimo-auto"}}` in **3.795 s**. A user's very first request therefore
still cannot succeed on a fresh fork install, though the surface is now honest about *how many*
models it is guessing at.

### 3.3 What broke

1. **The interactive launcher offers to replace the fork with upstream** (`DF-9ROUTER-68`).
   PTY capture of the default menu:

   ```
   ========================================
     Choose Interface (v0.5.104)
     🚀 Server: http://localhost:20318
   ========================================
    ★ Update to v0.5.109 (current: v0.5.104)
   ```

   Choosing it (`cli/cli.js:876-886`) prints `Update v0.5.104 → v0.5.109` then
   `npm install -g 9router@latest` (`INSTALL_CMD_LATEST`) and exits — and `README.md` states that
   command installs **upstream, without this fork's federation feature**. The item can never clear:
   `cli/package.json` is pinned at `0.5.104` while npm `latest` is `0.5.109` (published today), so
   every fork user is told their install is stale.

2. **`.gitignore:102` hides new skill directories** (`DF-9ROUTER-69`). The rule is the unscoped
   `9router-*` (meant for the `9router-<version>.tgz` pack artifact at the repo root):

   ```
   $ git check-ignore -v 9router-0.5.104.tgz skills/9router-newskill/SKILL.md docs/dogfood/9router-note.md
   .gitignore:102:9router-*	9router-0.5.104.tgz
   .gitignore:102:9router-*	skills/9router-newskill/SKILL.md
   .gitignore:102:9router-*	docs/dogfood/9router-note.md
   ```

   The 14 tracked `skills/9router-*` bodies survive only because git ignores `.gitignore` for
   already-tracked files. Any **new** usage skill an agent writes there is dropped silently — the
   repo's own knowledge-sharing path is one filename away from not landing in a clone.

3. **An unusable `--port` is silent** (`DOC-28`). `PORT=20313 node cli/cli.js --port abc` boots on
   20313 and prints the banner naming 20313 — but the offending value appears **0 times** on stdout
   or stderr (stderr is 73 bytes: the exit line only). `resolvePort()` (`cli/src/cli/utils/serverStartup.js:74-90`)
   does warn for a bad `PORT` (`⚠ Ignoring invalid PORT="abc" — using 20128.`) but returns no warning
   when the flag is the bad one. `cli/README.md:153-156` says an unusable `--port` "falls back the
   same way" as `PORT`, which reads as the same warning.

4. **Fresh-machine build of the fork fails on a bare box** (`DF-9ROUTER-67`, environment-shaped).
   On `bunker-las-02` (Debian 6.12, 6 vCPU), following the documented path exactly:

   ```
   node/npm MISSING before the documented toolchain step  → node v22.14.0 + npm 10.9.2 in 9 s
   git clone --branch federation   → rc=0, 5 s, HEAD 9e50cba4
   cp .env.example .env            → ok
   npm ci                          → rc=0, 38 s
   npm run build                   → rc=1, 19 s
     Error: Failed to collect configuration for /api/oauth/codex/import-token
       [cause]: TypeError: Cannot read properties of undefined (reading 'bind')
     Error: Failed to collect configuration for /api/oauth/[provider]/[action]
     > Build error occurred
   npm start                       → FATAL: cannot locate the Next standalone server (server.js)
   ```

   **Control arm, same HEAD, same commands, fleet host:** `git clone` 2 s, `npm ci` 16 s,
   `npm run build` **rc=0 in 94 s**, `.next/standalone/server.js` present, postbuild copies assets.
   So this is **not** a broken build in the repo — it is an environment-dependent failure on a stock
   box that the install docs do not prepare a user for, and the failure surfaces only after a 38 s
   install, with a `bind`-of-undefined that names no missing prerequisite. Filed as P2 with both arms
   and a demand for the captured root cause, not a wider timeout.

5. **PR #3173 is CONFLICTING again** (`FED-PR-005-R2`, recurrence of `FED-PR-005`). The fork's stated
   mission is a clean upstream PR; `gh pr view 3173` reports `mergeable = CONFLICTING`,
   `mergeStateStatus = DIRTY`, `changedFiles = 403`, `additions = 57315`, `deletions = 4706`,
   `updatedAt = 2026-10-19`. `origin/federation-pr` is **58 commits behind** `federation` and
   **5 ahead**; upstream `master` carries v0.5.109 (2026-10-23) and is **39 commits ahead** of
   `federation`. The head branch no longer represents the fork's current work, so a maintainer
   reading the PR reviews a stale tree.

## 4. Performance (Step 2b)

Nothing on this surface is slow enough for a user to notice, so **no PERF row was filed**.

| Operation | Measurement |
|---|---|
| `npm install -g 9router@0.5.109` (cold cache, isolated prefix) | **4.30 s** real (`added 11 packages`) |
| Launcher boot → `/api/health` 200 | **4.93 / 3.18 / 2.82 / 3.83 s** (4 boots) |
| `/api/health` warm, 10 samples | 4.04, 3.72, 6.51, 5.75, 4.11, 3.63, 3.64, 3.45, 3.44, 3.09 ms → **p50 ≈ 3.6 ms** |
| `/v1/models` warm, 5 samples | 5.34, 3.51, 3.65, 4.09, 3.73 ms |
| Launcher shutdown (SIGINT / SIGTERM) | **120 ms / 118 ms** |
| Fresh-machine: clone / npm ci / build (agent) | 5 s / 38 s / **failed 19 s** |
| Fresh-machine: clone / npm ci / build (control) | 2 s / 16 s / **94 s** |

The 2.8–4.9 s first boot is the Next standalone compile/warmup, and `README` already budgets
"10–30 s" — the product is *faster* than documented. No profile was warranted.

## 5. Install leg (explicit, not a silent pass)

- **bunker-mvp** (the daemon `bunker list` resolves to) **refused spawn**: `spawn agent: unavailable:
  dial tcp 100.115.67.116:19090: connect: connection refused`. `bunker-las-01/03/04` did not answer
  `bunker list`. `bunker-las-02` was live → agent **`df9router1023`** spawned (`--ttl 90m`).
- Legs that ran on the fresh agent: toolchain bootstrap (node/npm MISSING → v22.14.0 in 9 s),
  clone of the federation branch (5 s), `.env` from `.env.example`, `npm ci` (38 s, rc=0),
  `npm run build` (**rc=1**, error quoted above), `npm start` (**FATAL**, no standalone server).
- **Contamination disclosed:** port `20128` on `bunker-las-02` is held by a **foreign process**
  (`kara`-owned `next-server (v16.3.2)`, `/api/version` → `0.5.55`) that the agent user cannot kill —
  my first two probe rounds therefore answered from *that* instance, not mine. Re-running on a free
  port (`30005`) produced the honest result: `boot_health=000` after 152 s and the FATAL line. All
  numbers in this report that touch the agent come from the `30005` run or the build logs, never
  from `20128`.
- Agent **destroyed** and verified: `Agent df9router1023 destroyed.` + SSH key removed +
  `bunker list --server bunker-las-02` back to its pre-run count (the remaining `fc083fea` belongs to
  another lane, spawned 07:19).

## 6. Verdict

**PROMISING-BUT-ROUGH.** The launcher itself is the best-behaved surface this project has: the
headless escape works, every documented exit line is real, shutdown is 120 ms with no orphans, the
busy-port refusal is exactly as documented. What a first-time user still cannot do is get *from a
clean machine to a running federation router* using the docs alone (build fails on a stock box with
no named cause), and the launcher then invites them to overwrite the fork with upstream.

**Actions filed:** `DF-9ROUTER-67` (fresh-box build), `DF-9ROUTER-68` (update affordance replaces the
fork), `DF-9ROUTER-69` (`.gitignore 9router-*` hides new skills), `DOC-28` (silent invalid `--port`),
`FED-PR-005-R2` (PR #3173 dirty again).

## 7. Reproduction commands

```bash
# launcher lifecycle (isolated HOME; 9router not running on 20311)
HOME=/tmp/x node cli/cli.js --no-tray --skip-update --no-browser --port 20311 &
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:20311/api/health
kill -INT %1        # expect: [..] [9router] exiting: signal {"signal":"SIGINT"} ; port free

# occupied port refusal (root-owned listener, unkillable by the caller)
node cli/cli.js --no-tray --skip-update --no-browser --port 22; echo rc=$?

# silent invalid --port
PORT=20313 node cli/cli.js --no-tray --skip-update --no-browser --port abc   # no "abc" in output

# interactive update affordance (needs a tty)
script -qec "node cli/cli.js --no-browser --port 20318" /tmp/tty.raw

# gitignore trap
git check-ignore -v skills/9router-anything/SKILL.md     # -> .gitignore:102:9router-*

# fresh-machine build
git clone --depth 1 --branch federation https://github.com/totalwindupflightsystems/9router.git f
cd f && cp .env.example .env && npm ci && npm run build && npm start
```
