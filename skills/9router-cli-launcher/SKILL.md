---
name: 9router-cli-launcher
description: Run, stop and port-control the 9router launcher (cli/cli.js, npm start) — headless mode, lifecycle exits, port precedence, and the fresh-install traps. Verified live 2026-10-23 at HEAD 9e50cba4 (dogfood run 17).
version: 1.0.0
---

# 9router launcher — the right way to start, stop and ship it

The launcher is the process a user actually runs. Two entrypoints exist and they are not the same
program:

| Entrypoint | What it runs | Notes |
|---|---|---|
| `node cli/cli.js` (fork source) | the launcher in this repo, then the standalone app under `cli/app/` | has `--no-tray`, the loud exit lines, `connect` / `show` / `xai video` |
| `npm start` (`node scripts/start.mjs` → `custom-server.js`) | the repo's production server from `.next/standalone/` | **requires `npm run build` first**; FATAL otherwise |
| `npm install -g 9router` (published npm) | **upstream**, no federation | different help text; older than the fork |

## Start it headless (servers, ssh, tmux, CI)

```bash
node cli/cli.js --no-tray --skip-update --no-browser --port 20128
```

- `--no-tray` is the headless escape (DF-9ROUTER-64): no tray install, no icon, no interface menu,
  no auto-start. Without it, a non-TTY session falls into **tray mode**.
- `--skip-update` avoids a registry round trip; without it the launcher checks npm and, in an
  interactive session, offers to `npm install -g 9router@latest` — which on a fork install replaces
  the federation build with upstream (`DF-9ROUTER-68`). Always pass it on a fork.
- Verified boot → `/api/health` 200 in **2.8–4.9 s**; exit line on stderr, e.g.
  `[2026-10-23T14:04:47.733Z] [9router] exiting: signal {"signal":"SIGINT"}`.

## Stop it

| Signal | Behaviour (verified) | Use |
|---|---|---|
| SIGINT / SIGTERM / SIGHUP | cleanup runs, detached server group killed, port released in ~120 ms | `kill -INT <pid>` — the normal stop |
| SIGKILL | **cannot** be handled: the detached server keeps serving and the port stays bound | only if you then kill the server yourself |

The docs disclose the SIGKILL orphan honestly. If a launcher was SIGKILLed, find and kill the
standalone server before restarting (`ss -ltnp | grep :20128`), or the next start will refuse with
EADDRINUSE.

## Port contract

Precedence `--port/-p` → `PORT` → `20128`.

```bash
PORT=20129 node cli/cli.js --no-tray --skip-update --no-browser      # env
node cli/cli.js --no-tray --skip-update --no-browser -p 20129        # flag wins over env
```

- A bad `PORT` warns: `⚠ Ignoring invalid PORT="abc" — using 20128.`
- A bad **`--port` is silent** (`DOC-28`): `--port abc` falls through with no message. Check the
  banner (`Server: http://localhost:<port>`) rather than trusting your flag.
- Occupied port → `rc=1`, `❌ Port <n> is already in use by another process (EADDRINUSE). Nothing was
  started…`. The launcher kills whatever it can on that port first — never point it at a port you
  care about (it is not a health-gated takeover).

## The launcher is not a supervisor you can trust blindly

Before it binds, the launcher runs `killAllAppProcesses()` + `killProcessOnPort()` + a pre-flight
probe. On a shared host that means a *foreign* server on the target port can be killed by PID if you
own it, and if you don't, the launch fails with EADDRINUSE. On a box where `20128` is already taken
by someone else's instance, start on a free port explicitly:

```bash
node cli/cli.js --no-tray --skip-update --no-browser --port 30005
```

## `npm start` needs a build — and a bare box may not be able to make one

```bash
cp .env.example .env
npm ci
npm run build                 # must exit 0 and produce .next/standalone/server.js
PORT=20128 npm start
```

- `npm start` without a build exits `FATAL: cannot locate the Next standalone server (server.js)`.
- On 2026-10-23 a fresh Debian bunker box (node v22.14.0, 6 vCPU) failed `npm run build` in 19 s with
  `Failed to collect configuration for /api/oauth/codex/import-token [cause]: TypeError: Cannot read
  properties of undefined (reading 'bind')`, while the same HEAD built green in 94 s on the fleet
  host. If you hit it: capture the chunk stack and the exact env before filing, and try a newer
  node minor (22.22.x) — the failure is environment-shaped, not a repo-wide break (`DF-9ROUTER-67`).

## First user on a fresh instance (fork build)

```bash
# 1. login — the password is INITIAL_PASSWORD from .env (123456 only when that var is unset)
curl -s -X POST http://127.0.0.1:20128/api/auth/login \
  -H 'Content-Type: application/json' -d '{"password":"<INITIAL_PASSWORD>"}' -c cj
# 2. mint a key
curl -s -b cj -X POST http://127.0.0.1:20128/api/keys -H 'Content-Type: application/json' -d '{"name":"cli"}'
# 3. models — a fresh install advertises ONE id (mmf/mimo-auto) and it fails upstream
curl -s http://127.0.0.1:20128/v1/models -H "Authorization: Bearer <key>"
```

- `/v1/models` is unauthenticated **on loopback**; a real remote peer gets `401 API key required for
  remote API access` (a spoofed `Host:` header does not count as remote — the peer address does).
- Failed logins are rate-limited per IP (`remainingBeforeLock`, then `429` with a 30–120 s retry), so
  do not burn attempts guessing passwords.

## Known traps

- `.gitignore:102` is the unscoped pattern `9router-*`: it ignores **any** new `9router-*` path,
  including `skills/9router-<new>/SKILL.md` and `docs/dogfood/9router-*.md`. Write knowledge
  elsewhere or `git add -f` it, and say so (`DF-9ROUTER-69`).
- `cli/app/` is a **prebuilt** standalone app. `node cli/cli.js` runs current `cli.js` but serves the
  last build — check `cli/app/.next-cli-build` (or `.next`) mtime against `git log -1` before
  attributing a runtime behaviour to HEAD.
- The fork's `cli/package.json` is pinned at `0.5.104` while npm `latest` is well ahead, so the
  launcher will always think it is out of date.
