# MiMo live probes are opt-in — live tests stop being tracked as deterministic known-fails (2026-09-18)

**Board row:** HYG-9ROUTER-10 (P1, source: hybrid — measured this tick)
**Branch:** `federation` @ `23ff74d5` (pre-change HEAD)
**Scope:** `tests/unit/mimo-free.live.test.js`, `tests/__baseline__/known-fails.txt`,
`README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/federation-spec.md`
**Predecessor:** `docs/dogfood/2026-09-18-known-fails-baseline-hygiene.md` (HYG-9ROUTER-9, tick 380)

## Defect

Two different kinds of test shared ONE baseline list:

* `tests/__baseline__/known-fails.txt` is the allowlist for
  `tests/__baseline__/verify-no-regression.mjs` — a test that FAILS now but is not listed is a
  REGRESSION (gate exit 1), and a test that PASSES now but IS listed is a STALE entry that
  silently tolerates the re-introduction of exactly that failure.
* `tests/unit/mimo-free.live.test.js` had **no skip guard of any kind**: both of its tests
  unconditionally call `proxyAwareFetch` against the real MiMo bootstrap/chat endpoints on every
  full-suite run. One of them was catalogued in the baseline as a deterministic known fail, and
  the other was a deliberately retained *stale* entry ("kept to absorb upstream flakiness",
  annotated with a dated `#` comment at tick 380).

Result at `23ff74d5`: **86 real baseline entries, exactly 1 of which is stale** (the MiMo
bootstrap test passes at HEAD), while its sibling (`chat WITH Chrome User-Agent → 200`) genuinely
fails and is baselined. A live third-party endpoint was therefore being asserted as a
deterministic property of this repository — in both directions (a flaky upstream pass hides a
real regression, a flaky upstream failure is laundered as "known").

## Disposition (option (b): explicit opt-in policy)

Live probes become **opt-in via `RUN_REAL=1`**, the convention this repo already uses for
`tests/translator/real/*.real.test.js`, and they are **removed from the baseline**:

* `tests/unit/mimo-free.live.test.js` — added `const RUN_REAL = process.env.RUN_REAL === "1";`
  and `describe.skipIf(!RUN_REAL)(...)` on both suites (mirrors
  `tests/translator/real/thinking.real.test.js`,
  `tests/translator/real/smoke-providers.real.test.js`,
  `tests/translator/real/provider-cases.real.test.js`). A default run now reports the file as
  **2 skipped** — it does not fail, it does not error, and it never touches the network. The
  header comment states the policy in code: live probe against third-party endpoints (issue
  #1933 repro), opt-in via `RUN_REAL=1`, deliberately absent from `known-fails.txt` because the
  deterministic regression gate must not absorb live-endpoint behaviour.
* `tests/__baseline__/known-fails.txt` — both `mimo-free.live.test.js` entries and the dated
  `# Kept deliberately (2026-09-18)` rationale line removed. Nothing else touched.
* Test bodies, assertions and request payloads are unchanged — the `known fail` sibling is still
  the live signal, it just no longer lives in the deterministic baseline.

## Before / after

| Measure | Before (`23ff74d5`) | After |
|---|---|---|
| Real entries in `known-fails.txt` | 86 | **84** |
| Entries naming `mimo-free` | 2 | **0** |
| Gate printed `baseline known=` | 86 | **84** |
| Gate printed `now fails=` | 85 | **84** |
| Stale entries (in baseline, not failing) | **1** | **0** |
| Regressions (failing, not in baseline) | 0 | **0** |
| Gate exit | 0 | **0** |
| Passed / failed / skipped | 2659 / 85 / 59 | **2658 / 84 / 61** |
| Total tests / test files | 2803 / 286 | **2803 / 286** |

The pass/fail/skip movement is exactly accounted for: the two MiMo tests leave the executed set
(1 was failing, 1 was passing) and become 2 skips → `failed −1`, `passed −1`, `skipped +2`, total
unchanged.

Proof both states were computed from vitest's own JSON with the SAME counting code (jest format:
`.testResults[].assertionResults[].status`):

```
# BEFORE — pre-change gate script + pre-change baseline (materialised from HEAD) on the
#          tick-380 full-run JSON (/tmp/9r380-full.json)
$ mkdir -p /tmp/9r381-before
$ git show HEAD:tests/__baseline__/known-fails.txt          > /tmp/9r381-before/known-fails.txt
$ git show HEAD:tests/__baseline__/verify-no-regression.mjs > /tmp/9r381-before/verify-no-regression.mjs
$ node /tmp/9r381-before/verify-no-regression.mjs /tmp/9r380-full.json
✅ No regression. (now fails=85, baseline known=86, all known)   GATE_EXIT_BEFORE=0

passes=2659 fails=85 skipped=59 total=2803 files=286
baseline real entries = 86
stale = 1 ['tests/unit/mimo-free.live.test.js :: MiMo Free bootstrap (live) bootstrap returns 200 with JWT']
regressions = 0

# AFTER — current gate + current baseline on the fresh full-run JSON (/tmp/9r381-full.json)
$ node tests/__baseline__/verify-no-regression.mjs /tmp/9r381-full.json
✅ No regression. (now fails=84, baseline known=84, all known)   GATE_EXIT=0

fails=84 passes=2658 skipped=61 total=2803
baseline real entries=84  duplicates=0
stale entries (in baseline, NOT failing) = 0
regressions (failing, NOT in baseline) = 0
```

The fresh run's own view of the MiMo file (`/tmp/9r381-full.json`):

```
file: /home/kara/9router/tests/unit/mimo-free.live.test.js | status: passed
    skipped :: MiMo Free bootstrap (live) bootstrap returns 200 with JWT
    skipped :: MiMo Free anti-abuse gate (live) chat WITH Chrome User-Agent → 200
```

## Live outcome recorded from the opt-in run (2026-09-18)

```
$ cd /home/kara/9router/tests && npx vitest run unit/mimo-free.live.test.js
 Test Files  1 skipped (1)
      Tests  2 skipped (2)          # 0 failed, 0 passed, network never touched

$ cd /home/kara/9router/tests && RUN_REAL=1 npx vitest run unit/mimo-free.live.test.js
 ❯ unit/mimo-free.live.test.js (2 tests | 1 failed) 3736ms
     × chat WITH Chrome User-Agent → 200 642ms
 FAIL  unit/mimo-free.live.test.js > MiMo Free anti-abuse gate (live) > chat WITH Chrome User-Agent → 200
 AssertionError: expected 400 to be 200 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
   Duration  4.49s
```

Recorded as measured: the bootstrap probe **passed** (HTTP 200 with a JWT), the chat probe
**failed** with upstream HTTP **400** instead of 200. That is exactly the live signal the policy
was built to preserve — and the same 400 is now invisible to the deterministic gate, which is the
point: a live third-party endpoint is not a property of this repository. Note this is a *change
in upstream behaviour* relative to the entry's original disposition (the baselined failure was a
`403 Illegal access` anti-abuse gate); no test body was altered to accommodate it.

## Reproduction commands

```bash
cd /home/kara/9router
git diff --numstat tests/__baseline__/known-fails.txt        # 0  3  (deletion-only)
git diff tests/__baseline__/known-fails.txt                  # one hunk, 3 removed lines, no others
grep -c "mimo-free" tests/__baseline__/known-fails.txt       # 0
grep -vE '^[[:space:]]*(#|$)' tests/__baseline__/known-fails.txt | wc -l   # 84
cd tests && npx vitest run unit/mimo-free.live.test.js                     # 2 skipped
cd tests && RUN_REAL=1 npx vitest run unit/mimo-free.live.test.js          # live, 1 passed / 1 failed
cd tests && npx vitest run --reporter=json --outputFile=/tmp/9r381-full.json
cd /home/kara/9router && node tests/__baseline__/verify-no-regression.mjs /tmp/9r381-full.json
```

## Files

* `tests/unit/mimo-free.live.test.js` (opt-in guard + policy header; bodies untouched)
* `tests/__baseline__/known-fails.txt` (2 entries + 1 rationale line removed)
* `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/federation-spec.md` (suite-count + live-test policy refresh)
* `docs/dogfood/2026-09-18-mimo-live-policy.md` (this note)
