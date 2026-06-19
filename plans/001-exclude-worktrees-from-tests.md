# Plan 001: Exclude `.worktrees/` from test runs

> **Executor instructions**: Follow step by step. Run every verification command and confirm expected output before proceeding. STOP on any mismatch — do not improvise.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `1271db0`, 2026-06-19 (working tree has 7 modified + 1 untracked file unrelated to this plan)

## Why this matters

The root `vitest.config.mjs` has no `include`/`exclude` globs, so vitest walks every directory — including `.worktrees/omniroute-port/`, a stale git worktree containing an OmniRoute port with its own divergent test suite. This produces ~154 bogus snapshot failures and 31 phantom failed files that mask real regressions. The `tests/__baseline__/known-fails.txt` can't catch them because those test files aren't in the canonical test path. Every test run is noisy and unreliable until this is fixed. This plan is a prerequisite for plans 007, 008, 009, and 010 — all of which depend on clean test signal.

## Current state

`vitest.config.mjs` (root, 13 lines):

```js
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(root, "src"),
    },
  },
});
```

No `test` key in the config — vitest uses its default include (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) with no excludes beyond `node_modules` and `dist`. This picks up everything under `.worktrees/`.

There is also a second config at `tests/vitest.config.js` used by the test runner commands:

```bash
npx vitest run --config tests/vitest.config.js "tests/unit/"
```

Both configs need the exclude.

The `.worktrees/` directory contains at least one worktree (`omniroute-port`) with its own `tests/` subtree producing OS-specific snapshots (`darwin arm64` vs `linux x64`) and divergent error strings.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Run tests (before fix) | `cd /home/cortexos/Developer/github.com/bloodf/9router && npx vitest run --config tests/vitest.config.js 2>&1 \| grep -c ".worktrees"` | non-zero count (confirms pollution) |
| Run tests (after fix) | `cd /home/cortexos/Developer/github.com/bloodf/9router && npx vitest run --config tests/vitest.config.js 2>&1 \| grep -c ".worktrees"` | `0` |
| Build | `npm run build` | exit 0 |

## Scope

**In scope** (only these files):
- `vitest.config.mjs` (root)
- `tests/vitest.config.js`

**Out of scope**:
- Do NOT delete `.worktrees/` — it may contain in-progress work. The exclude is the fix.
- Do NOT modify any test file.
- Do NOT change the test runner commands in `package.json` or `tests/package.json`.

## Steps

### Step 1: Add exclude to root vitest config

Edit `vitest.config.mjs`. Add a `test` key with `exclude` that covers `.worktrees/`, `.next/`, and `node_modules/`:

```js
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(root, "src"),
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.worktrees/**",
    ],
  },
});
```

**Verify**: `cat vitest.config.mjs` — contains `test: { exclude: [...] }` with `.worktrees` entry.

### Step 2: Add exclude to tests vitest config

Read `tests/vitest.config.js`. Add the same `exclude` array to its `defineConfig` `test` key (or create one if absent). The existing config already has aliases — merge the `test.exclude` key alongside them.

**Verify**: Read the file back — `test.exclude` array includes `**/.worktrees/**`.

### Step 3: Confirm pollution is gone

Run the full test suite and grep for `.worktrees`:

```bash
cd /home/cortexos/Developer/github.com/bloodf/9router
npx vitest run --config tests/vitest.config.js 2>&1 | grep -c ".worktrees"
```

**Verify**: Output is `0`.

Then run the targeted suite and confirm test count dropped:

```bash
npx vitest run --config tests/vitest.config.js tests/unit/ tests/translator/ 2>&1 | tail -5
```

**Verify**: Test file count is significantly lower than the pre-fix count (was 216 files including worktree pollution; should be ~80-90 after fix). No `.worktrees` paths in any failure output.

## Done criteria

- [ ] `vitest.config.mjs` has `test.exclude` with `**/.worktrees/**`
- [ ] `tests/vitest.config.js` has the same exclude
- [ ] `grep -c ".worktrees" <test output>` returns `0`
- [ ] `npm run build` exits 0
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- The vitest config files don't match the excerpts above (codebase has drifted).
- Adding `test.exclude` causes existing legitimate tests to be excluded (check the exclude glob is not too broad).

## Maintenance notes

- If a new worktree is created under `.worktrees/`, it will be excluded automatically.
- If worktrees are moved to a different path, update both configs.
- The `tests/__baseline__/known-fails.txt` should be re-baselined after this fix — many worktree-pollution failures will disappear from the baseline.
