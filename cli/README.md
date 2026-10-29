# 9Router - FREE AI Router & Token Saver

**Never stop coding. Save 20-40% tokens with RTK + auto-fallback to FREE & cheap AI models.**

**Connect All AI Code Tools (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) to 40+ AI Providers & 100+ Models.**

[![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
[![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
[![Docker Pulls](https://img.shields.io/docker/pulls/decolua/9router.svg?logo=docker&label=Docker%20pulls)](https://hub.docker.com/r/decolua/9router)
[![GHCR](https://img.shields.io/badge/GHCR-decolua%2F9router-blue?logo=github)](https://github.com/decolua/9router/pkgs/container/9router)
[![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)

<a href="https://trendshift.io/repositories/22628" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22628" alt="decolua%2F9router | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[🌐 Website](https://9router.com) • [📖 Full Docs](https://github.com/decolua/9router)

---

## 🤔 Why 9Router?

**Stop wasting money, tokens and hitting limits:**

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls...) burn tokens fast
- ❌ Expensive APIs ($20-50/month per provider)

**9Router solves this:**

- ✅ **RTK Token Saver** - Auto-compress tool_result, save 20-40% tokens
- ✅ **Maximize subscriptions** - Track quota, use every bit before reset
- ✅ **Auto fallback** - Subscription → Cheap → Free, zero downtime
- ✅ **Multi-account** - Round-robin between accounts per provider
- ✅ **Universal** - Works with any OpenAI/Claude-compatible CLI

---

## ⚡ Quick Start

**Option 1 — npm (recommended for desktop):**

```bash
npm install -g 9router
9router

# Or run directly with npx
npx 9router
```

**Option 2 — Docker (server/VPS):**

```bash
docker run -d --name 9router -p 20128:20128 \
  -v "$HOME/.9router:/app/data" -e DATA_DIR=/app/data \
  decolua/9router:latest
```

Published images: [Docker Hub](https://hub.docker.com/r/decolua/9router) • [GHCR](https://github.com/decolua/9router/pkgs/container/9router) (multi-platform amd64/arm64).

🎉 Dashboard opens at `http://localhost:20128`

**2. Connect a FREE provider (no signup needed):**

Dashboard → Providers → Connect **Kiro AI** (free Claude unlimited) or **OpenCode Free** (no auth) → Done!

**3. Use in your CLI tool:**

```
Claude Code/Codex/OpenClaw/Cursor/Cline Settings:
  Endpoint: http://localhost:20128/v1
  API Key:  [copy from dashboard]
  Model:    kr/claude-sonnet-4.5
```

That's it! Start coding with FREE AI models.

---

## Run this fork from source

The published `npm install -g 9router` package is upstream. To build and run the
CLI launcher in this fork from a source checkout, run:

```bash
npm --prefix cli install   # one-time: CLI build deps (esbuild)
DATA_DIR=/tmp/9router-cli-pack npm run cli:pack
node cli/cli.js --skip-update --no-browser
```

The `DATA_DIR` override keeps the reproducible pack command writable when an
ambient `.env` points at a system-owned directory. `npm run cli:pack` writes a
`9router-<version>.tgz` artifact at the repository root; run the source
launcher at `cli/cli.js`, which is also the installed `9router` executable.
There is no separate compiled CLI entrypoint.

---

## Process lifecycle / shutdown

The foreground launcher starts its server as a detached process group. In
foreground mode, Ctrl+C (`SIGINT`), `SIGTERM`, and `SIGHUP` run launcher cleanup,
which kills that server process and its group before the launcher exits. Stop a
foreground launcher with Ctrl+C or `SIGTERM` rather than `SIGKILL`.

`SIGKILL` cannot be handled. If a timeout wrapper sends `SIGKILL` to the
launcher, its cleanup cannot run and the detached server can remain serving.
That is an unavoidable orphan limitation, not evidence that normal shutdown
failed.

When Windows or Linux users select the tray/background option, the launcher
starts an unreferenced detached tray process, cleans up the foreground server,
and exits so the background launcher can own the port. Stop that mode through
the tray **Quit** action; there is no `--stop` flag. On macOS the launcher keeps
its current process instead, because a detached child loses the login session
required by `NSStatusItem`; use the tray **Quit** action there as well.

---

## 🚀 CLI Options

```bash
9router                    # Start with default settings
9router --port 8080        # Custom port
9router --host 127.0.0.1   # Bind the gateway to this machine only
9router --no-browser       # Don't open browser
9router --no-tray          # Headless: skip tray/UI, serve in the foreground
9router --skip-update      # Skip auto-update check
9router --help             # Show all options
```

**Host binding**: the launcher binds the gateway to `0.0.0.0` by default. This
exposes the gateway on every reachable network interface, subject to the host's
firewall and network configuration. Use `--host 127.0.0.1` when the gateway
must be reachable only from the local machine:

```bash
9router --host 127.0.0.1
```

**Headless mode** (`--no-tray`): for servers without a display — a VPS, a
container, an SSH box. The launcher skips the whole tray/UI lifecycle (no tray
runtime install, no tray icon, no interface menu, no auto-start registration,
and `--tray` / the non-TTY tray fallback are ignored) and serves in the
foreground with normal logging until Ctrl+C:

```bash
9router --no-tray          # foreground server, e.g. under tmux/systemd/ssh
```

Every lifecycle exit also writes a timestamped line to stderr —
`[<ISO time>] [9router] exiting: <reason>` — so a headless death is always
diagnosable from the logs.

**Non-interactive launches** (stdin is not a TTY: a pipe, a CI runner, a
systemd unit with no terminal) cannot render the interface menu, so a launch
without `--no-tray` resolves to "Exit" after the readiness gate and the
launcher exits 0 — printing `Exiting...` and the `exiting: server-exit` line
above. That resolution happens *before* the interactive menu stack is loaded,
so a source checkout that only ran `npm ci` at the repo root (no
`npm --prefix cli install`) still exits 0 instead of failing on a missing CLI
dependency.

**Port precedence** (highest first): `--port/-p` → `PORT` env var → `20128`.
The launcher reads the process environment only (it does not load `.env`), so a
host that already runs 9router on `20128` can be given a different port either way:

```bash
PORT=20129 9router --skip-update --no-browser   # env fallback
9router --port 20129 --skip-update --no-browser # --port overrides PORT
```

An unusable `PORT` (empty, non-numeric, `0`, negative, `>65535`) is ignored with a
one-line warning naming the value and the port actually used, written to
**stderr**. An unusable `--port` argument is not that case: it is **silently
ignored** — no line on either stream — and resolution simply continues down the
chain (`PORT`, then `20128`). The port it settled on is reported only in the
launcher's startup output on **stdout** — the `Server: http://<host>:<port>`
banner, plus the `Dashboard:` URL printed beside it in headless mode — so a
typo'd flag is visible there and nowhere else. An occupied port is refused with an
`EADDRINUSE` message that names both `--port <other port>` and `PORT=<other port>`.

That split is the decision itself: `resolvePort()` (`cli/src/cli/utils/serverStartup.js:74-90`)
returns a `warning` only for an unusable `PORT` — the unusable-flag path returns
`{ port, source: "env" | "default" }` with no `warning` — and `cli/cli.js:209-210`
prints that warning with `console.error` (stderr), while the banner uses
`console.log` (stdout). Probe (a checkout without a built `cli/app/` stops right
after port resolution, before anything is spawned):

```bash
$ PORT=abc node cli/cli.js --no-tray --skip-update --no-browser 2>&1 | grep -i port
⚠ Ignoring invalid PORT="abc" — using 20128.
$ node cli/cli.js --no-tray --skip-update --no-browser --port abc 2>&1 | grep -i port
$ echo $?
1
```

The `PORT` case names the offending value and the port used; the `--port` case
emits no port line at all (`grep` exits 1). On a built launcher the second
command simply boots on `20128` and its startup output is the only mention of the
port — dogfooded in `docs/dogfood/2026-10-23-cli-launcher-lifecycle.md` §3.3(3):
`PORT=20313 node cli/cli.js --port abc` boots on 20313 with the banner naming
20313, while `abc` appears 0 times on stdout and stderr.

**Dashboard**: `http://localhost:20128/dashboard`

---

## 🔌 Connect to a Remote 9Router

Already running 9Router on another machine (e.g. a team server on your LAN)? Point this machine's CLI tools at it — no local server is started:

```bash
npx 9router connect http://<server-host>:20128                       # pick tools interactively
npx 9router connect http://<server-host>:20128 --tools claude,codex  # or choose up front
npx 9router connect --reset --tools claude,codex                     # undo
```

It logs in with the dashboard password (hidden prompt), reuses or creates an API key named `cli-<hostname>`, and writes each tool's config (backing up the original once as `*.bak-9router`).

Supported tools: `claude`, `codex`, `opencode`, `droid`, `crush`, `kilo`, `cline`, `pi`, `omp`, or `all`.

### Models

Models come from the **server's own CLI-tools configuration**, so a client gets whatever the operator already picked on the dashboard. Nothing is hardcoded.

| Tool | Model taken from (first match wins) |
|---|---|
| `claude` | tier flag (`--opus` …) → server's Claude tier → *left unset* (Claude Code's own default) |
| others | `--model` → that tool's own model on the server → server's OpenCode model → *tool skipped* |

`kilo` has no readable model on the server, so it always uses `--model` or the OpenCode model. `omp` (Oh My Pi) needs no model: it uses proxy discovery, so every server model appears under `9router` in `/model`. A Claude tier the server doesn't set is removed from your config rather than kept from an earlier run. A skipped tool makes the command exit `1`.

### Overriding the server's models

```bash
# One Claude tier; the other tiers still come from the server
npx 9router connect http://<server-host>:20128 --tools claude --sonnet cc/claude-sonnet-5-5

# Every Claude tier
npx 9router connect http://<server-host>:20128 --tools claude \
  --fable cc/claude-fable-5-1 --opus cc/claude-opus-5-5 \
  --sonnet cc/claude-sonnet-5-5 --haiku cc/claude-haiku-4-5-20251001

# All non-Claude tools at once
npx 9router connect http://<server-host>:20128 --tools codex,opencode,kilo --model ocg/deepseek-flash

# Claude and other tools in one run
npx 9router connect http://<server-host>:20128 --tools claude,codex --opus cc/claude-opus-5-5 --model gpt-6

# A different model per tool: --model covers every non-Claude tool in a run, so run once per tool
npx 9router connect http://<server-host>:20128 --tools codex --model gpt-6
npx 9router connect http://<server-host>:20128 --tools opencode --model ocg/glm-5.3
```

A model the server doesn't list is still written, with a `not listed by server` warning. To see the ids it serves: `curl http://<server-host>:20128/v1/models -H "Authorization: Bearer <your key>"`.

### Checking the current config

`9router show` prints what each CLI tool on this machine is currently set to — base URL, masked API key and models. It only reads local files and never contacts a server.

```bash
npx 9router show                 # every supported tool
npx 9router show claude          # one tool
npx 9router show claude codex    # several
npx 9router show claude --json   # machine-readable (key still masked)
```

```
✅ Claude Code
   File:     ~/.claude/settings.json
   Base URL: http://<server-host>:20128/v1
   API key:  sk-a1b…9f3c
   Models:
     fable   cc/claude-fable-5-1
     opus    cc/claude-opus-5-5
     sonnet  cc/claude-sonnet-5-5
```

Tools not pointed at 9router are listed as `not configured`. For Codex, OpenCode and Cline it also warns when a 9router entry exists but another provider is the active one.

### Other options

| Option | Purpose |
|---|---|
| `--password <pw>` | Dashboard password (or `NINE_ROUTER_PASSWORD`); prompted if omitted — preferred, keeps it out of shell history |
| `--save` | After a successful login, save the password for this server to `~/.9router/connect.env` (plain text, mode 600) so later runs skip the prompt. Delete the file to forget it |
| `--api-key <key>` | Use this key and skip login. The server's models can't be read without a login, so pass model flags |
| `--key-name <name>` | API key name to reuse/create (default `cli-<hostname>`) |
| `--print-env` | Also print `OPENAI_BASE_URL` / `OPENAI_API_KEY` for other CLIs |
| `--reset` | Remove the 9router settings from the selected tools |

See `9router connect --help` for the full list.

> ⚠️ Over plain `http://` the password and API key are sent unencrypted — use a trusted LAN/VPN or put HTTPS in front. The API key is stored in each tool's config file.

---

## 🛠️ Supported CLI Tools

Claude-Code • OpenClaw • Codex • OpenCode • Cursor • Antigravity • Cline • Continue • Droid • Roo • Copilot • Kilo Code • Gemini CLI • Qwen Code • iFlow • Crush • Crusher • Aider

Any tool supporting OpenAI/Claude-compatible API works.

---

## 💾 Data Location

- **macOS/Linux**: `~/.9router/db/data.sqlite`
- **Windows**: `%APPDATA%/9router/db/data.sqlite`
- **Docker**: `/app/data/db/data.sqlite` (mount `$HOME/.9router` to persist)

---

## Generate a video with xAI Grok Imagine

Start the 9Router gateway first, then run the subcommand in another terminal:

```bash
9router xai video --prompt "A quiet mountain lake at sunrise" --output sunrise.mp4
```

This subcommand does not start the gateway. By default it connects to `127.0.0.1:20128`, polls until the job finishes, and downloads the MP4 to the output path. The gateway must have an xAI account connected (Grok Build OAuth or an API key). If gateway authentication is enabled, provide a 9Router API key with `--api-key <key>` or `NINE_ROUTER_API_KEY`.

Options:

| Option | Description |
| --- | --- |
| `--prompt <text>` | Video description (required). |
| `--output <file>`, `-o <file>` | Output MP4 path (default: `video.mp4`). |
| `--model <id>` | Model (default: `xai/grok-imagine-video`). |
| `--duration <seconds>` | Requested video duration. |
| `--aspect-ratio <ratio>` | Aspect ratio, e.g. `16:9`, `9:16`, or `1:1`. |
| `--resolution <res>` | Resolution: `480p`, `720p`, or `1080p`. |
| `--image <path-or-url>` | Image input for image-to-video. |
| `--timeout <seconds>` | Maximum wait (default: 600 seconds). |
| `--host <host>`, `-H <host>` | Gateway host (default: `0.0.0.0`), exposed on all reachable network interfaces; use `--host 127.0.0.1` for local-only access. |
| `--port <port>`, `-p <port>` | Gateway port (default: `20128`). |
| `--api-key <key>` | 9Router API key; alternatively set `NINE_ROUTER_API_KEY`. |
| `--help`, `-h` | Show subcommand help. |

See the exact current option list with `9router xai video --help`.

---

## 📚 Documentation

Full docs, advanced setup, video tutorials & development guide:

- **GitHub**: https://github.com/decolua/9router
- **Full README**: https://github.com/decolua/9router/blob/master/README.md
- **Website**: https://9router.com

---

## 🙏 Acknowledgments

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** - Original Go implementation

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
