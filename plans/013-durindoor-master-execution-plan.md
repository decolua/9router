# 013 — DurinDoor Master Execution Plan (autonomous, never-stop)

## Status

ACTIVE — controlling master plan. Supersedes the status column of `plans/README.md` (which is stale). Drive the entire autonomous run from this document. Git log on `dev` is the single source of truth for what is done; update this file's status tables as slices close.

## Goal

Drive the 9Router fork (`bloodf/9router`) to production-grade quality and rebrand it into **DurinDoor**, then complete strict TypeScript migration and LoggerJS observability. The run is **fully autonomous and never stops** until Phases 0–6 all reach acceptance, `dev` is green, and nothing in the STOP conditions remains open. Pi is NOT available — use native OMP worktrees + subagents + advisor/review/QA gates.

## Repo contract

- Repo: `~/Developer/github.com/bloodf/9router`
- Branch: `dev` — push ONLY to `origin/dev`. NEVER push upstream (`decolua/9router`).
- Worktrees root: `~/Developer/github.com/bloodf/9router-agent-worktrees`
- Handoff HEAD: `ff5fc5f` "fix: restrict mcp key creation to local requests"
- Speak to the user only in English.

## Ground-truth status (verified at `ff5fc5f`, 2026-06-22)

`plans/README.md` marks 001–010 all `TODO`. Wrong — and worse: a bulk integration **`a04c103` ("feat: execute 10 improvement plans") + `5df5814`** already landed plans 001–008, 010, translator-parity, endpoint-contracts, resilience, and the lint-fatal gate. Both are confirmed ancestors of `ff5fc5f`. Per-plan commits (`5d3a901`, `66c36dc`, `ff5fc5f`, `c00881d`) are later refinements on top.

Legend: ✅ DONE (validated passing) · 🟡 LANDED (in dev by ancestry/file-existence, **NOT yet re-validated**) · ⏳ OPEN.

| Work | Status | Evidence / note |
|---|---|---|
| 001 exclude `.worktrees/` | ✅ DONE | sweep ran clean; vitest excludes worktrees |
| 002 SSRF headroom probe | ✅ DONE | `headroom-ssrf-guard.test.js` → 16 PASS |
| 003 restrict MCP key reveal | 🟡 LANDED | `ff5fc5f`; no dedicated focused test run yet |
| 004 bound roundrobin cursor map | ✅ DONE | `modelFallback.test.js` → 31 PASS |
| 005 stale `open-sse/AGENTS.md` | 🟡 LANDED | doc only |
| 006 **reorder** connection filter | 🟡 LANDED | `a04c103` reorder; no standalone test |
| 006 **extraction** (connectionFilter module) | ⏳ OPEN | wave013 staged module+test; STILL inline in `page.js` (**13+ call sites**). **NOT zero-risk**: parity delta (`errorTime` `""` vs inline `null`) + 2-arg→3-arg signature change → real refactor (see advisor findings) |
| 007 localDb shim sync test | ✅ DONE | `localdb-shim-sync.test.js` → 2 PASS |
| 008 tests for new routes | ✅ DONE | `reauth-route`(4)+`usage-quota-lock`(10)+`v1-models-codex-caps`(2) PASS |
| 009 CI workflow | 🟡 LANDED | `.github/workflows/ci.yml` present |
| 010 refactor usage route | ✅ DONE | `usage-quota-lock.test.js` → 10 PASS covers it |
| Translator parity (pa01) | ✅ DONE | `tests/translator/parity/` → 31 PASS |
| Endpoint contracts (pa03) | ✅ DONE | 3 `public-endpoints-*` → 27 PASS |
| Resilience suite (st04) | ✅ DONE | `stream-disconnect-controller`(15)+`stream-stall-watchdog`(7) PASS |
| Lint-fatal gate (ch01) | 🟡 CONTRACT-BUG | script never emits `"PASS"`; 2 tests fail on output-string contract (pre-existing from `5df5814`) → Phase-2.4 fix |
| MCP-02 retry lifecycle | 🟡 LANDED | `5243021`; no focused test run yet |
| 011 upstream/TS/LoggerJS | 🗺 ROADMAP | Phases 0–6 of this plan |
| 012 DurinDoor rebrand | 🗺 ROADMAP | Phase 0 inventory done (`983bf35`) |

**Implication:** nearly all of old Phase 2 "production hardening" already LANDED. Real open work is far smaller: 006-extraction, the #1576 test, the scout v0.5.7/v0.6.0 items, CH-02 lint burn-down, dep hygiene, UI-01 — plus whatever the Phase-0 validation sweep surfaces from the 🟡 rows.

**Worktree inventory (post-Phase-0.3):** 15 stale worktrees REMOVED (work integrated in dev); `wave014-roundrobin-bound` was mislabeled cursor pollution (discarded). LIVE = `wave013-filter-reorder` (T1.1) + `wave014-up1576-connection-test` (T1.2) only. `git worktree prune` done; stale `work/*` branches retained (harmless).

**Working tree:** the 16-file "drift" was **Prettier line-reflow** (spaces→tabs + arg/block wrapping), NOT pure whitespace — `diff -w` still showed +1372/−434, and `prettier --check` REJECTS it (stray editor formatting, not canonical). STASHED as `phase0-stray-drift-backup` (recoverable); tree restored to HEAD. Do NOT re-commit it.

### REBRAND DECISIONS — RESOLVED (user, 2026-06-22)
Direction = **hard rename to `durindoor`** (clean cutover, back-compat only where data-loss is at stake):
- **npm package**: rename to `durindoor` (DROP `9router`) — no alias package; migration docs must warn existing `9router` importers.
- **CLI command**: `durindoor` (full name).
- **Domain**: DEFER (none yet) — do NOT block the code rebrand on domain registration; revisit when ready.
- **Data dir**: `~/.durindoor` new default + **read `~/.9router` back-compat** (auto-detect + migrate/read) — zero data loss.
- **Docker image**: rename to `durindoor`.
Implication for Phase 4: rename npm/bin/Docker/env-vars/data-dir to `durindoor`; keep a `.9router` data-dir read-path for back-compat; NO `9router` npm alias; domain work deferred.

### SCHEDULE RISK (read before committing to "days")
Codebase is **928 JS files / ~120K LOC** (src + open-sse). Strict TypeScript with **no `any`/no `unknown`** across 120K LOC is the dominant cost of the whole roadmap — realistically a long horizon of wave-batched per-module conversion, not days. The autonomous loop will run it, but Phase 5 should be expected to dwarf Phases 0–4 combined. Plan accordingly; do not let "never stop until 100%" pressure rush the no-`any` boundary design.

## Model → actor mapping (CONFIRM BEFORE RUN)

**Active fleet — 6 models:** Anthropic **Opus 4.8** · OpenAI **GPT-5.5** · MiniMax **M3** · MiniMax **M2.7 HighSpeed** · Moonshot **K2.7** · Z.AI **GLM-5.2**. Every model has a home; no model is overloaded (max 2 roles each).

Cross-family review rule: **the model family that IMPLEMENTS a slice must NOT review / QA / security-check that same slice.** The two coders (K2.7, GLM-5.2) peer-review each other; QA / Security are pinned to NON-coder models so they are always cross-family to whichever coder implemented.

### Fixed roles

| Actor / Role | Model | Notes |
|---|---|---|
| Strategic Advisor / Architect / Planner | **Opus 4.8** | before every wave / large integration / security-sensitive / phase change |
| Scout / find-files | **MiniMax M2.7 HighSpeed** | read-only, no edits |
| Implementation (coder) | **K2.7** & **GLM-5.2** | rotate between the two |
| Reviewer (per slice) | the OTHER coder | fresh context (matches "review K2.7 with GLM-5.2") |
| QA | **GPT-5.5** | verify evidence, rerun focused tests |
| Security Reviewer | **MiniMax M3** | SSRF / secrets / auth / MCP keys / transports / logging / proxy |
| Docs / Rebrand Writer | **GPT-5.5** | preserve technical accuracy + IP-safe branding |

### Per-slice assignment (chosen by which coder implements)

| Implementer | Reviewer | QA | Security |
|---|---|---|---|
| **K2.7** | **GLM-5.2** | **GPT-5.5** | **MiniMax M3** |
| **GLM-5.2** | **K2.7** | **GPT-5.5** | **MiniMax M3** |

Cross-family check: K2.7 row → GLM / GPT / M3 (none = K2.7 ✓, all distinct ✓); GLM-5.2 row → K2.7 / GPT / M3 (none = GLM ✓, all distinct ✓). Load spread: Opus=Advisor, M2.7=Scout, K2.7=coder+review, GLM-5.2=coder+review, GPT-5.5=QA+Docs, M3=Security. All six used; no model carries more than 2 roles.

### Quota / fallback

- On quota/token-window failure: record model/role/error/timestamp; retry same role every 30 min up to 7 h while independent work continues.
- If the assigned Reviewer coder is down: the other coder implements, **MiniMax M3 takes Review** (non-coder, always cross-family), and Security spills to **Opus 4.8**.
- All six models are active; none is held in reserve. No fallback outside the fleet is authorized without an explicit recorded note.

### Operational caveats (from prior sessions)

- **GLM-5.2** in OMP tends to try dispatching subagents and fail with "Unable to connect." Run all GLM-5.2 roles **no-tools, json-mode**.
- **OMP CLI**: use **json-mode**, never print-mode (`-p`) — print-mode silently returns 0 bytes for long prompts.
- Deviation note: the original handoff named GLM-5.2 for Security, but GLM-5.2 is a coder and cannot security-check its own slices; Security is pinned to **MiniMax M3** (non-coder) for cross-family consistency. If you prefer, GLM-5.2 may take Security on K2.7-implemented slices (still cross-family) — say so to override.

## Locked phase order (violating it = STOP)

```
0 drift+reconcile → 1 handoff leftovers → 2 production hardening → 3 upstream sync → 4 DurinDoor rebrand → 5 strict TypeScript → 6 LoggerJS
```
Phases 5 and 6 are HARD-GATED: no TypeScript until 1–4 stable; no LoggerJS until TypeScript complete.

---

## Phase 0 — Baseline, cleanup, VALIDATION SWEEP (FIRST orchestration actions)

0.1 **Drift triage — restore, don't pollute:** the 16-file drift was **Prettier line-reflow** (spaces→tabs + arg/block wrapping), NOT pure whitespace — `diff -w` showed +1372/−434 and `prettier --check` REJECTS it. RESTORED (stashed as `phase0-stray-drift-backup`, recoverable); do NOT checkpoint-pollute. If any file later proves to hold real intended changes, recover from the stash and commit it as its own focused checkpoint.
0.2 **Repo hygiene:** add `.pi/` + `.atl/` to `.gitignore`; commit `plans/013-*` + `plans/README.md` + `.gitignore` as `docs: add DurinDoor master execution plan + repo hygiene`.
0.3 **Worktree cleanup — all 18 are stale (confirmed integrated):** remove `pa01`/`pa03`/`st04`/`ch01`, `issue1927…1956`, `mcp01-stdio-init`, `st03-stream-terminals`, `wave014-roundrobin-bound` (mislabeled cursor pollution), `wave014-stub-disposition-scout` (report read), `wave014-up1576-connection-test` (after T1.2 consumes it), `.worktrees/omniroute-port`. **KEEP only `wave013-filter-reorder` (T1.1).** `git worktree prune`.
0.4 **VALIDATION SWEEP — confirm 🟡 rows still PASS (advisory: separate "landed" from "validated"):** run focused tests for every LANDED plan:
    `npx vitest run tests/unit/localdb-shim-sync.test.js tests/unit/headroom-ssrf-guard.test.js tests/unit/modelFallback.test.js tests/unit/reauth-route.test.js tests/unit/usage-quota-lock.test.js tests/unit/v1-models-codex-caps.test.js tests/unit/lint-fatal-diff.test.js tests/unit/public-endpoints-error-envelope.test.js tests/unit/public-endpoints-format-parity.test.js tests/unit/public-endpoints-stream-nonstream.test.js tests/unit/stream-disconnect-controller.test.js tests/unit/stream-stall-watchdog.test.js tests/translator/parity/`
    (Do NOT include `tests/lib/providers/connectionFilter.test.js` — it does not exist in dev until T1.1 integrates it.) Record pass/fail per file; promote 🟡→✅ for green; convert every red into a Phase-2 fix task.
0.5 **Re-baseline:** `npm run test:baseline`; refresh `tests/__baseline__/known-fails.txt`. Define "green" = no NEW regressions, NOT zero failures.
0.6 ADVISOR GATE (Opus 4.8) before Phase 1.

Acceptance: `git status --short` clean; `git worktree list` = main + active Phase-1 worktrees only (`wave013` consumed by T1.1; `wave014-up1576` consumed + removed by T1.2 — `71e067f`); validation sweep recorded (12 pass / 1 known lint-fatal contract-bug); ADVISOR CLEARED.

---

## Phase 1 — Finish handoff leftovers (in order)

| # | Slice | Files | Gate | Commit |
|---|---|---|---|---|
| 1.1 | Integrate connection-filter **extraction** (006-extraction) — ready | `src/lib/providers/connectionFilter.js`, `tests/lib/providers/connectionFilter.test.js` (from wave013) | ADVISOR → integrate → `npx vitest run tests/lib/providers/connectionFilter.test.js && npm run lint:fatal` | `refactor: extract provider connection filter helpers` |
| 1.2 | PR #1576 connection-test parity — re-review, test-only | integrate ONLY `tests/unit/provider-connection-test.test.js`; discard snapshot/`EVIDENCE.md`/`IMPLEMENTATION_SUMMARY.md` unless reviewer justifies | fresh Review (≠ impl) + QA | `test: cover provider connection test parity` |
| 1.3 | Stub-disposition scout items → child slices (`CH-05-stub-disposition-report.md`) | per slice | per-slice gates | per slice |

**REMOVED:** ~~roundrobin-bound (004)~~ — plan 004 (roundrobin cursor bound) already LANDED in `a04c103` (markers live in `modelFallback.js`); the `wave014-roundrobin-bound` worktree was mislabeled cursor-auto-import whitespace pollution, discarded in Phase 0.3.

**1.3 children (scout v0.5.7 / v0.6.0):** (A) AutoCombo `classifyTier` tier resolver — IMPLEMENT (low): `open-sse/services/autoCombo/scoring.js` + new `tierResolver.js` + `tests/unit/autoCombo-tierResolver.test.js`. (D) Windows service **Option B** — improved error msgs + new `docs/service-windows.md` (low). (E) DefaultToolCard "Coming soon" → helpful text + docs link (low). (B) ComfyUI — HIDE + `experimentalProviders` flag (v0.6.0). (C) Cursor MITM 501 — 🛑 STOP (legal/demand).

---

## Phase 2 — Remaining production hardening (parallel, disjoint worktrees)

Most hardening already LANDED (010, PA-03, ST-04, MCP-02 — see ground-truth). What remains:

| # | Slice | Source | Risk |
|---|---|---|---|
| 2.1 | CH-02 React hooks lint burn-down (esp. cli-tools components; fold in upstream #1362 if adopted in Phase 3) | 011 Phase 3 | MED |
| 2.2 | Remaining UI token/theme batches (coordinate with Phase 4 retheme) | 011 Phase 3 (UI-01) | LOW |
| 2.3 | Dependency hygiene (DEP-01/02) — ONLY after Phase-0 re-baseline strategy is clear | 011 Phase 3 | MED |
| 2.4 | **Fixes surfaced by Phase-0 validation sweep** — any 🟡 test that fails → triage + fix (parity/resilience gaps become concrete tasks here) | sweep | varies |

Already LANDED (not re-listed): 010 usage refactor · PA-03 endpoint contracts · ST-04 resilience · MCP-02 retry · scout A/D/E/B (moved to Phase 1.3).

---

## Phase 3 — Upstream sync (manual cherry-picks, NEVER full merge)

Per `011` Phases 1–2: feature-area diff vs `upstream` (`decolua/9router`), not raw file count. Latest-10 PR candidates already collected (`#1576, #1536, #1437, #1428, #1366, #1362, #1361, #1360, #1354, #1310`). Per PR: inspect → classify already-present / conflicting / obsolete / needed → manual port into isolated worktree → add tests → fresh Review (≠ impl) + QA. MIMO-free UA rotation already ported (`df961e6`). Scout older/newer commits only if valuable.

---

## Phase 4 — DurinDoor rebrand (IP-safe, original assets)

Per `012` theme + `012-brand-inventory.md` (~1,500 refs, 200+ files, 5 languages). Inventory (Phase 0) done. Ordered slices (each < ~400 lines):

1. `docs/BRAND.md` — brand system (obsidian/charcoal + moon-silver + mithril blue-gray + forged-gold; original stone-arch geometry; NO official LOTR assets), contrast/accessibility targets, backward-compat rules.
2. README/docs rewrite (English → `zh-CN`, `i18n/README.*`).
3. Landing/login metadata + favicon/logo (original SVG → `icon-192/512`).
4. Theme tokens (`globals.css`) + shared primitives.
5. Dashboard shell/sidebar, then page batches coordinated with Phase 2 UI-01.
6. **Hard rename + migration/break-notice** (per RESOLVED decisions — NO npm `9router` alias): npm package/bin → `durindoor`; Docker image → `durindoor`; env vars → `DURINDOOR_*` (read `9ROUTER_*` back-compat); data dir → `~/.durindoor` with **auto-detect + read `~/.9router` back-compat** (zero data loss). MUST ship explicit migration so existing users are NOT silently broken: `9router`→`durindoor` upgrade guide, README deprecation banner, and (if feasible) a stub `9router` CLI/command that prints a redirect notice. Domain deferred.
7. Final stale-name sweep + visual QA.
8. GitBook (100 files, 5 languages) — post-launch batch.

**STOP** if official LOTR assets requested, or rename breaks API/env/package compat without migration shim.

---

## Phase 5 — Strict TypeScript migration (DO NOT START until 1–4 stable)

Per `011` Phases 4–5. Strict policy: `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`. **No `any`, no explicit `unknown`** in production — boundary parsers for untrusted input; discriminated unions for provider formats / stream events / MCP JSON-RPC / executor results / error envelopes; branded types for IDs; generics only where they preserve real relationships. Convert order: TS config + protocol types → translator schemas/helpers → translators → executors/stream/resilience → MCP gateway → DB/services → API routes → UI → fatal typecheck → remove JS shims. Gate: `grep -R "\bany\b\|\bunknown\b"` returns zero production hits; `npm run typecheck` passes strict.

---

## Phase 6 — LoggerJS observability (DO NOT START until Phase 5 complete)

Per `011` Phase 6: typed logging domain model → minimal LoggerJS packages first (`@loggerjs/node|browser|processors`), vendor packages only when configured → server logger with strong redaction (API keys/bearer/cookies/OAuth/provider creds/MCP keys/proxy creds/prompts) → opt-in browser logger (no body capture by default) → `/dashboard/log-watchers` UI → phased transport matrix (6A local → 6B operator → 6C specialized) → collector endpoints only after threat model → tests for config/redaction/CRUD/transport. **STOP** on credential leakage, unaudited outbound delivery, prompt capture by default, or unbounded storage.

---

## Operating model — wave-based maximal parallel fan-out

Run in WAVES, never one slice at a time. The objective is maximum concurrency: as many disjoint slices in flight at once as possible, so the project finishes in days, not weeks.

### Wave lifecycle (repeat until Phase 6 acceptance)

1. **PLAN THE WAVE** — ADVISOR (Opus 4.8) + Scout (MiniMax M2.7 HighSpeed) inventory every pending slice, map each to its exact file scope, and partition into the **maximal set of mutually disjoint slices**. Disjoint = no two slices touch the same file.
2. **ADVISOR GATE the wave** — scope safe? worktrees disjoint? risks? validations? → CLEARED / FLAGGED. Resolve FLAGGEDs before dispatch.
3. **DISPATCH the whole wave in ONE `tasks[]` batch** — one subagent per slice, each in its own isolated worktree under `9router-agent-worktrees/`, explicit non-overlapping file scope, no commit/push from the worktree. Assign the two coders (K2.7 / GLM-5.2) round-robin across slices so BOTH coders run concurrently.
4. **PIPELINE cross-family review** — the moment a slice's implementation lands, route it to Reviewer (the OTHER coder) + QA (GPT-5.5) + Security (MiniMax M3, if security-sensitive). Because Review is always the *other* coder, the two coders naturally swap between implementing and reviewing — keep both pipelines full.
5. **INTEGRATE per-slice as each clears CLEAN+PASS** — do NOT wait for the whole wave. Commit drift separately; copy scoped files; validate on `dev`; commit; push `origin/dev`; remove worktree. Land each clean slice immediately.
6. **STATUS REPORT** after each integration and at wave end, then immediately PLAN + DISPATCH the next wave (never idle).

### Parallelization rules (hard)

- Every parallel writer gets an **isolated git worktree** + an **exclusive file scope**. No shared-file writes from two agents in the same wave.
- **Maximize batch width**: if N slices are mutually disjoint, dispatch N agents in one `tasks[]` call. Width is bounded by disjoint scopes and model availability — NOT by caution.
- New-file-only slices are always safe to parallelize (zero collision risk).
- Shared-file contention (two slices both needing `package.json`, a barrel `index.js`, shared constants, or `oauth-constants`): serialize those specific slices across waves; keep everything else parallel.
- Cross-family invariant is non-negotiable: a slice's Reviewer/QA/Security are always a different family from its implementer.

### First wave (on "it works", after Phase 0 + ADVISOR GATE)

**ADVISOR GATE (Opus 4.8) = FLAGGED → resolved before dispatch:**
- T1.1 is NOT "zero-risk direct integrate": extracted `connectionFilter.js` has a **parity delta** (`errorTime` `""` vs inline `null`) and a **2-arg→3-arg signature change** forcing 13+ call-site rewires in `providers/page.js`. Treat as a real refactor.
- ~~`1.3 roundrobin-bound`~~ REMOVED (004 LANDED+validated). ~~`2.1 010 usage-route refactor`~~ REMOVED (010 LANDED+validated). Do NOT re-dispatch landed work.
- `1.4-B ComfyUI` scoped to `hidden: true` only this phase; `experimentalProviders` flag does NOT exist → designed Phase-2 slice (config schema + persistence + UI gate).

Dispatch the maximal disjoint set (Scout confirms exact scopes, ADVISOR gates, one `tasks[]` batch):
- **1.1 connection-filter extraction** [MED] — `src/lib/providers/connectionFilter.js` (fix `errorTime` parity → `null`), `tests/lib/providers/connectionFilter.test.js`, rewire 13+ call sites in `src/app/(dashboard)/dashboard/providers/page.js`, **BUILD** to prove no runtime ReferenceError.
- **1.2 PR #1576 test-only** [LOW, ready] — new `tests/unit/provider-connection-test.test.js` (from wave014-up1576; discard `EVIDENCE.md`/`IMPLEMENTATION_SUMMARY.md`/snapshot).
- **1.3-A AutoCombo tier resolver** [LOW] — `open-sse/services/autoCombo/scoring.js` + new `tierResolver.js` + `tests/unit/autoCombo-tierResolver.test.js`.
- **1.3-D Windows service docs/errors** [LOW] — improved msgs + new `docs/service-windows.md`.
- **1.3-E DefaultToolCard helpful text** [LOW].
- **1.3-B ComfyUI** [LOW] — `hidden: true` only this phase.
- **2.8 test-baseline triage** [LOW] — run `npm run test:baseline` + `verify-no-regression`; let the tool classify fails as known vs new; update `tests/__baseline__/known-fails.txt` only per the tool's report.

Add Phase 2 slices (CH-02 lint burn-down incl. lint-fatal-diff contract fix, UI tokens, dep hygiene) as their scopes prove disjoint.

## Autonomous / never-stop semantics

- After every integration and at every wave end: STATUS REPORT, then immediately plan + dispatch the next wave in the same turn.
- After every phase: ADVISOR GATE, then start the next phase's first wave.
- Review FINDINGS / QA FAIL → route to a fresh rework agent (≠ original coder family), re-review; loop until CLEAN+PASS. These are NOT halts — other wave slices keep moving.
- The run halts ONLY for: genuine product/security/legal/destructive decisions (Cursor MITM 501; official LOTR assets; force-push; full upstream merge; rename without migration), or if all model families for a required role are exhausted for >7 h.
- "100% done" = Phases 0–6 acceptance met, `dev` green (build + lint:fatal + targeted vitest + typecheck), no open STOP condition.

## Validation commands (exact)

- Focused tests: `npx vitest run tests/path/specific.test.js` — **NEVER** `npm run test:unit -- tests/unit/foo.test.js` (re-includes all of `tests/unit/`, trips known-red baseline).
- Fatal lint gate: `npm run lint:fatal`.
- Build (any UI/API/core change): `npm run build`.
- Baseline regression: `npm run test:baseline`.
- Do NOT block small unrelated slices on the known-red full suite unless the slice targets those failures.
- Reviewer over-400-line diff requires chained-PR planning unless a reviewer approves the larger slice.

## STOP conditions (halt + ask user)

- Slice removes/disables fork feature surface.
- Broad dependency update changes runtime behavior without a plan.
- Full upstream merge proposed.
- TypeScript migration attempted before Phases 1–4 stable.
- LoggerJS attempted before TypeScript complete.
- Tests or lint fail for the slice (after rework loop).
- Reviewer FINDINGS or QA FAIL that rework cannot resolve.
- Product/security/legal decision required (Cursor MITM 501; official LOTR assets; rename without migration shim).
- Destructive action (delete, history rewrite, force-push) needed.
- Scope unclear.

Routine clean commits and pushes to `origin/dev` are PRE-AUTHORIZED — do not stop for these.

## STATUS REPORT format (after every agent + every integration)

- Finished agent:
- Verdict: (CLEARED/FLAGGED | CLEAN/FINDINGS | PASS/FAIL)
- Files changed:
- Validation: (commands run + result)
- Integrated/pushed?
- Worktree removed?
- Active agents:
- Main dev status: (`git status --short --branch`)
- Next action:

## Reference files

- Plan index: `plans/README.md` (reconciled 2026-06-22; git log + this file are source of truth)
- Plans 001–010: `plans/00X-*.md` (executor-ready: scope / steps / STOP / validation)
- Roadmap 011: `plans/011-upstream-sync-pr-adoption-typescript-roadmap.md`
- Rebrand 012: `plans/012-durindoor-rebrand-lotr-inspired-theme.md` + `plans/012-brand-inventory.md`
- **Feature backlog — SPIKE (NOT scheduled, gated on source discovery):** `plans/014-kimi-quota-tracker.md` — Kimi (Kimi Code / coding-plan) quota tracker. 🔬 Blocked: web research found NO documented authenticated endpoint for Kimi *coding-plan* quota (Moonshot `/v1/users/me/balance` is the wrong product). Phase-0 source discovery (browser-network/CLI trace of the console + CLI `/usage`) is REQUIRED before any adapter (`open-sse/services/usage/kimi.js` → existing `ProviderLimits` UI). Do NOT implement until the spike resolves auth + response shape.
- Orchestrator skill: `skills/goal-loop-orchestrator/SKILL.md`
