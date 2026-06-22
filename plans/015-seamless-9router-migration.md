# 015 — Seamless 9router → DurinDoor migration (100% back-compatible)

## Goal (user directive, 2026-06-22)
"100% back compatible — installing DurinDoor must **extract an old 9router installation and
replace it with ours without any problem**." A user who currently runs `9router` must be able to
`npm i -g durindoor` (or run the installer) and have everything keep working: data, config,
service, CLI command, tokens — zero manual steps, zero breakage.

This **supersedes the earlier "hard drop 9router" decision** for npm/bin: `9router` must KEEP
WORKING (as a redirect/alias) so old installs/habits keep functioning.

## PRIMARY entry point: `cli/hooks/postinstall.js`
Runs on `npm install -g durindoor` (and on local installs). It must call a single unified
**`migrateLegacy9router()`** helper so the migration happens at install time — NOT deferred to
runtime/service flows (a fresh install must extract/replace immediately, before the user runs
anything else). Runtime (`src/lib/dataDir.cjs`) and `service install` may call the SAME helper
(idempotent) as a safety net, but postinstall is the load-bearing trigger.

## The unified `migrateLegacy9router()` helper
Create ONE module (e.g. `cli/hooks/migrateLegacy.js` + reused from `src/lib`) invoked from
postinstall (and re-callable from service-install + runtime). Idempotent + non-destructive
(never delete old data; keep `~/.9router` for rollback). It must handle:

| Old artifact | Migration action |
|---|---|
| `~/.9router/` (data: db, config, runtime) | **Copy** to `~/.durindoor/` if absent (the `dataDir.cjs` logic already does this at runtime — postinstall must trigger it too). Keep `~/.9router` intact (rollback). |
| `~/.9router/runtime/` (sqlite/systray native deps) | Re-warm into `~/.durindoor/runtime/` (postinstall already warms runtime — repoint to durindoor + reuse old if present). |
| systemd `~/.config/systemd/user/9router.service` | **Detect**; if present, attempt uninstall (`systemctl --user stop/disable 9router`), then `durindoor service install` registers `durindoor.service`. If uninstall needs privileges, DETECT + emit a clear one-line instruction (don't silently leave a dangling unit). |
| launchd `com.9router.server.plist` + `com.9router.autostart` | Same: detect, unload (`launchctl unload`), then register the durindoor labels. |
| CLI auth token (`~/.9router/cli-token` or `~/.durindoor/cli-token`) | **Preserved** — `CLI_TOKEN_SALT` is UNCHANGED (already kept in 4B), so existing sessions survive the data-dir copy automatically. |
| Global npm `9router` package | Detect (`npm ls -g 9router`); if present, advise uninstall (`npm rm -g 9router`) after durindoor works — don't auto-remove (privilege/safety). |

## Back-compat READ layer (old keys/commands must keep working)
These are FUNCTIONAL contracts (not display text) — implement as back-compat reads, NOT renames:

| Old surface | Back-compat |
|---|---|
| `9router` CLI command | **Re-add `9router` bin** in `cli/package.json` → a thin redirect that execs `durindoor` (so `9router start` etc. still work post-upgrade). (Reverses the 4A "drop 9router bin".) |
| `[providers.9router]`, `[model_providers.9router]`, `custom:9Router-*`, `provider.9router`, `9router/<model>` (tool config keys) | ToolCard config **readers** must accept the OLD `9router` key as an alias for `durindoor` (read old → treat as configured). Writers may write `durindoor` going forward. Covers: Codex, Jcode, OpenClaw, OpenCode, Droid, Copilot ToolCards + their settings API routes. |
| `sk_9router` default dev API key | Server's default-key validation must **accept `sk_9router`** (and `sk_durindoor`) as valid localhost defaults — don't orphan existing localhost setups. |
| `status.has9Router` (internal backend→UI prop) | Internal to this app — keep emitting `has9Router` (no external consumer); renaming is cosmetic churn, SKIP unless coordinated. |
| `NINE_ROUTER_*` env vars | Already back-compat (DURINDOOR_* first, NINE_ROUTER_* fallback) — done in 4A. |

## Pure display-text wave (SEPARATE, safe, no contract change)
Only AFTER the migration layer: rename user-VISIBLE labels with no functional meaning — e.g.
"9Router Base URL" → "DurinDoor Base URL", "through 9Router" → "through DurinDoor",
"if 9router is deployed on a remote server" → "if DurinDoor is deployed…". Do NOT touch
generated config content (`model_provider = "9router"`, `name = "9Router"` inside written tool
configs) unless the back-compat read for that tool is in place.

## STOP / risks
- Never auto-delete `~/.9router` (rollback safety); never auto-`npm rm -g 9router` (privilege).
- Service uninstall from postinstall may lack privileges — detect + instruct, don't fail the install.
- Tool-config back-compat reads must be exhaustive (one missed reader = "not configured" false-negative for an upgraded user). Test each ToolCard's reader against an OLD `9router` config fixture.
- `9router` bin redirect must forward ALL args + exit codes, not just `start`.

## Validation
- `npm run build`; `npx vitest run tests/unit/cli-service.test.js tests/unit/dataDir-migration.test.js`; add `tests/unit/legacy-migration.test.js` (fixtures: old data dir + old service unit present → migration copies data, preserves token, flags unit); `npm run test:baseline` (32==32).
- Manual upgrade sim: pre-seed `~/.9router` + a `9router.service`, `npm i -g .`, run `9router start` (redirect works) + `durindoor service status` → data present, no dangling old unit.

## Status
⏳ NOT STARTED — design complete; implementation is the next wave. Supersedes 4A's "drop 9router bin" + 4B's "manual service reinstall".
