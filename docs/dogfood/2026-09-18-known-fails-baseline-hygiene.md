# known-fails baseline hygiene — stale entries pruned + honest gate count (2026-09-18)

**Board row:** HYG-9ROUTER-9 (P1, source: hybrid — measured this tick)
**Branch:** `federation` @ `938c7d16` (pre-change HEAD)
**Scope:** `tests/__baseline__/known-fails.txt`, `tests/__baseline__/verify-no-regression.mjs`

## Defect

`verify-no-regression.mjs` builds its allowlist with
`readFileSync(...).split("\n").map(s => s.trim()).filter(Boolean)`, so the file's `#` rationale
lines were loaded as if they were test identifiers. The gate therefore printed a baseline size
larger than the number of real entries, and 5 of the real entries were also stale (the named test
no longer fails), which silently tolerates the re-introduction of exactly those failures.

## Before / after

| Measure | Before | After |
|---|---|---|
| Raw lines in `known-fails.txt` | 94 | 91 |
| Non-empty lines | 93 | 90 |
| `#` comment lines | 3 | 4 |
| **Real entries** | **90** | **86** |
| Gate printed `baseline known=` | **93** (dishonest — counted 3 comments) | **86** (= real entries) |
| Gate printed `now fails=` | 85 | 85 |
| Stale entries (in baseline, not failing) | 5 | 1 (deliberate — see below) |
| Regressions (failing, not in baseline) | 0 | 0 |

Gate output, all three states, same full-run JSON (`/tmp/9r379-full-foreman.json`):

```
# BEFORE — original file + original parser
✅ No regression. (now fails=85, baseline known=93, all known)     exit=0
# intermediate — pruned file + ORIGINAL parser (git HEAD revision)
✅ No regression. (now fails=85, baseline known=90, all known)     exit=0
# AFTER — pruned file + fixed parser
✅ No regression. (now fails=85, baseline known=86, all known)     exit=0
```

The middle line is the parser-fix proof: 90 = 86 real entries + 4 comment lines. The pre-edit
script was materialised from the pre-change revision with
`git show HEAD:tests/__baseline__/verify-no-regression.mjs` (into a scratch dir holding a copy of
the pruned baseline, because the script resolves `./known-fails.txt` relative to its own URL).

## Changes

`tests/__baseline__/known-fails.txt` — `1 insertion(+), 4 deletions(-)`:

* removed the 4 stale `tests/translator/golden-url-header.test.js` entries;
* inserted one dated `#` rationale line above the retained MiMo entry;
* nothing else — no reordering, no whitespace churn, no rewritten lines.

`tests/__baseline__/verify-no-regression.mjs` — `1 insertion(+), 1 deletion(-)`:

```diff
-    .split("\n").map(s => s.trim()).filter(Boolean)
+    .split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"))
```

`startsWith("#")` after `trim()` is safe here: every entry line begins with `tests/`. What counts
as a regression is unchanged — only the size of the allowlist set changed.

## Disposition of the 5 stale entries

| # | Entry | Disposition | Evidence |
|---|---|---|---|
| 1 | `golden-url-header :: buildHeaders (default executor providers) anthropic → headers` | removed | passes in isolation and in the full run |
| 2 | `golden-url-header :: buildHeaders (default executor providers) cline → headers` | removed | passes in isolation and in the full run |
| 3 | `golden-url-header :: buildHeaders (default executor providers) kimi → headers` | removed | passes in isolation and in the full run |
| 4 | `golden-url-header :: buildUrl (default executor providers) blackbox → url` | removed | passes in isolation and in the full run |
| 5 | `unit/mimo-free.live.test.js :: MiMo Free bootstrap (live) bootstrap returns 200 with JWT` | **retained** | see below |

The four golden tests, isolation run:

```
cd tests && npx vitest run translator/golden-url-header.test.js
 Test Files  1 passed (1)
      Tests  124 passed (124)
   Duration  710ms
```

In the fresh full run the same file reports `124 passed` of 124, and each of the four named tests
carries `status: "passed"`. `grep -c golden-url-header tests/__baseline__/known-fails.txt` → `0`.

## The retained MiMo entry — measured status contradicts the brief

The brief directed that this entry be kept on the stated grounds that it is "a live-credential
test that SKIPS without creds". **That premise is false, and it was measured, not assumed:**

* `tests/unit/mimo-free.live.test.js` (60 lines) has **no skip guard of any kind** — no
  `skipIf`, no `describe.skip`, no credential/env precondition. Both of its tests
  unconditionally call `proxyAwareFetch` against the real MiMo endpoints (a free provider; no
  credentials are involved anywhere in the file).
* In the fresh full run the retained test's status is **`passed`**, not skipped — while its
  sibling in the same file (`MiMo Free anti-abuse gate (live) chat WITH Chrome User-Agent → 200`)
  is `failed` and is a genuine known fail that stays in the baseline.
* The brief's own problem statement classifies this entry as stale *because it passes at HEAD*,
  which cannot be reconciled with "it skips".

Consequences, stated plainly:

* The entry is a **deliberate stale entry**. The acceptance criterion "every remaining entry still
  fails at HEAD in the fresh run (0 stale entries)" is therefore **not met for this one entry**;
  it is met for the other 85 (all 85 entries corresponding to real failures are in the failing
  set, and the failing set contains no test outside the baseline).
* A stale entry **masks** a future regression on exactly that test: if the MiMo bootstrap breaks
  upstream, `verify-no-regression.mjs` will not flag it while this line is present. The retention
  is defensible only as deliberate flakiness absorption for a live third-party endpoint — which
  is the rationale written into the baseline comment, since the brief's stated rationale could
  not be written truthfully.
* The comment inserted above the entry is therefore:

```
# Kept deliberately (2026-09-18): live-network test (no skip guard) that PASSES at HEAD — retained to absorb upstream flakiness; see docs/dogfood/2026-09-18-known-fails-baseline-hygiene.md
```

Recommended follow-up for the foreman (one-line change, not made here because the brief scoped
this tick to the two files and explicitly ordered this entry kept): either delete the entry, or
add a credential/env skip guard to the test so "skips without creds" becomes true.

## Fresh full run

```
cd /home/kara/9router/tests && npx vitest run --reporter=json --outputFile=/tmp/9r380-full.json
```

| Metric | Value |
|---|---|
| Test files | 286 |
| Total tests | 2803 |
| Passed | 2659 |
| Failed | 85 |
| Skipped | 59 |
| Vitest exit | 1 (expected — the suite is red by design) |
| `numPassedTests` / `numFailedTests` / `numPendingTests` (summary fields) | 2659 / 85 / 59 |

Totals are identical to the tick-379 foreman run (2803 / 2659 / 85). Note on parsing: vitest 4
reports skips as `status: "skipped"`, not `"pending"`, so the 59 skips appear in
`numPendingTests` in the summary block while the assertion histogram shows
`{passed: 2659, failed: 85, skipped: 59}`.

Gate on the fresh run:

```
cd /home/kara/9router && node tests/__baseline__/verify-no-regression.mjs /tmp/9r380-full.json
✅ No regression. (now fails=85, baseline known=86, all known)
exit=0
```

Sanity probe (parsed line-per-entry, 2026-09-18):

```
real entries: 86 | comment lines: 4 | non-empty: 90 | duplicate entries: 0
entries NOT in fresh failing set (stale): 1   -> the retained MiMo bootstrap entry only
failing tests NOT covered by baseline (regressions): 0
```

## Reproduction commands

```
cd /home/kara/9router && git status --porcelain
wc -l tests/__baseline__/known-fails.txt                    # 94 pre / 91 post
grep -c . tests/__baseline__/known-fails.txt                # 93 pre / 90 post
grep -c '^#' tests/__baseline__/known-fails.txt             # 3 pre / 4 post
grep -vE '^[[:space:]]*(#|$)' tests/__baseline__/known-fails.txt | wc -l   # 90 pre / 86 post
node tests/__baseline__/verify-no-regression.mjs /tmp/9r380-full.json
```

## Files

* `tests/__baseline__/known-fails.txt`
* `tests/__baseline__/verify-no-regression.mjs`
* `docs/dogfood/2026-09-18-known-fails-baseline-hygiene.md` (this note)
