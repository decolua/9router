# FIX_CRASH_UBUNTU.md
## Root Cause Analysis & Remediation Plan for Silent Process Death on Ubuntu (Long-Running `bun run start`)

**Date**: 2026-05-21  
**Symptom**: `bun run start` (or equivalent direct Next.js/Bun server) runs for minutes to hours on Ubuntu, then the process terminates with **zero logs** written to `~/.9router/log.txt` (or any persistent crash log). The same workload runs stably for very long periods on macOS.  
**Reproduction Context**: Direct server start (bypassing the `9router` CLI wrapper), typical LLM proxy load (Cursor, Claude Code, Copilot, etc.), MITM + tunnels often enabled.

---

## 1. Executive Summary

The process dies **silently** due to a combination of:

1. **Missing error handling on privileged child processes** (highest probability for sudden death).
2. **Gradual memory growth** leading to Linux OOM killer (silent SIGKILL).
3. **File descriptor exhaustion** under sustained load on Linux default limits.
4. **Complete absence of application-level crash logging and global exception handlers**.
5. **Unbounded resource accumulation** in long-lived caches, DB tables, and stats queries.

The `~/.9router/log.txt` file is **dead code** (the writer function is a no-op). All crashes from uncaught exceptions, OOM kills, or child process errors leave no trace in the expected location.

Ubuntu is hit harder than macOS due to:
- Heavy `sudo` usage for MITM (port 443 + /etc/hosts) and daemons.
- Stricter default `ulimit` / resource limits in many sessions.
- More aggressive OOM killer behavior.
- Frequent network events triggering watchdog restarts (amplifies child process churn).

The CLI wrapper (`cli/cli.js`) provides partial mitigation (stderr buffering, limited restarts). Running via `bun run start` removes this safety net entirely.

---

## 2. Investigation Methodology

Six specialized read-only explorer subagents were spawned in parallel, plus manual tracing of critical paths:

| Subagent ID | Focus Area | Key Files Traced |
|-------------|------------|------------------|
| `019e493e-0515-...` | Memory leaks & unbounded growth | `open-sse/utils/proxyFetch.js`, `src/mitm/server.js`, `src/lib/db/repos/usageRepo.js`, caches |
| `019e493e-1a68-...` | Platform differences (Linux vs macOS) | All `process.platform`, sudo, child_process, signals, homedir logic |
| `019e493e-2bad-...` | Background tasks, timers, unhandled errors | `src/shared/services/initializeApp.js`, timers in open-sse, signal handlers |
| `019e493e-3b55-...` | FD / socket / connection leaks | `proxyFetch.js`, undici agents, fetch error paths, streams |
| `019e493e-55b1-...` | Child processes (MITM / tunnels) lifecycle & crash propagation | `src/mitm/manager.js`, `src/lib/tunnel/*`, `dns/dnsConfig.js` |
| `019e493e-4989-...` | DB growth, SQLite, crash logging | `src/lib/db/*`, `usageHistory` table, `getUsageStats`, error handlers, `log.txt` |

Additional manual reads: `src/server-init.js`, `src/proxy.js`, `open-sse/utils/*`, CLI spawn logic, schema, etc.

GitNexus MCP tools were unavailable (repo not indexed). All analysis used allowed tools + subagents.

---

## 3. Root Causes (Ranked for `bun run start` on Ubuntu)

### Primary (Sudden Death)
1. **Unhandled `'error'` events on ChildProcess / stdio streams** (Highest probability)
   - MITM `serverProcess` (`src/mitm/manager.js`): spawned via `sudo -S` on Linux. Only `"exit"` + data listeners. **No `.on("error")`**.
   - `execWithPassword` (DNS/hosts edits during every restart): same problem.
   - `tailscaled` daemon spawns: bare `spawn` + `.unref()`, **zero listeners**.
   - Consequence: any pipe error, EPIPE, late spawn failure → uncaughtException → process termination.
   - Amplified by watchdog (60s) + networkMonitor (5s) causing repeated restarts on Ubuntu network events.

2. **Complete lack of global crash handlers in the main server path**
   - No `uncaughtException` or `unhandledRejection` anywhere in `server-init.js` / `initializeApp.js`.
   - CLI wrapper has a partial one (shutdown-only). Direct `bun run start` has none.

### Secondary (Death After Time)
3. **Memory growth → Linux OOM killer**
   - `DNS_CACHE` (Map) in `open-sse/utils/proxyFetch.js:8` — never pruned (only TTL on read).
   - MITM `certCache` + `cachedTargetIPs`.
   - `vertexTokenCache`, `catalogCache`, `comboRotationState`, etc.
   - `requestDetailsRepo` `writeBuffer` (no in-memory cap).
   - `getUsageStats()` for long periods: loads/parses large portions of `usageHistory` + daily JSON blobs into huge JS objects.

4. **File descriptor exhaustion (EMFILE)**
   - `proxyDispatchers` (undici `ProxyAgent`): never `.close()` / `.destroy()`.
   - `createBypassRequest` sockets not reliably destroyed.
   - Widespread failure to consume/destroy `fetch` response bodies on `!ok` / error paths across executors, OAuth, usage, etc.
   - Linux default `ulimit -n` (often 1024) vs macOS effective limits.

5. **DB table growth + dangerous queries**
   - `usageHistory` has **zero pruning** (unlike capped `requestDetails`).
   - Long-period stats queries become memory + event-loop bombs after hours of logging.

### Contributing Factors
- Some top-level `setInterval` callbacks lack `try/catch` (e.g., `sessionManager.js`, `codex.js` executor).
- Multiple overlapping `process.exit(0)` in DB adapters + signal handlers.
- `bun run start` bypasses all CLI safety nets (crashLog capture, restart logic, partial uncaught handler).
- `~/.9router/log.txt` is completely dead code.

---

## 4. Detailed Gap Analysis

### 4.1 Child Process & Daemon Handling (Critical)
- `src/mitm/manager.js:640+`: `serverProcess` only has `"exit"` + data. No error handling on the sudo-spawned privileged child.
- `src/mitm/dns/dnsConfig.js`: `execWithPassword` — only data/close.
- `src/lib/tunnel/tailscale.js`: daemon spawns have zero listeners.
- `src/lib/tunnel/cloudflared.js` and MCP bridge: partial coverage.
- No systematic cleanup of stdio pipes on `kill()` paths.

### 4.2 Memory & Caches
- `open-sse/utils/proxyFetch.js`: `DNS_CACHE` (unbounded), `proxyDispatchers` (capped at 20 but never closed).
- `src/mitm/server.js`: `certCache` (Map), `cachedTargetIPs` (object) — no eviction.
- Multiple service caches with "check expiry, never delete" pattern.
- `src/lib/db/repos/requestDetailsRepo.js`: `writeBuffer` grows on flush errors.
- `src/lib/db/repos/usageRepo.js`: `getUsageStats` builds massive aggregation objects for long periods.

### 4.3 File Descriptors & Streams
- Global `fetch` patch in `proxyFetch.js` routes everything through potentially leaky paths.
- Many `!ok` early returns across `open-sse/executors/*`, `src/lib/oauth/services/*`, `src/lib/usage/fetcher.js` — bodies left unconsumed.
- No `AbortSignal` support in MITM DNS bypass socket path.

### 4.4 Timers & Background Tasks
- Good: Most server timers use `.unref()` + inner catches (watchdog, networkMonitor, DB checkpoints).
- Bad: `open-sse/utils/sessionManager.js` and `open-sse/executors/codex.js` top-level intervals lack try/catch.
- Recursive MITM health/restart scheduling has escape paths.
- No top-level safety net.

### 4.5 Database & Logging
- `usageHistory`: unbounded growth, full-table scans in stats queries.
- `appendRequestLog()` is a no-op. `log.txt` is never written.
- No persistent crash log anywhere.
- sql.js fallback loads entire DB into RAM (dangerous once history grows).
- Many forced `process.exit(0)` in adapters on signals.

### 4.6 Platform & Lifecycle
- Sudo-heavy paths only on Linux (MITM, tailscaled TUN mode, DNS edits).
- No SIGHUP handler in main server path (Linux terminal/session kills are clean).
- CLI has darwin-gated SIGHUP ignore in tray mode; Linux autostart paths are weaker.
- `bun run start` removes the only wrapper that does stderr capture + limited restarts.

---

## 5. Why macOS Is Stable While Ubuntu Dies

- macOS users more commonly use the `9router` CLI + tray (partial protections).
- Higher effective file descriptor limits in practice.
- Different elevation model (less frequent sudo child churn).
- macOS memory pressure handling + user hardware often more forgiving than Linux OOM killer.
- Fewer network flaps triggering the watchdog restart loops that exercise the fragile child paths.

---

## 6. Recommended Fix Strategy: "1 Phase — Ultrathink"

**Philosophy**: One coordinated, safe phase that delivers **maximum diagnostic + survival improvement** with **minimum blast radius**.

Priorities (in order):
1. **Visibility first** — make every future death produce a useful artifact.
2. **Stop the most common sudden-death vector** — child process error events.
3. **Defensive resource hygiene** — stop unbounded growth.
4. **DB safety** — prevent the stats-query memory bomb.
5. **Platform hardening** — reduce Linux-specific exposure.

All code changes **must** follow project rules:
- Run `gitnexus_impact({target: "symbol", direction: "upstream"})` **before** editing any function/class/method.
- Warn user on HIGH/CRITICAL risk.
- Run `gitnexus_detect_changes()` before any commit.
- Prefer `gitnexus_rename` / `gitnexus_query` / `gitnexus_context` where applicable.
- No blind find-and-replace.

---

## 7. Detailed TODO / Checklist (1 Phase — Ultrathink)

### Phase 0: Preparation (Do This First — No Code Changes)
- [ ] Refresh GitNexus index: `bunx gitnexus analyze` (or `npx gitnexus analyze --force`).
- [ ] Verify current index freshness via `gitnexus://repo/9router/context`.
- [ ] Create a reproduction harness (simple load script + RSS/fd watcher + long-period stats trigger).
- [ ] On a test Ubuntu machine, reproduce the crash while capturing:
  - `dmesg | grep -i "killed\|oom"`
  - `journalctl -u <service>` (if systemd)
  - `ulimit -a` of the process
  - `ls -l ~/.9router/` before/after
- [ ] Run `gitnexus_query({query: "child process error handling"})` and `gitnexus_context({name: "startMitm"})` etc. for key symbols.

### Phase 1: Visibility & Last-Resort Safety Net (Highest ROI, Lowest Risk)
**Goal**: Every crash produces a timestamped stack + context in `~/.9router/crash.log`.

- [ ] **Add global crash logger** (new file or in `src/lib/` or `src/server-init.js`).
  - `process.on('uncaughtException', ...)` — write full stack + `process.memoryUsage()`, open fd estimate if possible, recent consoleLogBuffer, active requests.
  - `process.on('unhandledRejection', ...)` — same.
  - Write atomically to `~/.9router/crash.log` (append with timestamp + PID).
  - Also log to stderr (for the case when the process is run in foreground).
  - **Before editing**: Run `gitnexus_impact` on the insertion point (likely `server-init.js` or a new `src/lib/crashLogger.js`).
- [ ] Hook the logger into `initializeApp.js` early (after `process.setMaxListeners`).
- [ ] Add a simple `process.on('exit', ...)` that flushes any pending DB writes if possible.
- [ ] Update `cli/cli.js` to also use the same crash logger for the child server (unify behavior).
- [ ] Test: deliberately throw in a timer and in a child error path → verify `crash.log` is written with useful data.

### Phase 2: Child Process Error Handling (Stop the #1 Sudden Death Vector)
- [ ] **MITM `serverProcess`** (`src/mitm/manager.js`):
  - Add `.on('error', (err) => { logCrashOrSafe(err, {context: 'mitm-serverProcess'}) })`.
  - Add error listeners to `stdout` / `stderr` streams.
  - **Must run `gitnexus_impact({target: "startMitm" or relevant spawn function, direction: "upstream"})`** first. Report callers (API routes, autoStart, watchdog).
- [ ] **`execWithPassword`** in `src/mitm/dns/dnsConfig.js`:
  - Add error listener on the sudo child.
  - **Impact analysis required** — this function is called from many DNS/hosts paths.
- [ ] Tailscaled daemon spawns (`src/lib/tunnel/tailscale.js`):
  - At minimum attach `.on('error', ...)` even if we intentionally let the daemon be detached.
- [ ] Cloudflared and MCP bridge: audit and add missing stream error listeners.
- [ ] Create a small utility `createSafeChild(spawnArgs)` that always wires error + exit + stream error handlers.
- [ ] Update all existing long-lived spawns to use the safe wrapper (or at least document the ones that must remain bare).

### Phase 3: Resource Caps & Defensive Hygiene (Memory + FD)
- [ ] **DNS_CACHE** (`open-sse/utils/proxyFetch.js`):
  - Add periodic sweep (every 10–15 min) that deletes entries past a hard TTL (e.g. 30–60 min) or cap size at 500–1000.
  - Or switch to a proper LRU with TTL.
  - **Impact**: Called from the global fetch patch — very hot path. Run full impact analysis.
- [ ] MITM certCache + cachedTargetIPs: add size cap + TTL sweep (similar to sessionManager pattern).
- [ ] Other service caches (`vertexTokenCache`, `catalogCache`, `comboRotationState`): add defensive eviction.
- [ ] `requestDetailsRepo.js` `writeBuffer`: add hard max length (e.g. 1000). Drop oldest on overflow with a warning.
- [ ] `proxyDispatchers`: ensure `.close()` / `.destroy()` is called on eviction and on process shutdown.
- [ ] Add best-effort response body draining helper (`safeConsumeResponse(res)`) and apply it to the worst 10–15 `!ok` early-return sites in executors + OAuth + usage fetcher.
- [ ] Consider exposing `process.env.MAX_DNS_CACHE_SIZE` etc. for emergency tuning.

### Phase 4: Database Safety (Prevent the Stats Bomb)
- [ ] Add automatic pruning of old `usageHistory` rows (e.g. DELETE WHERE timestamp < 90 days, run on startup + weekly via a timer).
  - Keep `usageDaily` aggregates (they are small).
  - **Impact analysis** on `saveRequestUsage` and migration paths.
- [ ] Bound the dangerous queries in `getUsageStats()`:
  - For "all" period, force use of daily aggregates only + a small recent raw overlay.
  - Add hard row limits + warnings when the overlay would be huge.
- [ ] Fix the bug in `getRecentLogs()` (uses `getAdapter()` without await).
- [ ] Add a UI/settings toggle + API to manually "clear usage history older than X days".
- [ ] Consider a weekly `db.pragma("optimize")` or light VACUUM.

### Phase 5: Platform Hardening & Lifecycle
- [ ] Add a SIGHUP handler in the main server path (at minimum: log + graceful cleanup of DNS entries + cloudflared; do **not** exit by default).
- [ ] Improve shutdown coordination between `initializeApp`, DB adapters, MITM, and requestDetails (reduce multiple `process.exit(0)` races).
- [ ] In CLI `cleanup()`, also try to flush the new crash logger.
- [ ] Add Linux-specific warning at startup if `ulimit -n` < 4096 (suggest raising it).
- [ ] Document that long-running production use should prefer the `9router` CLI + `--tray` or systemd service with proper limits.

### Phase 6: Verification & Hardening
- [ ] Add a simple integration test that spawns the server, triggers a fake child error, and asserts a crash log line appears.
- [ ] Add a test that exercises a long-period stats query after seeding many usage rows and asserts it does not explode memory.
- [ ] Run full GitNexus `gitnexus_detect_changes()` before any PR.
- [ ] Update docs (ARCHITECTURE.md, READMEs) to remove references to the dead `log.txt` and point to the new `crash.log`.
- [ ] Consider adding a lightweight in-process health endpoint that reports cache sizes, fd estimate, and last crash time.

### Ongoing / Nice to Have (Phase 2+)
- Centralized safe child factory.
- Runtime memory watchdog that logs warnings at 70/85/95% of a configured limit.
- Prometheus-style metrics export (cache sizes, child process health, DB row counts).
- Automated leak detection in CI under sustained load.

---

## 8. Success Criteria

After the 1-phase fix:

- Every process death (uncaught, child error, OOM pressure) produces a useful `~/.9router/crash.log` entry with stack + context.
- The most common sudden-death vector (MITM + sudo child errors) is handled gracefully instead of killing the parent.
- Key caches have hard caps or regular eviction.
- Long-period usage stats no longer risk OOM or multi-second event-loop blocks.
- `bun run start` on Ubuntu survives 24–48h of realistic LLM proxy load without silent death (or at least always leaves a breadcrumb).

---

## 9. Notes for Implementers

- **Never** edit any symbol without first running the required GitNexus impact command and reporting the blast radius to reviewers.
- Start with the visibility changes (Phase 1) — they are the safest and give immediate diagnostic value even if other phases are delayed.
- The CLI wrapper should eventually consume the same crash logger so behavior is consistent whether the user runs the CLI or `bun run start`.
- This document itself should be kept up to date as fixes are implemented.

---

**End of Analysis Document**

This file was generated from six parallel subagent investigations + manual code tracing performed on 2026-05-21. All raw subagent outputs are preserved in the conversation history for auditability.

---

## Phase 5 Progress: Platform Hardening & Lifecycle (Updated)

### Completed in Phase 5
- Added graceful **SIGHUP handler** in the main server process (`initializeApp`). Performs DNS + cloudflared cleanup but **does not** force exit (important for Linux terminal close / ssh disconnect scenarios).
- Added startup **Linux `ulimit -n` warning** when file descriptor limit is dangerously low.
- Introduced **Shutdown Coordinator** (`src/lib/shutdownCoordinator.js`):
  - Priority-based cleanup registration.
  - Sequential execution with per-handler timeouts and isolation.
  - First integration point wired into `initializeApp`.
- Updated CLI `cleanup()` with best-effort crash logger flush on shutdown.

### Recommended Long-Running Practices (Ubuntu/Linux)

**1. Prefer the Official CLI**
- Use `9router --tray` or a proper systemd service instead of raw `bun run start`.
- The CLI has better signal handling, auto-restart logic, and crash reporting.

**2. File Descriptor Limits (Very Important)**
- Default limits on Ubuntu are often too low for long-running proxies.
- Recommended: `LimitNOFILE=65536` in systemd unit, or `ulimit -n 65536`.

**3. Signal Handling**
- SIGHUP is now handled gracefully (no forced exit).
- Prefer SIGTERM for clean shutdowns.

**4. Monitoring & Observability**
- Regularly check `~/.9router/crash.log`.
- Monitor RSS memory and open file descriptors of the process.

**5. Production Deployment Recommendation**
- Wrap the `9router` CLI in systemd or Docker with proper resource limits.
- The combination of crash logging + Shutdown Coordinator + SIGHUP handling significantly reduces silent death risk on long-running Ubuntu instances.

These improvements, combined with earlier phases (child error handling, resource caps, DB pruning), make 9router much more robust for 24/7 operation on Linux.