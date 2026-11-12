# kimi golden snapshot portability — stop recording host identity and package version (2026-09-18)

**Board row:** HYG-9ROUTER-11 (P0 CI repair, source: CI)
**Branch:** `federation` @ `520ac30a` (pre-change HEAD; the CI failure is on `8fc2fe5b`)
**Scope:** `tests/translator/golden-url-header.test.js`, `tests/translator/__snapshots__/golden-url-header.test.js.snap`
**CI run under repair:** https://github.com/totalwindupflightsystems/9router/actions/runs/35371645530 (job `test`, headSha `8fc2fe5bbe45582ce0c5379c592063acf7ca601c`)

## Defect — what committed the CI regression

Commit `8fc2fe5b` ("drop stale known-fails entries and skip comment lines in the gate") removed the
kimi entry from `tests/__baseline__/known-fails.txt` on the evidence that
`translator/golden-url-header.test.js` reported `124 passed` in a **local** run. That run was green
only because the recorded snapshot had been captured on this machine, at this package version:

* `X-Msh-Device-Name` — `hostname()` in `open-sse/config/appConstants.js` `buildKimiHeaders()`
  (line 224: `deviceName = hostname() || "unknown"`)
* `X-Msh-Version` — `getAppPackageVersion()` (`package.json` `version`)

The test's `sanitize()` helper normalized tokens, `kimi-<10+ digits>` device ids and
`X-PLATFORM-VERSION` (which embeds `process.version`) — but not these two values. The case was
therefore green on the recording host and red everywhere else: on the GitHub runner the hostname
differs, so the assertion failed and, with the baseline entry already removed, the gate reported it
as a regression.

CI evidence (from `gh run view 35371645530 -R totalwindupflightsystems/9router --log-failed`):

```
❌ REGRESSION: 1 test pass→fail:

  - tests/translator/golden-url-header.test.js :: GOLDEN buildHeaders (default executor providers) kimi → headers (apiKey / oauth)
ERROR: regression gate failed (exit 1) — vitest failure excerpt from /tmp/9router-vitest-2154.log:
```

**Exactly one** regression, matching the brief. The other baseline entries removed in `8fc2fe5b`
(anthropic headers, cline headers, blackbox url) were not implicated by CI.

## Change

`tests/translator/golden-url-header.test.js` — key-scoped normalization added to `sanitize()`, in
the same style as the existing `X-PLATFORM-VERSION` normalization (the helper already iterates
`Object.entries(headers)`, so the key is in scope). `+15 / -0` lines; nothing else in the file
changed and no assertion was rewritten:

```js
    // KEY-SCOPED normalization for kimi headers whose value is host/install
    // identity, not part of the provider request contract:
    //   X-Msh-Device-Name <- hostname()            (open-sse/config/appConstants.js buildKimiHeaders)
    //   X-Msh-Version     <- package.json version  (getAppPackageVersion)
    // Both are environment-dependent (differ per machine, and X-Msh-Version
    // after every version bump), so recording them in a golden snapshot makes
    // the case pass only on the host/version that captured it.
    if (typeof v === "string" && k === "X-Msh-Device-Name") {
      out[k] = "<HOST>";
      continue;
    }
    if (typeof v === "string" && k === "X-Msh-Version") {
      out[k] = "<APP-VER>";
      continue;
    }
```

Snapshot regeneration (`cd tests && npx vitest run translator/golden-url-header.test.js -u`) moved
**only** the 6 intended lines — `6 insertions(+), 6 deletions(-)`, all inside the single kimi block,
3 blocks (`apiKey` / `nonStream` / `oauth`) × 2 fields. No other snapshot key, ordering or whitespace
changed.

## Before / after snapshot values

| Header | Snapshot before | Snapshot after |
|---|---|---|
| `X-Msh-Device-Name` (3 occurrences) | `karaHermes-mde-7840hs` | `<HOST>` |
| `X-Msh-Version` (3 occurrences) | `0.5.75` | `<APP-VER>` |

The RED state was captured before regenerating, and it is exactly the two fields — the test fails by
construction once `sanitize()` stops leaking the raw value:

```
-     "X-Msh-Device-Name": "karaHermes-mde-7840hs",
+     "X-Msh-Device-Name": "<HOST>",
      "X-Msh-Platform": "9router",
-     "X-Msh-Version": "0.5.75",
+     "X-Msh-Version": "<APP-VER>",
  Snapshots  1 failed
      Tests  1 failed | 123 passed (124)
```

## Verification

### 1. Isolation run

```
cd tests && npx vitest run translator/golden-url-header.test.js
 Test Files  1 passed (1)
      Tests  124 passed (124)
   Duration  881ms
```

### 2. Structural proof the snapshot no longer records the environment

```
grep -c 'karaHermes-mde-7840hs' tests/translator/__snapshots__/golden-url-header.test.js.snap      -> 0
grep -c '"X-Msh-Version": "0.5.75"' tests/translator/__snapshots__/golden-url-header.test.js.snap   -> 0
grep -c 'golden-url-header' tests/__baseline__/known-fails.txt                                     -> 0
grep -n 'X-Msh-Device-Name\|X-Msh-Version' <snap>
  839:    "X-Msh-Device-Name": "<HOST>"      850: same      862: same
  841:    "X-Msh-Version": "<APP-VER>"        852: same      864: same
```

`known-fails.txt` was not touched by this change.

### 3. Portability probe A — package version (host-independent half)

`package.json` version temporarily raised `0.5.75 -> 9.9.9`, snapshot unchanged, then
`CI=true npx vitest run translator/golden-url-header.test.js`:

* kimi → headers: **passed** (`X-Msh-Version` now normalized, so a version bump cannot move the
  golden).

### 4. Portability probe B — hostname (the value that actually broke CI)

Temporary probe files (not committed; deleted after the run):

* `tests/translator/zz-probe-hostname.test.js` — copy of the fixed test file plus
  `vi.mock("node:os", ...)` returning `hostname: () => "probehost-ci-9x"`, plus a **premise** test
  asserting `buildKimiHeaders(...)["X-Msh-Device-Name"] === "probehost-ci-9x"` (so a non-intercepted
  mock cannot make the probe vacuous).
* `tests/translator/__snapshots__/zz-probe-hostname.test.js.snap` — copy of the fixed snapshot.
* RED control: `zz-probe-prefix.test.js` + its snapshot, built from the **pre-fix revision**
  (`git show 520ac30a:tests/translator/golden-url-header.test.js` and the same SHA's snapshot; control
  provenance asserted up front — `grep -c karaHermes-mde-7840hs` → 3 in the copy, `grep -c
  X-Msh-Device-Name` → 0 in the pre-fix script, i.e. the pre-fix `sanitize()` really did not touch
  the key).

Both run with `CI=true` so a mismatch fails instead of silently writing a new snapshot:

| Arm | Files | Result |
|---|---|---|
| FIXED test + fixed snapshot, foreign hostname | `zz-probe-hostname.test.js` | **125 passed** (124 golden + 1 premise) — 0 snapshot failures |
| PRE-FIX test + pre-fix snapshot, foreign hostname | `zz-probe-prefix.test.js` | **1 failed** — `GOLDEN buildHeaders (default executor providers) > kimi → headers (apiKey / oauth)` |

The RED control's diff is the CI failure class reproduced on demand, with a hostname of our choosing:

```
-     "X-Msh-Device-Name": "karaHermes-mde-7840hs",
+     "X-Msh-Device-Name": "probehost-ci-9x",
```

Both probe files and both probe snapshots were deleted before the full-suite run and before commit;
`git status` shows only the two intended modified files.

### 5. Fresh full suite + regression gate

```
cd /home/kara/9router/tests && npx vitest run --reporter=json --outputFile=/tmp/9r380b-full2.json
cd /home/kara/9router && node tests/__baseline__/verify-no-regression.mjs /tmp/9r380b-full2.json
```

| Metric | Value |
|---|---|
| Test files | 286 |
| Total tests | 2803 |
| Passed | 2659 |
| Failed | 85 |
| Skipped | 59 |
| `golden-url-header.test.js` | `passed`, 124 assertions, **0 failed** |
| kimi → headers (apiKey / oauth) | `passed` |
| Gate | `✅ No regression. (now fails=85, baseline known=86, all known)` — **exit 0** |

Totals are identical to the tick-379/380 baseline (2803 / 2659 / 85 / 59).

## Finding the brief did not cover (reported, NOT fixed)

The brief's statement that the cline headers case is "NOT affected" is **true for CI but false as a
general portability claim**, and this was measured rather than reasoned:

* Bumping `package.json` to `9.9.9` (probe A) turned the **cline** case red, not the kimi one:
  `User-Agent: 9Router/0.5.75`, `X-CLIENT-VERSION: 0.5.75`, `X-CORE-VERSION: 0.5.75` —
  3 fields × 3 blocks, and the **same** on `clinepass`. In total `0.5.75` appears **18 times** in the
  snapshot across those two cases.
* CI is unaffected because `getAppPackageVersion()` reads the repo-pinned `package.json`, which is
  `0.5.75` on the runner too — consistent with CI reporting exactly one regression. But the first
  `npm version patch` after this commit will break `cline → headers` and `clinepass → headers` on
  every host, and with those entries absent from `known-fails.txt` that will surface as a gate
  regression exactly like this one.

Per the brief ("do not widen the change silently"), the scope was kept to the kimi case; the cline
version fields were deliberately left alone. Recommended follow-up (one board row, same
key-scoped-normalization pattern, `User-Agent` needs a `9Router/…` pattern rather than a bare key
match): extend `sanitize()` to the cline `User-Agent` / `X-CLIENT-VERSION` / `X-CORE-VERSION` fields
and regenerate those two snapshot blocks.

Residual, stated honestly: `X-Msh-Device-Model` (`"Linux x64"`) is derived from
`platform()`/`arch()` and is therefore host-dependent too. It is **not** normalized here, because it
is identical on Linux CI and on this host (normalizing it would have moved 3 more snapshot lines and
broken the brief's strict "only the 6 lines" isolation check). It would break on a macOS or Windows
contributor machine or a non-x64 runner.

Separately, the first local full run in this tick reported **86** failures instead of 85: an extra
`tests/federation/replication.test.js :: FED-022 regression: settings seeds stamp federation_version
(delta-visible)` failure (duration 10.9 s in-run vs 3.4 s standalone, on a host at loadavg ≈ 13.7;
it passes in isolation and passed in the second full run). That test is unrelated to this change —
it does not import the translator golden file — and it is not in the baseline. Recorded as an
observation; not repaired here.

## Authoritative confirmation

**CI is the authoritative confirmation of this fix, not the local run.** The local evidence above
can only show that the snapshot no longer *contains* host identity or package version and that the
case survives a foreign hostname and a version bump under a mocked `node:os`. Because the recorded
value came from the runner's own hostname, the only proof that the GitHub `test` job is green is a
new run of that job on this commit; the local full suite and gate (85 fails, `baseline known=86`,
exit 0) establish no-regression, but they cannot by themselves reproduce the runner.

## Files

* `tests/translator/golden-url-header.test.js`
* `tests/translator/__snapshots__/golden-url-header.test.js.snap`
* `docs/dogfood/2026-09-18-kimi-golden-snapshot-portability.md` (this note)
