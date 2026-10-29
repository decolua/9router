VERDICT: APPROVED

Wave recovery re-verification for 9router tick 9router-2026-09-24-10-08-39
(recovering wave 9router-2026-09-23-21-24 base 3819ce0d = main HEAD, which
already contains 89c0084f (DEPS-004) and 11bd40f5 (QA-9ROUTER-20)). All
commands below were re-run from scratch in the live checkout at 3819ce0d;
nothing was taken from the foreman's reference run.

=====================================================================
TASK A — DEPS-004 (commit 89c0084f): PASS
=====================================================================

A1. Bump line is exactly the minor/patch set, no eslint jump.
`git show 89c0084f -- package.json` (changed lines only):

      "@next/third-parties": "^16.3.5" -> "^16.3.6"
      "marked":              "^18.0.13" -> "^18.0.14"
      "material-symbols":    "^0.47.4"  -> "^0.47.5"
      "next":                "^16.3.5"  -> "^16.3.6"
      "undici":              "^8.10.2"  -> "^8.11.0"
      "eslint-config-next":  "16.3.5"   -> "^16.3.6"   (in-range dev pin, same 16.3.6 line)
      "eslint":              "^9"  (unchanged — no ^10 anywhere)

package-lock.json updated in the SAME commit (140 lines), both files
committed together.

A2. eslint-10 deferral probe (evidence line):

    $ node scripts/check-eslint10-parser.mjs
    ✗ eslint ^10 parser probe: BLOCKED
      reason: scopeManager.addGlobals is not a function
      parser: next/dist/compiled/babel/eslint-parser (next 16.3.6)
    exit code: 1  → BLOCKED = correctly deferred, eslint ^10 stays out.

A3. Lockfile consistency:

    $ npm install --no-audit --no-fund           → exit 0
    $ npm ls next marked undici material-symbols @next/third-parties
    ├─┬ @next/third-parties@16.3.6
    │ └── next@16.3.6 deduped
    ├── marked@18.0.14
    ├── material-symbols@0.47.5
    ├── next@16.3.6
    └── undici@8.11.0
    exit 0 — no invalid / no missing lines.
    $ git status --porcelain -- package.json package-lock.json  → empty
    (no drift: the tree after install is byte-identical to base for
    both files; the lock edits live inside 89c0084f itself)

A4. Lint gate:

    $ npm run lint:gate
    lint totals: errors=135 warnings=204 problems=339 filesLinted=1332 filesWithProblems=218
    ✅ lint baseline intact. (errors=135, warnings=204, files=1332)
    exit 0 — baseline exactly 135/204/1332 as specified.

A5. Full suite, regression-gated (run in isolation — see measurement note):

    $ cd tests && npx vitest run --reporter=json --outputFile=/tmp/wt-001-deps2.json
    $ node tests/__baseline__/verify-no-regression.mjs /tmp/wt-001-deps2.json
    ✅ No regression. (now fails=74, baseline known=76, all known)
    exit 0

My suite totals (from /tmp/wt-001-deps2.json):
    numTotalTests=3158  numPassedTests=3023  numFailedTests=74  numPendingTests=61
All 74 failures matched by the 76-entry tests/__baseline__/known-fails.txt
baseline; 0 unknown failures. Matches the stated truth exactly.

MEASUREMENT NOTE (contamination, not a defect): my first full-suite run
(/tmp/wt-001-deps.json) showed 3158/3021/76/61 with 2 failures outside the
baseline — both in the QA-21 ui-probe LIVE block (port :3111). I had
launched the direct QA-file run (Task B) while the full suite was still
running; the two runs contended for the shared probe port and inverted each
other's probe verdicts (expected OK got FAIL and vice versa). I re-ran the
full suite alone (deps2) with nothing else touching :3111 and got the clean
74/74 result above. The repo is correct; my first run was my own error.

=====================================================================
TASK B — QA-9ROUTER-20 (commit 11bd40f5): PASS
=====================================================================

B1. The pin file drives the REAL harness. tests/federation/
qa-harness-cell-detection.test.js resolves
`~/.hermes/scripts/bunker-qa.sh` (line 81-84) and calls its test hooks
directly — `__detect-cmds` (real detection output) and
`__gen-remote-detected` (render with real detection baked in) — then
extracts the ci-pass decision chain from a REAL render (marker
`#QA-CELL:ci-pass:start/end`) and executes it. The only substitutions are
the `cell` evidence writer (becomes a collector) and the native-suite
command; no detection logic is re-implemented in the test. Verified against
the live harness: /home/kara/.hermes/scripts/bunker-qa.sh at commit e398349
("fix(qa-harness): select publishable package + only triggerable workflows")
contains both behaviors under test (npm_pkg_publishable /
detect_publish_pkg_name at lines 587-630; QA_CI_SELECT triggerable-workflow
selection and the ci-pass chain at lines ~378-630 and ~1258-1448).

Both required behaviors are covered:
  (a) publishable beats private — 5 tests in "upgrade-coordinate detection
      prefers a PUBLISHABLE package (QA-9ROUTER-20)": private root +
      published nested cli/ selects "9router" (DETECT_PKG_NAME, and the
      rendered cell bakes QA_PKG_NAME='9router', never '9router-app');
      publishable root keeps legacy selection; nothing-publishable honestly
      returns the root name (not a rubber stamp); root-only repo invents no
      candidate.
  (b) triggerable-workflow rule — 11 tests in "ci-pass runs only workflows
      that can fire on a branch push (QA-9ROUTER-19)": docker-publish.yml
      (tag/dispatch) and gitbook-pages.yml (main|master only) dropped on a
      federation push; gitbook-pages kept on master; rendered script stages
      selection outside the tree; a genuinely triggerable workflow is still
      run; no-triggerable ⇒ act skipped with reason (never a FAIL artifact);
      NEGATIVE CONTROLS prove a real act failure still grades FAIL and a
      passing native suite names the act failure instead of hiding it; a
      workflow's own registry/docker artifact classifies INFO, and the
      classification does not cover unrelated docker mentions.

B2. Direct run (evidence line):

    $ cd tests && npx vitest run federation/qa-harness-cell-detection.test.js
    exit 0 — 35 tests: 30 passed, 0 failed, 5 skipped.
    All 16 QA-9ROUTER-19/20 pin tests PASSED (5 × publishable-package +
    11 × triggerable-workflow/act-leg).
    The 5 skips are the conditional LIVE ui-probe block (QA-9ROUTER-21,
    lines 997-1056): `const live = busy ? describe.skip : describe` — the
    block skips only when port :3111 is already answered, an explicit,
    documented reason (shared fleet boxes), not a blanket skip. The QA-19/20
    pins themselves never skip. (Foreman reference run showed 34/34 because
    on their run the port was free and the live block executed; mine ran
    while :3111 was contended by my own parallel suite run. Both outcomes
    are within the file's documented contract.)

B3. Cleanliness: no secrets (0 matches for key/secret/token/password
assignments, no Bearer strings); no external network (only
http://127.0.0.1 probe URLs; the `npm ci ...` string is a literal asserted
against rendered output, never executed; no npmjs.org references).

=====================================================================
SCOPE CHECK
=====================================================================
`git diff 3819ce0d` from the live checkout shows ZERO repo-file changes
outside .gitreins/ fleet state (tasks.yaml), which is pre-existing local
state, not part of either judged commit. No destructive or out-of-scope
change in 89c0084f or 11bd40f5 (checked full diffs: package.json +
package-lock.json, and the one test file, respectively).

Fixes made by this worker: none needed — no defect found. This verdict
file is the only file added.

Evidence artifacts: /tmp/wt-001-deps2.json (clean full-suite JSON),
/tmp/wt-001-qa.json (direct pin-test run), /tmp/wt-001-deps.json +
/tmp/wt-001-deps.json analysis retained for the contamination note.