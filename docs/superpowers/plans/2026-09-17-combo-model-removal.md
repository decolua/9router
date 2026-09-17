# Combo-aware Model Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Removing a model from a provider must ask whether to remove it from the combos that use it, and a model used by a combo must stay visible in the provider list.

**Architecture:** One pure module owns the model↔combo relationship and is shared by the browser and the server, so the dialog and the prune resolve the same names. One transactional repo function prunes every affected combo and the fusion judge together. A dedicated modal renders the three-way choice.

**Tech Stack:** Plain JavaScript (ESM), Next.js App Router, React, SQLite via `src/lib/db/` adapters, Vitest.

## Global Constraints

- Plain JavaScript (ESM), no TypeScript. `@/*` resolves to `src/*`.
- Spec: `docs/superpowers/specs/2026-09-17-combo-model-removal-design.md`.
- Tests run from `tests/`: `cd tests && npx vitest run <file>`.
- `tests/vitest.config.js` sets `environment: "node"` and the repo has no React testing library. **React components get no automated tests** — this matches existing practice. All testable logic lives in pure modules, which is why the design put it there.
- Commit style: Conventional Commits. End every commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Do not commit `open-sse/providers/capabilities.js` — it carries an unrelated user change.
- Judge the suite with `node tests/__baseline__/verify-no-regression.mjs <results.json>`, not a raw pass count. Two failures are known and pre-existing: `mimo-free.live.test.js` (live network) and `usage-event-identity.test.js`.

## File Structure

**Create**
- `src/shared/utils/comboModelLinks.js` — the model↔combo relationship: candidate names, the combo index, member pruning, and the visibility split. Pure, no I/O, importable from browser and server.
- `src/app/api/combos/remove-model/route.js` — POST endpoint.
- `src/app/(dashboard)/dashboard/providers/[id]/ComboImpactModal.js` — the dialog.
- `tests/unit/combo-model-links.test.js`
- `tests/unit/combo-remove-model.test.js`

**Modify**
- `src/lib/db/repos/combosRepo.js` — add `removeModelFromCombos`.
- `src/lib/db/index.js`, `src/lib/localDb.js` — export it.
- `src/app/(dashboard)/dashboard/providers/[id]/page.js` — handlers, visibility split, dialog wiring.
- `src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js` — `disabledInUse` prop.
- `src/app/(dashboard)/dashboard/combos/page.js` — empty-combo warning.

**Deviation from the spec, deliberate:** the spec named a `matchesModelCandidate(member, set)` helper. That is `set.has(member)` with extra steps. It is replaced by `pruneMembers(members, candidates) → { kept, removed }`, which is the operation the repo actually performs and is worth testing on its own.

---

### Task 1: The model↔combo relationship module

**Files:**
- Create: `src/shared/utils/comboModelLinks.js`
- Test: `tests/unit/combo-model-links.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `modelCandidates({ modelId, providerId, providerStorageAlias, providerDisplayAlias, alias, fullModel }) → string[]`
  - `buildComboIndex(combos) → Map<string, string[]>` (member value → combo names)
  - `comboNamesForCandidates(index, candidates) → string[]`
  - `pruneMembers(members, candidates) → { kept: string[], removed: string[] }`
  - `splitModelsByComboUsage(models, disabledIds, comboNamesForModel) → { visible: object[], hidden: object[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/combo-model-links.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  modelCandidates,
  buildComboIndex,
  comboNamesForCandidates,
  pruneMembers,
  splitModelsByComboUsage,
} from "@/shared/utils/comboModelLinks.js";

describe("modelCandidates", () => {
  it("lists every name a combo could have stored, without duplicates", () => {
    expect(modelCandidates({
      modelId: "gpt-5",
      providerId: "openrouter",
      providerStorageAlias: "or",
      providerDisplayAlias: "or",
      alias: "fast",
      fullModel: "or/gpt-5",
    })).toEqual(["or/gpt-5", "openrouter/gpt-5", "fast"]);
  });

  it("omits the alias when there is none", () => {
    expect(modelCandidates({
      modelId: "gpt-5",
      providerId: "openrouter",
      providerStorageAlias: "openrouter",
    })).toEqual(["openrouter/gpt-5"]);
  });

  it("returns nothing useful without a model id", () => {
    expect(modelCandidates({ providerId: "openrouter" })).toEqual([]);
  });
});

describe("buildComboIndex / comboNamesForCandidates", () => {
  const combos = [
    { name: "fast", models: ["or/gpt-5", "bai/m1"] },
    { name: "cheap", models: ["or/gpt-5"] },
    { name: "other", models: ["bai/m2"] },
  ];

  it("maps a member to every combo using it", () => {
    const index = buildComboIndex(combos);
    expect(comboNamesForCandidates(index, ["or/gpt-5"])).toEqual(["fast", "cheap"]);
  });

  it("dedups when two candidate names hit the same combo", () => {
    const index = buildComboIndex([{ name: "fast", models: ["or/gpt-5", "openrouter/gpt-5"] }]);
    expect(comboNamesForCandidates(index, ["or/gpt-5", "openrouter/gpt-5"])).toEqual(["fast"]);
  });

  it("returns empty for a model no combo uses", () => {
    expect(comboNamesForCandidates(buildComboIndex(combos), ["or/unused"])).toEqual([]);
  });

  it("tolerates a combo with no models", () => {
    expect(buildComboIndex([{ name: "empty", models: [] }]).size).toBe(0);
  });
});

describe("pruneMembers", () => {
  it("splits members into kept and removed, preserving order", () => {
    expect(pruneMembers(["a", "b", "c"], ["b"]))
      .toEqual({ kept: ["a", "c"], removed: ["b"] });
  });

  it("removes every matching name form", () => {
    expect(pruneMembers(["or/gpt-5", "openrouter/gpt-5", "bai/m1"], ["or/gpt-5", "openrouter/gpt-5"]))
      .toEqual({ kept: ["bai/m1"], removed: ["or/gpt-5", "openrouter/gpt-5"] });
  });

  it("matches exactly — a near miss is kept", () => {
    expect(pruneMembers(["or/gpt-5-mini"], ["or/gpt-5"]))
      .toEqual({ kept: ["or/gpt-5-mini"], removed: [] });
  });

  it("can empty the list", () => {
    expect(pruneMembers(["a"], ["a"])).toEqual({ kept: [], removed: ["a"] });
  });
});

describe("splitModelsByComboUsage", () => {
  const models = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("keeps enabled models visible", () => {
    const { visible, hidden } = splitModelsByComboUsage(models, [], () => []);
    expect(visible.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(hidden).toEqual([]);
  });

  it("hides a disabled model that no combo uses", () => {
    const { visible, hidden } = splitModelsByComboUsage(models, ["b"], () => []);
    expect(visible.map((m) => m.id)).toEqual(["a", "c"]);
    expect(hidden.map((m) => m.id)).toEqual(["b"]);
  });

  it("keeps a disabled model visible when a combo uses it", () => {
    const { visible, hidden } = splitModelsByComboUsage(
      models, ["b"], (m) => (m.id === "b" ? ["fast"] : []),
    );
    expect(visible.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(hidden).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run unit/combo-model-links.test.js`
Expected: FAIL — cannot resolve `@/shared/utils/comboModelLinks.js`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/utils/comboModelLinks.js`:

```js
// How a provider model links to the combos that use it.
//
// A model is reachable under several names — the storage alias, the display
// alias, the raw provider id, and any user alias — and a combo may have stored
// any of them. Every consumer must resolve the same set: if the dialog and the
// prune disagree, the dialog promises to remove a member the prune then fails
// to find, and the removal fails silently.
//
// Pure and I/O-free on purpose: the browser and the API route both import it.

export function modelCandidates({
  modelId,
  providerId,
  providerStorageAlias,
  providerDisplayAlias,
  alias,
  fullModel,
} = {}) {
  const out = [];
  const push = (value) => {
    if (value && !out.includes(value)) out.push(value);
  };
  push(fullModel);
  if (modelId) {
    for (const prefix of [providerDisplayAlias, providerStorageAlias, providerId]) {
      if (prefix) push(`${prefix}/${modelId}`);
    }
  }
  push(alias);
  return out;
}

export function buildComboIndex(combos) {
  const index = new Map();
  for (const combo of combos || []) {
    for (const member of combo?.models || []) {
      if (!member) continue;
      if (!index.has(member)) index.set(member, []);
      const names = index.get(member);
      if (!names.includes(combo.name)) names.push(combo.name);
    }
  }
  return index;
}

export function comboNamesForCandidates(index, candidates) {
  const seen = new Set();
  const out = [];
  for (const candidate of candidates || []) {
    for (const name of index.get(candidate) || []) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export function pruneMembers(members, candidates) {
  const set = candidates instanceof Set ? candidates : new Set(candidates || []);
  const kept = [];
  const removed = [];
  for (const member of members || []) {
    if (set.has(member)) removed.push(member);
    else kept.push(member);
  }
  return { kept, removed };
}

// A model used by a combo stays in the main list even while disabled: hiding it
// would leave the combo pointing at something absent from every list the user
// can see.
export function splitModelsByComboUsage(models, disabledIds, comboNamesForModel) {
  const disabled = disabledIds instanceof Set ? disabledIds : new Set(disabledIds || []);
  const visible = [];
  const hidden = [];
  for (const model of models || []) {
    if (!disabled.has(model.id)) {
      visible.push(model);
    } else if ((comboNamesForModel(model) || []).length > 0) {
      visible.push(model);
    } else {
      hidden.push(model);
    }
  }
  return { visible, hidden };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run unit/combo-model-links.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Lint**

Run: `npx eslint src/shared/utils/comboModelLinks.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/shared/utils/comboModelLinks.js tests/unit/combo-model-links.test.js
git commit -m "feat(combos): shared model-to-combo link resolution

The names a combo may have stored for one provider model were resolved
inline at three call sites, in shapes that differed between them. One
module now owns that set, so the dialog and the prune cannot disagree.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Transactional prune in the repo

**Files:**
- Modify: `src/lib/db/repos/combosRepo.js`
- Modify: `src/lib/db/index.js:35-39`
- Modify: `src/lib/localDb.js:14-15`
- Test: `tests/unit/combo-remove-model.test.js`

**Interfaces:**
- Consumes: `pruneMembers` from Task 1.
- Produces: `removeModelFromCombos(candidates) → Promise<Array<{ id, name, removed, remainingCount, judgeCleared }>>`, exported from `@/lib/db/index.js` and `@/lib/localDb`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/combo-remove-model.test.js`:

```js
// removeModelFromCombos against a real SQLite adapter, following the
// DATA_DIR + initDb() pattern used by the other db tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-combo-prune-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(async () => {
  for (const combo of await db.getCombos()) await db.deleteCombo(combo.id);
  await db.updateSettings({ comboStrategies: {} });
});

describe("removeModelFromCombos", () => {
  it("removes the member from every combo that uses it", async () => {
    await db.createCombo({ name: "fast", models: ["or/gpt-5", "bai/m1"] });
    await db.createCombo({ name: "cheap", models: ["or/gpt-5"] });
    await db.createCombo({ name: "other", models: ["bai/m2"] });

    const summary = await db.removeModelFromCombos(["or/gpt-5"]);

    expect(summary.map((s) => s.name).sort()).toEqual(["cheap", "fast"]);
    expect((await db.getComboByName("fast")).models).toEqual(["bai/m1"]);
    expect((await db.getComboByName("cheap")).models).toEqual([]);
    expect((await db.getComboByName("other")).models).toEqual(["bai/m2"]);
  });

  it("reports what it removed and what is left", async () => {
    await db.createCombo({ name: "fast", models: ["or/gpt-5", "bai/m1"] });
    const [entry] = await db.removeModelFromCombos(["or/gpt-5"]);
    expect(entry).toMatchObject({
      name: "fast",
      removed: ["or/gpt-5"],
      remainingCount: 1,
      judgeCleared: false,
    });
  });

  it("matches any of the candidate name forms", async () => {
    await db.createCombo({ name: "mixed", models: ["or/gpt-5", "openrouter/gpt-5", "bai/m1"] });
    await db.removeModelFromCombos(["or/gpt-5", "openrouter/gpt-5"]);
    expect((await db.getComboByName("mixed")).models).toEqual(["bai/m1"]);
  });

  it("leaves a combo empty rather than refusing", async () => {
    await db.createCombo({ name: "solo", models: ["or/gpt-5"] });
    const [entry] = await db.removeModelFromCombos(["or/gpt-5"]);
    expect(entry.remainingCount).toBe(0);
    expect((await db.getComboByName("solo")).models).toEqual([]);
  });

  it("clears a fusion judge naming the removed model", async () => {
    await db.createCombo({ name: "fusion", models: ["or/gpt-5", "bai/m1"] });
    await db.updateSettings({
      comboStrategies: { fusion: { fallbackStrategy: "fusion", judgeModel: "or/gpt-5" } },
    });

    const [entry] = await db.removeModelFromCombos(["or/gpt-5"]);

    expect(entry.judgeCleared).toBe(true);
    const settings = await db.getSettings();
    expect(settings.comboStrategies.fusion.judgeModel).toBeNull();
    expect(settings.comboStrategies.fusion.fallbackStrategy).toBe("fusion");
  });

  it("clears a judge even when that combo has no matching member", async () => {
    await db.createCombo({ name: "judged", models: ["bai/m1"] });
    await db.updateSettings({ comboStrategies: { judged: { judgeModel: "or/gpt-5" } } });

    const summary = await db.removeModelFromCombos(["or/gpt-5"]);

    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ name: "judged", removed: [], judgeCleared: true });
    expect((await db.getSettings()).comboStrategies.judged.judgeModel).toBeNull();
  });

  it("touches nothing when no combo uses the model", async () => {
    await db.createCombo({ name: "fast", models: ["bai/m1"] });
    const before = await db.getComboByName("fast");
    expect(await db.removeModelFromCombos(["or/unused"])).toEqual([]);
    expect((await db.getComboByName("fast")).updatedAt).toBe(before.updatedAt);
  });

  it("returns an empty summary for an empty candidate list", async () => {
    await db.createCombo({ name: "fast", models: ["or/gpt-5"] });
    expect(await db.removeModelFromCombos([])).toEqual([]);
    expect((await db.getComboByName("fast")).models).toEqual(["or/gpt-5"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run unit/combo-remove-model.test.js`
Expected: FAIL — `db.removeModelFromCombos is not a function`.

- [ ] **Step 3: Implement the repo function**

In `src/lib/db/repos/combosRepo.js`, add this import at the top, after the existing imports:

```js
import { pruneMembers } from "@/shared/utils/comboModelLinks.js";
```

Then append at the end of the file:

```js
/**
 * Remove a model from every combo that uses it, and clear any fusion judge
 * naming it, in ONE transaction.
 *
 * A loop over updateCombo would be transactional per combo, so a failure
 * midway would leave some combos pruned and others not — a partial edit to
 * the user's saved routing. The judge lives in the settings row, which is in
 * the same database, so one transaction covers both.
 *
 * @param {string[]} candidates - every name form the model may be stored under
 * @returns {Promise<Array<{id, name, removed, remainingCount, judgeCleared}>>}
 */
export async function removeModelFromCombos(candidates) {
  const set = new Set((candidates || []).filter(Boolean));
  if (set.size === 0) return [];

  const db = await getAdapter();
  const summary = [];

  db.transaction(() => {
    const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
    const now = new Date().toISOString();
    const byName = new Map();

    for (const row of rows) {
      const combo = rowToCombo(row);
      byName.set(combo.name, combo);
      const { kept, removed } = pruneMembers(combo.models, set);
      if (removed.length === 0) continue;
      db.run(
        `UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?`,
        [stringifyJson(kept), now, combo.id]
      );
      summary.push({
        id: combo.id,
        name: combo.name,
        removed,
        remainingCount: kept.length,
        judgeCleared: false,
      });
    }

    const settingsRow = db.get(`SELECT data FROM settings WHERE id = 1`);
    const settings = settingsRow ? parseJson(settingsRow.data, {}) : {};
    const strategies = settings.comboStrategies;
    if (!strategies || typeof strategies !== "object") return;

    let strategiesChanged = false;
    for (const [comboName, config] of Object.entries(strategies)) {
      if (!config || !set.has(config.judgeModel)) continue;
      strategies[comboName] = { ...config, judgeModel: null };
      strategiesChanged = true;
      const existing = summary.find((entry) => entry.name === comboName);
      if (existing) {
        existing.judgeCleared = true;
      } else {
        const combo = byName.get(comboName);
        summary.push({
          id: combo?.id ?? null,
          name: comboName,
          removed: [],
          remainingCount: combo ? combo.models.length : null,
          judgeCleared: true,
        });
      }
    }

    if (strategiesChanged) {
      db.run(
        `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        [stringifyJson({ ...settings, comboStrategies: strategies })]
      );
    }
  });

  return summary;
}
```

- [ ] **Step 4: Export it**

In `src/lib/db/index.js`, change the Combos export block to:

```js
// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo, removeModelFromCombos,
} from "./repos/combosRepo.js";
```

In `src/lib/localDb.js`, change the combos line in the named re-export list to:

```js
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo, removeModelFromCombos,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tests && npx vitest run unit/combo-remove-model.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 6: Lint**

Run: `npx eslint src/lib/db/repos/combosRepo.js src/lib/db/index.js src/lib/localDb.js`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/repos/combosRepo.js src/lib/db/index.js src/lib/localDb.js tests/unit/combo-remove-model.test.js
git commit -m "feat(combos): transactional prune of a model from every combo

Members and the fusion judge are removed in one transaction. A loop over
updateCombo is transactional per combo, so a failure midway would leave
the user's saved routing partly edited.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The API route

**Files:**
- Create: `src/app/api/combos/remove-model/route.js`
- Test: append to `tests/unit/combo-remove-model.test.js`

**Interfaces:**
- Consumes: `removeModelFromCombos` from Task 2.
- Produces: `POST /api/combos/remove-model`, body `{ candidates: string[] }` → `200 { combos: Summary[] }`, or `400 { error }` when `candidates` has no usable string.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/combo-remove-model.test.js`:

```js
describe("POST /api/combos/remove-model", () => {
  let POST;

  beforeAll(async () => {
    ({ POST } = await import("@/app/api/combos/remove-model/route.js"));
  });

  const call = (body) => POST({ json: async () => body });

  it("prunes and returns the summary", async () => {
    await db.createCombo({ name: "fast", models: ["or/gpt-5", "bai/m1"] });
    const res = await call({ candidates: ["or/gpt-5"] });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.combos).toHaveLength(1);
    expect(payload.combos[0]).toMatchObject({ name: "fast", remainingCount: 1 });
    expect((await db.getComboByName("fast")).models).toEqual(["bai/m1"]);
  });

  it("rejects a body with no usable candidate", async () => {
    for (const body of [{}, { candidates: [] }, { candidates: "or/gpt-5" }, { candidates: [null, ""] }]) {
      const res = await call(body);
      expect(res.status).toBe(400);
    }
  });

  it("answers 500 on a malformed body instead of throwing", async () => {
    const res = await POST({ json: async () => { throw new Error("bad json"); } });
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run unit/combo-remove-model.test.js`
Expected: FAIL — cannot resolve `@/app/api/combos/remove-model/route.js`.

- [ ] **Step 3: Write the route**

Create `src/app/api/combos/remove-model/route.js`:

```js
import { NextResponse } from "next/server";
import { removeModelFromCombos } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// POST /api/combos/remove-model  body: { candidates: string[] }
//
// `candidates` is every name form one provider model may be stored under in a
// combo; the caller builds it with modelCandidates() so both sides agree.
export async function POST(request) {
  try {
    const body = await request.json();
    const candidates = Array.isArray(body?.candidates)
      ? body.candidates.filter((value) => typeof value === "string" && value.length > 0)
      : [];

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "candidates must be a non-empty array of strings" },
        { status: 400 }
      );
    }

    const combos = await removeModelFromCombos(candidates);
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error removing model from combos:", error);
    return NextResponse.json({ error: "Failed to remove model from combos" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run unit/combo-remove-model.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Lint**

Run: `npx eslint src/app/api/combos/remove-model/route.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/combos/remove-model/route.js tests/unit/combo-remove-model.test.js
git commit -m "feat(combos): POST /api/combos/remove-model

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The dialog component

**Files:**
- Create: `src/app/(dashboard)/dashboard/providers/[id]/ComboImpactModal.js`

**Interfaces:**
- Consumes: `Modal`, `Button` from `@/shared/components`.
- Produces: default export `ComboImpactModal`, props
  `{ isOpen, subject, combos, mode, onRemoveAndProceed, onKeepAndProceed, onCancel }`
  where `combos` is `Array<{ name: string, remainingCount: number }>`,
  `mode` is `"disable" | "delete"`, and `subject` is a display string
  (one model id, or `"12 models"` for a bulk action).

No automated test: the repo has no React testing setup (`environment: "node"`, no testing-library). Everything with logic in it was pushed into Task 1 for exactly this reason.

- [ ] **Step 1: Write the component**

Create `src/app/(dashboard)/dashboard/providers/[id]/ComboImpactModal.js`:

```js
"use client";

import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

/**
 * Asked before a model that a combo uses is disabled or deleted.
 *
 * Disable offers three exits, because a disabled model can stay in a combo and
 * keep routing. Delete offers two: the model ceases to exist, so "keep" is not
 * on the table.
 */
export default function ComboImpactModal({
  isOpen,
  subject,
  combos = [],
  mode = "disable",
  onRemoveAndProceed,
  onKeepAndProceed,
  onCancel,
}) {
  const isDelete = mode === "delete";
  const emptied = combos.filter((combo) => combo.remainingCount === 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={isDelete ? "Delete model used by combos" : "Disable model used by combos"}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          {!isDelete && (
            <Button variant="secondary" onClick={onKeepAndProceed}>
              Disable, keep in combos
            </Button>
          )}
          <Button variant="danger" onClick={onRemoveAndProceed}>
            {isDelete ? "Remove and delete" : "Remove and disable"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-text-muted">
          <span className="font-mono">{subject}</span>{" "}
          {combos.length === 1 ? "is used by this combo:" : `is used by ${combos.length} combos:`}
        </p>

        <ul className="space-y-1">
          {combos.map((combo) => (
            <li key={combo.name} className="flex items-center justify-between gap-2">
              <code className="truncate font-mono text-xs">{combo.name}</code>
              {combo.remainingCount === 0 ? (
                <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-600 dark:text-amber-400">
                  would be left empty
                </span>
              ) : (
                <span className="shrink-0 text-[10px] text-text-muted">
                  {combo.remainingCount} model{combo.remainingCount === 1 ? "" : "s"} left
                </span>
              )}
            </li>
          ))}
        </ul>

        {emptied.length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            A combo with no models cannot route until you add one.
          </p>
        )}

        {!isDelete && (
          <p className="text-xs text-text-muted">
            Kept in a combo, the model still routes and stays listed here, but it is no longer
            advertised in <code className="font-mono">/v1/models</code>.
          </p>
        )}
      </div>
    </Modal>
  );
}

ComboImpactModal.propTypes = {
  isOpen: PropTypes.bool,
  subject: PropTypes.string,
  combos: PropTypes.arrayOf(
    PropTypes.shape({ name: PropTypes.string, remainingCount: PropTypes.number })
  ),
  mode: PropTypes.oneOf(["disable", "delete"]),
  onRemoveAndProceed: PropTypes.func,
  onKeepAndProceed: PropTypes.func,
  onCancel: PropTypes.func,
};
```

- [ ] **Step 2: Lint**

Run: `npx eslint "src/app/(dashboard)/dashboard/providers/[id]/ComboImpactModal.js"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/dashboard/providers/[id]/ComboImpactModal.js"
git commit -m "feat(combos): dialog for removing a model a combo uses

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire the provider page

**Files:**
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/page.js`
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: no new exported API.

- [ ] **Step 1: Replace the inline combo index with the shared helpers**

In `page.js`, add to the imports:

```js
import {
  modelCandidates,
  buildComboIndex,
  comboNamesForCandidates,
  splitModelsByComboUsage,
} from "@/shared/utils/comboModelLinks.js";
import ComboImpactModal from "./ComboImpactModal";
```

Replace the `comboNamesByValue` / `comboNamesFor` block (currently around lines 288-302, just after `fetchCombos`) with:

```js
  const comboIndex = buildComboIndex(combos);
  const comboNamesFor = (candidates) => comboNamesForCandidates(comboIndex, candidates);

  // A combo can store a model under its user alias, so the alias has to be part
  // of the candidate set. Resolving it inside candidatesForModelId rather than
  // asking each call site to pass it is what keeps the dialog and the prune
  // from disagreeing.
  const aliasForModelId = (modelId) => {
    const full = `${providerStorageAlias}/${modelId}`;
    const legacy = `${providerId}/${modelId}`;
    return Object.entries(modelAliases).find(([, m]) => m === full || m === legacy)?.[0] || null;
  };

  const candidatesForModelId = (modelId) =>
    modelCandidates({
      modelId,
      providerId,
      providerStorageAlias,
      providerDisplayAlias,
      alias: aliasForModelId(modelId),
      fullModel: `${providerStorageAlias}/${modelId}`,
    });
```

- [ ] **Step 2: Add the dialog state and the shared prune helper**

Next to the other `useState` calls (near `const [confirmState, setConfirmState] = useState(null);`, around line 80), add:

```js
  const [comboImpact, setComboImpact] = useState(null);
```

Then, next to the disable handlers, add:

```js
  // Combos affected by acting on these model ids, with the count each would be
  // left with. The count is what the dialog uses to warn about emptying one.
  const comboImpactFor = (modelIds) => {
    const candidates = modelIds.flatMap((id) => candidatesForModelId(id));
    const candidateSet = new Set(candidates);
    const affected = [];
    for (const combo of combos) {
      const remaining = (combo.models || []).filter((m) => !candidateSet.has(m));
      if (remaining.length === (combo.models || []).length) continue;
      affected.push({ name: combo.name, remainingCount: remaining.length });
    }
    return { candidates, affected };
  };

  const pruneCombos = async (candidates) => {
    try {
      const res = await fetch("/api/combos/remove-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidates }),
      });
      if (!res.ok) return false;
      await fetchCombos();
      return true;
    } catch (error) {
      console.log("Error removing model from combos:", error);
      return false;
    }
  };
```

- [ ] **Step 3: Route the three actions through the dialog**

Replace `handleDisableModel` (around line 230) with:

```js
  const disableModelIds = async (ids) => {
    try {
      const res = await fetch("/api/models/disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, ids }),
      });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.log("Error disabling model:", error);
    }
  };

  const handleDisableModel = async (modelId) => {
    const { candidates, affected } = comboImpactFor([modelId]);
    if (affected.length === 0) {
      await disableModelIds([modelId]);
      return;
    }
    setComboImpact({
      subject: modelId,
      mode: "disable",
      combos: affected,
      onRemoveAndProceed: async () => {
        setComboImpact(null);
        await pruneCombos(candidates);
        await disableModelIds([modelId]);
      },
      onKeepAndProceed: async () => {
        setComboImpact(null);
        await disableModelIds([modelId]);
      },
    });
  };
```

Replace the body of `handleDisableAll` (around line 251) with:

```js
  const handleDisableAll = async (ids) => {
    if (!ids.length) return;
    const { candidates, affected } = comboImpactFor(ids);
    if (affected.length === 0) {
      setConfirmState({
        title: "Disable All Models",
        message: `Disable all ${ids.length} model(s)?`,
        onConfirm: async () => {
          setConfirmState(null);
          await disableModelIds(ids);
        },
      });
      return;
    }
    setComboImpact({
      subject: `${ids.length} models`,
      mode: "disable",
      combos: affected,
      onRemoveAndProceed: async () => {
        setComboImpact(null);
        await pruneCombos(candidates);
        await disableModelIds(ids);
      },
      onKeepAndProceed: async () => {
        setComboImpact(null);
        await disableModelIds(ids);
      },
    });
  };
```

Replace `handleDeleteCustomModel` (line 612) with:

```js
  const deleteCustomModelNow = async (modelId, type, providerAliasOverride) => {
    try {
      const params = new URLSearchParams({ providerAlias: providerAliasOverride, id: modelId, type });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (error) {
      console.log("Error deleting custom model:", error);
    }
  };

  const handleDeleteCustomModel = async (modelId, type = "llm", providerAliasOverride = providerStorageAlias) => {
    const { candidates, affected } = comboImpactFor([modelId]);
    if (affected.length === 0) {
      await deleteCustomModelNow(modelId, type, providerAliasOverride);
      return;
    }
    // No "keep" exit: the model is about to stop existing.
    setComboImpact({
      subject: modelId,
      mode: "delete",
      combos: affected,
      onRemoveAndProceed: async () => {
        setComboImpact(null);
        await pruneCombos(candidates);
        await deleteCustomModelNow(modelId, type, providerAliasOverride);
      },
    });
  };
```

- [ ] **Step 4: Apply the visibility rule**

Replace these two lines (around line 1226):

```js
    const displayModels = allModels.filter((m) => !disabledSet.has(m.id));
    const disabledDisplayModels = allModels.filter((m) => disabledSet.has(m.id));
```

with:

```js
    // A model a combo uses stays in the main list even while disabled — hiding
    // it would leave the combo pointing at something absent from every list.
    const { visible: displayModels, hidden: disabledDisplayModels } = splitModelsByComboUsage(
      allModels,
      disabledSet,
      (m) => comboNamesFor(candidatesForModelId(m.id)),
    );
```

- [ ] **Step 5: Mark the kept-but-disabled rows**

In the `displayModels.map(...)` block (around line 1270), add this prop to `ModelRow`:

```js
            disabledInUse={disabledSet.has(model.id)}
```

- [ ] **Step 6: Render the dialog**

Just before the `{/* Confirm Modal */}` block near the end of the JSX (around line 2030), add:

```js
      <ComboImpactModal
        isOpen={!!comboImpact}
        subject={comboImpact?.subject}
        combos={comboImpact?.combos || []}
        mode={comboImpact?.mode || "disable"}
        onRemoveAndProceed={comboImpact?.onRemoveAndProceed}
        onKeepAndProceed={comboImpact?.onKeepAndProceed}
        onCancel={() => setComboImpact(null)}
      />
```

- [ ] **Step 7: Accept the marker in ModelRow**

In `ModelRow.js`, add `disabledInUse = false` to the destructured props, and render a chip next to the combo badge (inside the same container as the existing `comboNames.length > 0` badge, around line 40):

```js
            {disabledInUse && (
              <span className="inline-flex items-center rounded bg-black/10 px-1 py-px font-mono text-[9px] text-text-muted dark:bg-white/10">
                disabled
              </span>
            )}
```

Add to `ModelRow.propTypes`:

```js
  disabledInUse: PropTypes.bool,
```

- [ ] **Step 8: Lint**

Run: `npx eslint "src/app/(dashboard)/dashboard/providers/[id]/page.js" "src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js"`
Expected: no output.

- [ ] **Step 9: Verify the page still builds**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds. If it fails, the error names the file and line.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(dashboard)/dashboard/providers/[id]/page.js" "src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js"
git commit -m "feat(providers): ask before orphaning a combo member

Disabling a model, Disable All and deleting a custom model now resolve the
combos that use the model and ask before acting. A model a combo uses stays
in the main list even while disabled, marked, instead of dropping into the
collapsed disabled section where the combo points at something invisible.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Warn on an empty combo

**Files:**
- Modify: `src/app/(dashboard)/dashboard/combos/page.js:313-314`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

Pruning can now leave a combo with no members, and such a combo cannot route.
The existing label is a neutral muted note; it becomes a warning.

- [ ] **Step 1: Replace the label**

Replace:

```js
              {combo.models.length === 0 ? (
                <span className="text-xs text-text-muted italic">No models</span>
              ) : (
```

with:

```js
              {combo.models.length === 0 ? (
                <span
                  className="inline-flex items-center rounded bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-600 dark:text-amber-400"
                  title="This combo has no models and cannot route until you add one"
                >
                  No models — cannot route
                </span>
              ) : (
```

- [ ] **Step 2: Lint**

Run: `npx eslint "src/app/(dashboard)/dashboard/combos/page.js"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/dashboard/combos/page.js"
git commit -m "fix(combos): flag an empty combo as unable to route

Pruning a member can now empty a combo, and an empty combo fails at routing
time. The neutral \"No models\" note becomes a warning.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Full verification

**Files:** none.

- [ ] **Step 1: Run the full suite**

```bash
cd tests && npx vitest run --reporter=json --outputFile=/tmp/combo-removal-results.json 2>&1 | tail -5
```

- [ ] **Step 2: Check against the baseline**

Run: `cd tests && node __baseline__/verify-no-regression.mjs /tmp/combo-removal-results.json`
Expected: at most the two known failures — `mimo-free.live.test.js` and `usage-event-identity.test.js`. Any other pass→fail is a regression to fix before continuing.

- [ ] **Step 3: Check the other baselines**

```bash
cd tests && for v in verify-providers verify-alias verify-oauth-urls; do node __baseline__/$v.mjs 2>&1 | tail -1; done
```

Expected: three lines, each starting with `✅`.

- [ ] **Step 4: Update the changelog**

Add to the `## Fixes` list at the top of `CHANGELOG.md`:

```markdown
- **Providers**: removing a model now asks what to do with the combos that use it. The provider page defines which models a combo may contain, but members already saved were never re-validated against it: disabling a model left the combo pointing at something that had vanished from every list while still routing, and deleting a custom model left the reference dangling. Disabling offers a third choice — keep it in the combo — and a model a combo uses now stays in the provider's main list even while disabled, marked, instead of dropping into the collapsed disabled section. Members and any fusion judge naming the model are pruned in one transaction, so a failure cannot leave the saved routing partly edited.
```

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): record combo-aware model removal

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
