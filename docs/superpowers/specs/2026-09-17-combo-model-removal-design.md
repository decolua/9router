# Combo-aware model removal

**Date:** 2026-09-17
**Status:** approved, not yet implemented

## Problem

The provider page defines the universe of models a user can pick when building
a combo: `ModelSelectModal` filters out models disabled for that provider. But
members already saved in a combo are never re-validated against that universe.

Disable a model on the provider page and the combo keeps pointing at it. The
combo still routes — disabling only removes a model from `/v1/models`, it does
not block routing — so nothing breaks loudly. The model simply disappears from
every list the user looks at while staying live in the combo. Deleting a custom
model is worse: the reference dangles with nothing behind it.

Two rules follow, both from the user:

1. Removing a model that belongs to a combo must ask whether to remove it from
   the combo as well.
2. A model that belongs to a combo must stay visible in the provider list.

## Scope

Triggers: disable a single model, Disable All, delete a custom model.

Out of scope: deleting an alias. A combo can reference an alias, so the same
dangling reference is possible there, but the user excluded it from this pass.

## Behaviour

### Resolving the affected combos

Before acting, the UI resolves which combos reference the model. A model is
reachable under several names — `providerAlias/id`, `providerStorageAlias/id`,
`providerId/id`, and its alias — and a combo may store any of them. The set of
names is the *candidate set*.

No affected combo means no dialog: the action proceeds exactly as it does today.

### Dialog — disable

Lists the affected combos, marking any that would be left with no members, and
offers three exits:

| Exit | Effect |
|---|---|
| Remove from combos and disable | Prune every affected combo in one transaction, then disable |
| Disable and keep in combos | Disable only. The model leaves `/v1/models` but stays in the provider's main list, marked |
| Cancel | Nothing happens |

### Dialog — delete custom model

Two exits. "Keep visible" is impossible because the model ceases to exist:

| Exit | Effect |
|---|---|
| Remove from combos and delete | Prune, then delete |
| Cancel | Nothing happens |

### Multiple combos

All-or-nothing. The dialog names every affected combo and the user decides once.
No per-combo checkboxes.

### Visibility (rule 2)

Today the provider page partitions models into `displayModels` and
`disabledDisplayModels` by membership in `disabledSet`, and the disabled group
renders in a collapsed section at the bottom.

New rule: **disabled AND used by a combo ⇒ stays in the main list**, carrying
the combo badge that already exists plus a "disabled" marker. Only models that
are disabled and used by nothing fall into the collapsed section.

### Empty combos

Pruning proceeds even when it empties a combo.

The combos page already renders `No models` for an empty combo, but in muted
italic — a neutral note. Now that an empty combo is a state the user can reach
by pruning, and one that breaks routing, that label is raised to a warning
treatment. No new component; the existing branch changes its styling and
wording.

**Known consequence, accepted by the user:** an empty combo currently fails at
routing time with `400 "Invalid model format"`, because `getComboModels`
returns null for a combo with no members and the caller falls through to the
"not a model, not a combo" branch. That message does not describe the situation.
Improving it is deliberately not part of this work.

### Fusion judge

`settings.comboStrategies[comboName].judgeModel` can name the removed model.
That reference is cleared in the same transaction as the member pruning.

## Architecture

### `combosRepo.removeModelFromCombos(candidates)`

The core. One `db.transaction()` spanning both the `combos` table and the
`settings` row — they live in the same SQLite database, so one transaction
covers both.

For each combo: drop members matching the candidate set; write only if changed.
Then read settings and clear any `comboStrategies[*].judgeModel` that matches.

Returns a summary so the UI can report and tests can assert:

```js
[{ id, name, removed: ["openrouter/gpt-5"], remainingCount: 2, judgeCleared: false }]
```

A bulk helper is required rather than a loop over `updateCombo`. `updateCombo`
is transactional per combo, so pruning N combos in a loop can fail midway and
leave some pruned and others not — a partial edit to the user's saved routing.

Name matching is extracted as a pure function, `matchesModelCandidate`, so it
is testable without a database.

### `POST /api/combos/remove-model`

Body `{ candidates: [...] }`. Calls the repo, returns the summary.

### `ComboImpactModal.js`

Colocated in `providers/[id]/`, beside `ModelRow.js` and `ConnectionRow.js`.

The shared `ConfirmModal` takes exactly two buttons and renders its body from a
`message` string. This dialog needs three exits and a *list* of combos with
per-combo annotations ("would become empty"). A dedicated component is cleaner
than widening the shared one for a single caller.

Props: `isOpen`, `subject`, `combos`, `mode` (`"disable"` | `"delete"`),
`onRemoveAndProceed`, `onKeepAndProceed`, `onCancel`.

`subject` describes what is being removed, because Disable All acts on many
models at once: either one model id, or a count ("12 models"). The combo list
is the union across every model in the action, and the candidate set passed to
the prune is likewise the union — one dialog and one transaction for the whole
bulk action, not one per model.

### `page.js`

`handleDisableModel`, `handleDisableAll` and the custom-model delete handler
resolve affected combos first, then either open the dialog or proceed directly.

### `ModelRow`

One optional prop to render the "disabled but in use" marker.

### Extracting `modelCandidates(model)`

The candidate array is currently built inline at three call sites in `page.js`,
in shapes that differ slightly between them. It is extracted into one helper.

This is not incidental refactoring. The dialog and the prune must agree on the
exact key set: if they diverge, the dialog promises to remove a member that the
prune then fails to find, and the removal fails silently.

## Testing

| Unit | Covers |
|---|---|
| `matchesModelCandidate`, `modelCandidates` | Pure. Prefixed and bare forms, alias form, near-miss that must not match |
| `removeModelFromCombos` | Against the `sql.js` adapter: several combos in one transaction, judge cleared alongside, combo left empty, candidate matching nothing |
| Visibility split | The partition is extracted out of the render into a pure function and tested without React |
| `POST /api/combos/remove-model` | Request and response contract |

## Decisions taken, with the reasoning

- **Server-side prune over a client-side loop.** A loop over the existing
  `PUT /api/combos/[id]` needs no new server code, but it is not atomic, it
  duplicates candidate matching in the browser, and it races with a second open
  tab. Atomicity is the point here.
- **Ask rather than prune automatically.** Explicitly requested.
- **All-or-nothing over per-combo selection.** Simpler to use and to implement;
  per-combo control is speculative until there is a reason for it.
