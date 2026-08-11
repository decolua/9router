# Handoff — 9router model-banding & frame-integrity work

**Written:** 2026-08-11 · **Revised:** 2026-08-11 (post-recovery) · **Reason:** the implementing session was killed by SentinelOne EDR. A first draft of this document assumed the work was destroyed. **That was wrong — it was recovered in full.** This revision records the true state.

---

## 1. Read this first: the banding work is DONE

**Nothing was lost.** The purged session had pushed its commits before it died. They are on `origin/inyund` and are now merged into the WSL clone (`~/projects/inyund/9router`, fast-forwarded `34089098` → `e9ff4daa`):

| commit | subject |
|---|---|
| `87b88536` | fix(tuner): derive bands from declared model identity, not id substrings |
| `e82a8af9` | fix(tuner): band gpt-5.3-codex-spark and gpt-5.5-pro on their own terms |
| `e9ff4daa` | fix(tuner): declare identity for the free-tier ids that had none |

31 files, +641/−116 — including `tuner/tune.mjs`, `open-sse/providers/schema.js`, 20 registry files, `CONTEXT.md`, and `docs/adr/0001-model-identity-and-band-derivation.md`. The whole structural design in §3 is **implemented**, not merely designed. `CLAUDE.md` documents the convention.

What EDR actually destroyed was the *Windows working copy* (it quarantined `tune.mjs`, `schema.js` and every `registry/*.js`) and the local branch ref. The remote was untouched. The earlier claim that "the deployed `bench.json` is the only surviving copy" was false; the recovered `bench.json` is byte-identical to the one that survived on the Windows disk, so there is nothing to reconcile out of Dokploy.

**Live behaviour, verified via the `ninerouter` MCP tools:**

| model | band now | placement | previously |
|---|---|---|---|
| `ag/gemini-3.1-pro-low` | `haiku` | Sleipnir #11 only | wrongly `opus`, sat in Odin #3 |
| `ag/gemini-pro-agent` | `opus` | Odin #4, Fenrir #3 | invisible — in no combo at all |

**The 17 free-tier candidates are handled.** That defect (the pre-flight diff covering the registry only) was fixed by `e9ff4daa`: deleting substring inference dropped every `-free` id out of its combo at once, including the free heads of Odin and Sleipnir, and they are now declared explicitly in `bench.json`'s `_modelIdentity` with `mode: "free"` — a free tier carries its family's band unshifted, because it costs less, it does not think less.

> **First action for the next session:** confirm the local branch is at `e9ff4daa` and that the deploy matches, then start on §4 — frame integrity. Do **not** re-do the banding work.

**Only frame integrity remains** (§3, second half). See §4 for the one conflict to resolve first.

---

## 2. The bug, in one paragraph — *fixed; kept for context*

> Historical. Line numbers and the substring behaviour below describe `tune.mjs` **before** `87b88536`. Read it to understand why the design in §3 looks the way it does, not as a description of current code.


`ag/gemini-3.1-pro-low` is one opaque string carrying three independent facts: route (`ag`), capability family (`gemini-3.1-pro`), and effort (`low`). `matchBench` (`tuner/tune.mjs:175`) recovers the family by *substring search* over bench keys. Both defects are that guess failing in opposite directions — `"gemini-3.1-pro-low".includes("gemini-3.1-pro")` is true, so a low-effort variant inherited the full model's `opus` band and landed one hop from the top-tier Odin combo; `"gemini-pro-agent"` matches no key, so `band()` returned `null` and it was filtered out at `tune.mjs:354`. Band is the gate — no band means invisible to every combo, a rule that is nowhere stated and merely falls out of `null` not being in `allowed`.

Scale context: **52 banded models vs 959 registered** across 119 registries, and `tuner/discover.mjs` auto-discovers more from public lists, so the gap widens on its own.

---

## 3. Settled design — do not relitigate

Reached over three rounds of structured review; every point below was explicitly accepted. **"Model identity" and "Unbanded policy" are now shipped** — they describe current behaviour, and `CONTEXT.md` plus `docs/adr/0001` are the maintained versions. **"Frame integrity" is not built**; that subsection is still a specification.

### Model identity
- `family`, `effort`, `mode` become **registry entry fields**, contracted in `open-sse/providers/schema.js`'s `@typedef RegistryEntry`, beside the existing `upstreamModelId` (38 uses — established precedent that registry id ≠ upstream identity).
- Bands attach to **families** in `bench.models`. Effort applies a **declared offset** from a table in `bench.json`, sibling to `_bands` / `_comboBand` / `_comboDepth`. Starting proposal `high: 0, medium: −1, low: −2`; `extra-low` and `minimal` need their own steps.
- **Exact match only. Delete the substring fallback.** This is what makes the original bug structurally impossible rather than merely corrected.
- `thinking` is a **mode, not an effort** — `claude-opus-4-6-thinking` and `gemini-3.1-pro-low` are different kinds of fact. Separate fields, separate vocabulary. Folding them together is how this recurs.
- Backfill is **lazy**: `family`/`effort` required only for models that are actual combo candidates (providers you hold credentials for), filled on demand. Not a 959-entry migration.

### Unbanded policy
- Keep fail-closed (unbanded ⇒ invisible) but **make it loud**: the tuner reports unbanded candidates *by name* every run, via the existing Discord webhook. Never auto-assign a band — that is how an unvetted model discovered off a README ends up serving traffic.

### Frame integrity
- **The router owns the frame; the client owns the content.** A model forging harness control markers (`[Request interrupted by user`, `<system-reminder>`, `<command-name>`, `<local-command-stdout>`) is a *protocol* violation, decidable without judging quality. This bounded remit is deliberate — a general "response validator chain" was considered and rejected as an invitation for every future annoyance to become a plugin.
- **Outbound detection only.** Never rewrite the inbound transcript: a message legitimately *quoting* a marker must survive intact.
- **Late detection, no buffering, no stripping.** Buffering taxes 100% of traffic for a sub-1% failure; stripping makes the router a content editor, which the boundary above forbids.
- **Reuse the existing health signal — build no new demotion machinery.** Record the violation through the same write that already sets `requestDetails.status='error'`. `getHealth` (`tuner/tune.mjs:140`) already has the hair-trigger `recentErr > 0 && recentOk === 0 → h = 0`, which sinks the model within 30 minutes and reorders the pool on the next tuner run.
- Lives in `open-sse/handlers/chatCore.js` (single choke point, provider-agnostic). Marker vocabulary as **one exported constant** under `open-sse/config/` — the repo's own rule is never to hardcode role/block/model strings. Not in per-format translators: that gets implemented N times and silently misses every format added later.

### Explicit non-goal
Nothing here judges whether a response is *good*. That door stays shut.

---

## 4. Delivery plan — what is left

Banding shipped as `87b88536..e9ff4daa`, with `CONTEXT.md` and `docs/adr/0001-model-identity-and-band-derivation.md`. Remaining:

- [ ] `docs/adr/0002-router-enforces-frame-integrity-not-quality.md` — the only ADR still unwritten
- [ ] The violation → health-signal wiring in `open-sse/handlers/chatCore.js`
- [x] ~~`docs/adr/0001`~~ · ~~`CONTEXT.md`~~ · ~~bench prose migrated out of `_comment` fields~~

### Resolve this before writing the ADR

**The repo already strips, and the settled design says never strip.** This was not visible when §3 was written. Pre-existing machinery:

- `open-sse/utils/echoScrub.js` — `stripEchoTags()` deletes whole `<instructions>`, `<system-reminder>`, `<task-notification>`, `<command-message>`, `<command-name>` blocks from non-streaming bodies.
- `open-sse/translator/response/openai-to-claude.js:66-69` — the same `ECHO_TAGS` filtered incrementally on the streaming path, with a carry buffer for tags split across chunks.
- `open-sse/rtk/disciplineNudge.js` — already nudges a model that echoed those blocks.
- Called from `chatCore/sseToJsonHandler.js:12` and `chatCore/nonStreamingHandler.js:13`.

So the router is *already* a content editor for exactly these markers. Options, and this is a genuine decision the next session must make rather than assume: keep the strip and add the health signal alongside it (cheapest, but concedes the boundary §3 draws); or demote the strip to detection-only and let the health signal do the work (matches the design, changes existing user-visible behaviour). Note `CONTEXT.md`'s "Owning the conversation" section already states the boundary — whichever way this goes, that prose and the code must end up agreeing.

Also note the existing marker list is **XML echo tags**, not the literal `[Request interrupted by user` control string §3 names. The vocabularies overlap but are not the same set; unify them in `open-sse/config/` as §3 requires.

### Glossary — now landed in `CONTEXT.md`

| Term | Meaning |
|---|---|
| **Family** | Capability class — `gemini-3.1-pro`. The unit that carries a band. |
| **Effort** | Declared compute level — `low`/`medium`/`high`. Shifts band by a declared offset; never inherits the family's. |
| **Mode** | Orthogonal behaviour switch — `thinking`. Not an effort level. |
| **Route** | Provider prefix + credentials + quota domain — the `ag/` in `ag/gemini-3.1-pro-low`. |
| **Band** | Quality tier: `fable`/`opus`/`sonnet`/`haiku`/`below`. |
| **Candidate** | A model with working credentials. Unbanded candidate ⇒ invisible, and reported by name. |
| **Pool** | Candidates admitted to a combo after band and capability filtering. |
| **Frame integrity** | The router owns conversation framing; the client owns content. Forging harness control markers violates the frame. |

---

## 5. Environment — read before running anything

**This machine runs SentinelOne EDR (`Sentinel Agent` 25.2.6.442), and it is what destroyed the previous session.** Root cause confirmed: a burst of ~670 small source files created within one minute by a `CLI → bash → git/node` process tree tripped the ransomware heuristic. SentinelOne killed the process (`0xc0000022` ACCESS_DENIED), quarantined the files, quarantined Git's `bash.exe` (`0x80070002` FILE_NOT_FOUND on next launch), and rolled back filesystem changes — taking the session transcript and the git branch with it.

**As of 2026-08-11 that exposure is largely closed:** Claude Code now runs entirely inside WSL2 (Linux node v24.19.0 via nvm, `claude` 2.1.227 resolving to `~/.nvm/versions/node/v24.19.0/bin/claude`), and every trace of it has been removed from the Windows side. Sessions, transcripts, memory and MCP config live on ext4 at `~/.claude`, which the EDR does not watch.

Rules that follow:
- **Never run `npm install`, `npm run build`, `next build`, or `git clone` against a `/mnt/c` path from inside the agent.** Bulk file creation there is the trigger. On ext4 the heuristic does not apply, but ask the user to run long builds in their own terminal anyway — a kill then costs a terminal, not a session.
- Work happens in **WSL2 on the Linux filesystem** (`~/projects/...`), never `/mnt/c`. The Windows checkout of this repo is the damaged one and should not be trusted or revived.
- **Push early.** This work survived only because the commits reached `origin/inyund`. A local branch is not a backup.
- A permanent fix for the Windows side requires EDR path exclusions from IT, with **mitigation suppressed, not just alerts** — an alert-only exclusion still quarantines.

Repo conventions (from `9router/CLAUDE.md`, which differs sharply from the `ids` project's): plain JavaScript ESM, **no TypeScript**, `@/*` → `src/*`, Conventional Commits, changes logged in `CHANGELOG.md`. Read `open-sse/AGENTS.md` before touching anything under `open-sse/`. The test suite is **not** expected to be green — judge regressions with `tests/__baseline__/verify-no-regression.mjs`, not a raw run.

---

## 6. Suggested skills

- **`tdd`** — for the frame-integrity detector; it has a crisp seam and cheap fixtures (a canned response containing a forged marker), and `echoScrub.js` already shows the shape of the seam.
- **`domain-modeling`** — for ADR 0002 only. `CONTEXT.md` and the family/effort/mode model are done; do not re-derive them.
- **`writing-for-agents`** — if `CLAUDE.md` needs a frame-integrity note once the strip-vs-detect question is settled.
- **`code-review`** — before the PR.
- Do **not** invoke `grilling` on the banding design — it is settled and shipped. The strip-vs-detect conflict in §4 *is* open and is worth grilling.
