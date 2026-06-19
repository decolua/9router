# Plan 007: Add sync-assertion test for `localDb.js` back-compat shim

> **Executor instructions**: Follow step by step. Run every verification command. STOP on mismatch.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001 (worktree exclude — tests must be clean before this test is meaningful)
- **Category**: tests, tech-debt
- **Planned at**: commit `1271db0`, 2026-06-19

## Why this matters

`src/lib/localDb.js` is a back-compat shim that re-exports from `src/lib/db/index.js`. Historically, when new functions were added to `db/index.js` without updating the shim, MCP gateway routes silently failed with "404" because webpack couldn't resolve the imports through the shim. This happened because there is **no test asserting the shim's export set matches the canonical module**. This plan adds a single test that fails loudly whenever the shim drifts — turning a silent runtime 404 into an obvious CI failure.

## Current state

`src/lib/localDb.js` (35 lines) re-exports a fixed list from `@/lib/db/index.js`:

```js
export {
  getSettings, updateSettings, /* ... ~40 names ... */
  exportDb, importDb,
} from "@/lib/db/index.js";
```

`src/lib/db/index.js` is the canonical hub that imports from `src/lib/db/repos/*.js` and re-exports everything.

The risk: if a developer adds a new function to a repo (e.g. `getMcpTools`) and exports it from `db/index.js` but forgets to add it to the `localDb.js` re-export list, any route importing from `@/lib/localDb` silently fails. Webpack logs an "Attempted import error" warning that's easy to miss.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `cd /home/cortexos/Developer/github.com/bloodf/9router && npx vitest run --config tests/vitest.config.js tests/unit/localdb-shim-sync.test.js` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `tests/unit/localdb-shim-sync.test.js` (create)

**Out of scope**:
- Do NOT modify `src/lib/localDb.js` or `src/lib/db/index.js`.
- Do NOT add a build-time lint rule — the runtime test is sufficient.

## Steps

### Step 1: Create the sync test

Create `tests/unit/localdb-shim-sync.test.js`:

```js
import { describe, it, expect } from "vitest";

// Import both modules and compare their export sets.
// The shim at @/lib/localDb re-exports from @/lib/db/index.js.
// If db/index.js gains an export not in localDb, routes importing from
// @/lib/localDb will silently fail at runtime (webpack import error → 404).
// This test catches that drift at test time.

// Dynamic import to get the module namespace objects
async function getExportKeys(mod) {
  const ns = await import(mod);
  return Object.keys(ns).sort();
}

describe("localDb shim export sync", () => {
  it("@/lib/localDb re-exports every export from @/lib/db/index.js", async () => {
    const dbKeys = await getExportKeys("../../src/lib/db/index.js");
    const shimKeys = await getExportKeys("../../src/lib/localDb.js");

    const missing = dbKeys.filter((k) => !shimKeys.includes(k));
    if (missing.length > 0) {
      // Fail with a clear message listing the missing exports
      expect(missing).toEqual([]);
    }
  });

  it("shim does not export names absent from db/index.js (no phantom exports)", async () => {
    const dbKeys = await getExportKeys("../../src/lib/db/index.js");
    const shimKeys = await getExportKeys("../../src/lib/localDb.js");

    const phantom = shimKeys.filter((k) => !dbKeys.includes(k));
    expect(phantom).toEqual([]);
  });
});
```

**Verify**: `npx vitest run --config tests/vitest.config.js tests/unit/localdb-shim-sync.test.js` → 2 tests pass.

### Step 2: Verify the test catches drift (optional manual check)

Temporarily comment out one export from `src/lib/localDb.js` (e.g. `exportDb`), run the test, confirm it fails with a clear "missing" message listing `exportDb`. Then revert.

**Verify**: Test fails when an export is removed, passes when restored.

## Done criteria

- [ ] `tests/unit/localdb-shim-sync.test.js` exists with 2 tests
- [ ] Both tests pass against the current codebase
- [ ] The test fails when a shim export is removed (verified manually)
- [ ] `npm run build` exits 0
- [ ] No files outside the in-scope list modified

## STOP conditions

- Dynamic `import()` doesn't work in the vitest environment — fall back to static `import * as` at the top of the file.
- The test reveals missing exports that are currently in `db/index.js` but not in `localDb.js` — this means the shim is already stale. STOP and report; the missing exports should be added to `localDb.js` before the test can pass.

## Maintenance notes

- When adding a new function to any repo in `src/lib/db/repos/`, also add it to `src/lib/localDb.js`. This test will catch you if you forget.
- The test compares export NAMES, not signatures. A renamed function in `db/index.js` with the old name still in `localDb.js` will pass the "missing" test but fail the "phantom" test.
