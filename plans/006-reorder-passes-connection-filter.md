# Plan 006: Reorder `passesConnectionFilter` after `getProviderStats`

> **Executor instructions**: Follow step by step. STOP on mismatch.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness
- **Planned at**: commit `1271db0`, 2026-06-19 (target file modified in working tree: `M src/app/(dashboard)/dashboard/providers/page.js`)

## Why this matters

`passesConnectionFilter` is defined at line 123 as a `const` arrow function that closes over `getProviderStats`, which is defined later at line 175. At runtime this works because `passesConnectionFilter` is only *called* in the entry-builder functions (lines 265+), long after `getProviderStats` has been initialized. But it's a temporal dead zone (TDZ) footgun: if any future edit moves a `passesConnectionFilter` call earlier (above `getProviderStats`), the code crashes with `ReferenceError: Cannot access 'getProviderStats' before initialization`. Moving the function definition after `getProviderStats` eliminates the risk.

## Current state

`src/app/(dashboard)/dashboard/providers/page.js` — order of definitions:

```
Line 117:  const matchSearch = (name) => ...
Line 121:  const passesConnectionFilter = (providerId, authType) => {
Line 125:    return getProviderStats(providerId, authType).connected > 0;
Line 126:  };
Line 128:  const sortByPriority = (entries, authType) => ...
...
Line 175:  const getProviderStats = (providerId, authType) => {
...
Line 217:  };
```

`passesConnectionFilter` references `getProviderStats` but is defined 52 lines before it.

## Scope

**In scope**:
- `src/app/(dashboard)/dashboard/providers/page.js` — move one function definition

**Out of scope**:
- Do NOT change any logic, function bodies, or entry-builder code.
- Do NOT touch any other file.

## Steps

### Step 1: Cut `passesConnectionFilter` from its current location

Remove lines 121-126 (the `passesConnectionFilter` const and its comment).

### Step 2: Paste it after `getProviderStats` definition

Insert immediately after the closing `};` of `getProviderStats` (line 217):

```js
  // When connectedOnly is on, drop providers with zero connected
  // accounts/keys. authType matches getProviderStats.
  const passesConnectionFilter = (providerId, authType) => {
    if (!connectedOnly) return true;
    return getProviderStats(providerId, authType).connected > 0;
  };
```

### Step 3: Build

```bash
cd /home/cortexos/Developer/github.com/bloodf/9router && npm run build
```

**Verify**: exit 0. The function now appears after `getProviderStats` in source order.

## Done criteria

- [ ] `passesConnectionFilter` is defined after `getProviderStats` in source order
- [ ] No behavioral change (the function body is identical)
- [ ] `npm run build` exits 0
- [ ] No other files modified

## STOP conditions

- Line numbers have drifted (the file was edited since the plan). Locate by searching for `passesConnectionFilter` and `const getProviderStats` instead.

## Maintenance notes

- This is a purely defensive reorder. No functional change. A reviewer should confirm the function body was moved verbatim.
