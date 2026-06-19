# Plan 004: Bound `ROUNDROBIN_CURSORS` Map with eviction

> **Executor instructions**: Follow step by step. Run every verification command. STOP on mismatch.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `1271db0`, 2026-06-19 (target file modified in working tree: `M open-sse/services/modelFallback.js`)

## Why this matters

`ROUNDROBIN_CURSORS` is a module-level `Map` keyed by `primaryModelStr`. The comment at line 64 claims "bounded by user config" but deleted fallback rules leave orphan cursor entries forever. In a long-lived process (systemd standalone server), this is a slow memory leak. While each entry is small (string key + number), a deploy running for weeks with rules created and deleted will accumulate stale entries. The fix: cap the map size with simple LRU eviction, and clear it when fallback settings are updated.

## Current state

`open-sse/services/modelFallback.js` (lines 63-66):

```js
// Module-level cursor map for roundrobin mode. Keyed by primaryModelStr so
// each primary rotates independently. Bounded by the number of primaries the
// user configures — never grows unboundedly in practice.
const ROUNDROBIN_CURSORS = new Map();
```

The cursor is read and written in `getModelFallbacks` (lines 50-58):

```js
} else if (strategy === "roundrobin" && out.length > 1) {
    const next = (ROUNDROBIN_CURSORS.get(primaryModelStr) ?? 0) % out.length;
    ROUNDROBIN_CURSORS.set(primaryModelStr, (next + 1) % out.length);
    // ... rotate
}
```

No eviction, no clear-on-settings-change, no size cap.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `cd /home/cortexos/Developer/github.com/bloodf/9router && npx vitest run --config tests/vitest.config.js tests/unit/modelFallback.test.js` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `open-sse/services/modelFallback.js`
- `tests/unit/modelFallback.test.js` (add eviction test only)

**Out of scope**:
- Do NOT change the roundrobin rotation logic itself (the cursor advance).
- Do NOT change the public API (`getModelFallbacks`, `runWithModelFallback` signatures).

## Steps

### Step 1: Add max-size constant and eviction on write

Replace the `ROUNDROBIN_CURSORS` declaration and the write site:

```js
// Module-level cursor map for roundrobin mode. Keyed by primaryModelStr so
// each primary rotates independently. Capped to prevent unbounded growth from
// deleted fallback rules; oldest entries evicted when cap is exceeded.
const ROUNDROBIN_MAX_CURSORS = 500;
const ROUNDROBIN_CURSORS = new Map();

function setRoundrobinCursor(key, value) {
  // LRU: delete-then-set moves the key to insertion-order end (most recent)
  ROUNDROBIN_CURSORS.delete(key);
  ROUNDROBIN_CURSORS.set(key, value);
  // Evict oldest entry if over cap
  if (ROUNDROBIN_CURSORS.size > ROUNDROBIN_MAX_CURSORS) {
    const oldestKey = ROUNDROBIN_CURSORS.keys().next().value;
    ROUNDROBIN_CURSORS.delete(oldestKey);
  }
}
```

Then replace `ROUNDROBIN_CURSORS.set(primaryModelStr, ...)` with `setRoundrobinCursor(primaryModelStr, ...)` in `getModelFallbacks`.

The `.get()` call stays unchanged.

### Step 2: Export a clear function for settings-change hooks

```js
/** Clear all roundrobin cursors — call when fallback settings are updated. */
export function resetRoundrobinCursors() {
  ROUNDROBIN_CURSORS.clear();
}
```

### Step 3: Add eviction test

In `tests/unit/modelFallback.test.js`, add to the `getModelFallbacks (ordered list)` describe block:

```js
it("roundrobin cursor map does not exceed 500 entries", () => {
  for (let i = 0; i < 600; i += 1) {
    getModelFallbacks(`RR-STRESS-${i}`, {
      [`RR-STRESS-${i}`]: { fallbacks: ["A", "B"], mode: "roundrobin", enabled: true },
    });
  }
  // Map is internal — verify indirectly: first 100 entries were evicted, last 500 remain
  // Re-call the first entry; cursor should have reset to 0 (evicted)
  const first = getModelFallbacks("RR-STRESS-0", {
    "RR-STRESS-0": { fallbacks: ["A", "B"], mode: "roundrobin", enabled: true },
  });
  expect(first).toEqual(["A", "B"]); // cursor reset → starts at 0
});
```

**Verify**: `npx vitest run --config tests/vitest.config.js tests/unit/modelFallback.test.js` → all pass including the new test.

## Done criteria

- [ ] `ROUNDROBIN_MAX_CURSORS` constant exists
- [ ] `setRoundrobinCursor` evicts oldest when over cap
- [ ] `resetRoundrobinCursors` exported
- [ ] New eviction test passes
- [ ] All existing modelFallback tests still pass (no regression)
- [ ] `npm run build` exits 0

## STOP conditions

- The roundrobin rotation logic at lines 50-58 doesn't match the excerpt (engine has drifted).
- Changing `.set()` to `setRoundrobinCursor()` breaks the existing roundrobin test — the rotation must remain identical for non-evicted entries.

## Maintenance notes

- `resetRoundrobinCursors()` should be called from the model-fallbacks API route (`PATCH /api/model-fallbacks`) after settings are updated — this clears stale cursors for deleted/changed primaries. This is a one-line addition to the route handler and is left as a follow-up since the route is not in scope for this plan.
- The 500-entry cap is generous (typical users have <20 fallback rules). Adjust if production telemetry shows different.
