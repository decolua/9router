# Codex post-audit fix report

Date: 2026-09-17
Audit input: `.superpowers/sdd/grok-audit-report.md`
Implementation commit: `fac40045 fix(providers): coordinate bulk combo model removal`

## F1 — bulk Select+Delete waits for one combo-impact decision

In `page.js`, `handleBulkDeleteCustomModels` now snapshots the selected ids and resolves each
id to a direct action before calling `comboImpactFor(ids)`. Custom rows use
`deleteCustomModelNow`, legacy alias rows use `handleDeleteAlias`, and catalog rows use
`disableModelIds([id])`. A non-affected selection runs all actions directly. An affected
selection opens exactly one `ComboImpactModal` with the union candidates and affected combos;
the mode is `delete` when any action deletes, otherwise `disable`. Disable-only bulk selections
also get the keep path. Selection state is cleared once after dispatching.

The compatible-model bulk flow is lifted to the parent as
`handleBulkDeleteCompatibleModels(rows)`. The child still owns only its selection state and
still routes single-row deletion through the existing `onDeleteCustomModel` / `onDeleteAlias`
props, so single-row delete behavior remains unchanged. The child awaits the parent bulk
dispatch, then clears its selection once.

## F2 — prune failure gates the second mutation

All five affected `onRemoveAndProceed` callbacks now check the boolean returned by
`pruneCombos(candidates)` before disabling or deleting. On failure they stop and show a minimal
visible alert; the model mutation is not attempted. Updated callers are:

- `handleDisableModel`
- `handleDisableAll`
- `handleDeleteCustomModel`
- `handleBulkDeleteCustomModels`
- `handleBulkDeleteCompatibleModels`

## F3 — compatible-model badge uses the shared candidate resolver

`candidatesForModelId` is passed from `page.js` to `CompatibleModelsSection`. The badge now
calls `comboNamesFor(candidatesForModelId(id))`, covering the same provider-id, storage-alias,
display-alias, and user-alias candidates as the action flow. Both resolver props are required.

## F4 — known limitation, intentionally not fixed

`comboImpactFor` remains member-centric and scans `combo.models` only. The provider page does
not load `comboStrategies`, so a model used only as a fusion `judgeModel` can still skip the
dialog. The repo-side removal handler already clears judge references, but this page cannot
include that usage in its preflight without loading the strategy data. This is outside the
specified member-centric dialog scope and is documented as a possible follow-up; no F4 code was
changed.

## Verification

The focused component orchestration has no component-level test seam in the repository. The
available combo unit tests exercise the shared candidate/prune behavior, but cannot drive React
modal callback state. No out-of-scope test file was added.

### Lint

Command:

```text
npx eslint "src/app/(dashboard)/dashboard/providers/[id]/page.js" "src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js"
```

Raw output:

```text
npm notice run 9router-app@0.5.75-enhanced.1 npx
npm notice run 'eslint' src/app/(dashboard)/dashboard/providers/[id]/page.js src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js

/home/scursel/9router-enhanced/src/app/(dashboard)/dashboard/providers/[id]/page.js
   583:5  error  Error: Calling setState synchronously within an effect can trigger cascading renders
   615:7  error  Error: Calling setState synchronously within an effect can trigger cascading renders
  1153:5  error  Error: Calling setState synchronously within an effect can trigger cascading renders

✖ 3 problems (3 errors, 0 warnings)
```

The three page errors are pre-existing baseline findings. `CompatibleModelsSection.js` has no
lint findings; no new problems were introduced.

### Focused unit tests

Command:

```text
cd tests && npx vitest run unit/combo-model-links.test.js unit/combo-remove-model.test.js
```

Raw output:

```text
npm notice run 9router-tests@1.0.0 npx
npm notice run 'vitest' run unit/combo-model-links.test.js unit/combo-remove-model.test.js

 RUN  v4.1.11 /home/scursel/9router-enhanced/tests

 Test Files  2 passed (2)
      Tests  25 passed (25)
   Start at  23:28:26
   Duration 1.38s (transform 502ms, setup 0ms, import 231ms, tests 862ms, environment 2ms)
```

### Production build

Command:

```text
npm run build
```

Exit: `0`

Raw tail:

```text
✓ Compiled successfully in 32.8s
  Running TypeScript ...
  Finished TypeScript in 15ms ...
  Collecting page data using 3 workers ...
  Generating static pages using 3 workers (139/139) in 3.5s
  Finalizing page optimization ...
  Collecting build traces ...

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

npm notice run 9router-app@0.5.75-enhanced.1 postbuild
npm notice run node scripts/copy-standalone-assets.mjs
[standalone-assets] Copied static assets to /home/scursel/9router-enhanced/.next/standalone/.next/static
[standalone-assets] Copied public assets to /home/scursel/9router-enhanced/.next/standalone/public
[standalone-assets] Copied custom-server.js to /home/scursel/9router-enhanced/.next/standalone/custom-server.js
```

### Commit log

Command:

```text
git log --oneline --decorate -1
```

Raw output for the implementation commit:

```text
fac40045 (HEAD -> enhanced/0.5.69) fix(providers): coordinate bulk combo model removal
```

### Final status

Command:

```text
git status --short
```

Raw output:

```text
 M open-sse/providers/capabilities.js
?? tests/translator/__snapshots__/golden-url-header.test.js
```

The two status entries are pre-existing and were not staged or modified.
