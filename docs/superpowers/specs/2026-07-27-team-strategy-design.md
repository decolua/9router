# Team Strategy — Design

**Date:** 2026-07-27
**Status:** Approved (design)
**Area:** `open-sse/services/` — combo routing engine

## Summary

Add a 5th combo strategy, `"team"`, alongside the existing `fallback`,
`round-robin`, and `fusion` strategies. A single `/v1/chat/completions` (or
Claude/Gemini/Responses) request whose model resolves to a `team` combo fans
out into an internal multi-agent pipeline — Planner → (Plan Reviewer) →
Worker → Reviewers → Judge/Synthesise → feedback loop → Compressor — and only
the final compressed answer streams back to the client.

The four routing strategies the feature description mentioned
(round-robin, fallback, judge, panel) **already exist** in
`open-sse/services/combo.js`:
- round-robin → `getRotatedModels`
- fallback → `handleComboChat`
- judge + panel → `handleFusionChat` / `buildJudgePrompt`

This spec covers only the new orchestration layer (`team`), which **reuses**
those existing pieces as primitives (fallback for single-slot roles, panel
collection for reviewers, judge-style synthesis).

## Goals

- One API call transparently runs a planner/worker/reviewer team and returns
  one answer. No new public API surface, no client changes.
- Every role is configurable per combo; sensible defaults when unset.
- Single-slot roles (planner, worker, judge, compressor) support a **fallback
  chain** (array of models tried in order until one succeeds).
- Reviewers run as a **panel** (parallel fan-out).
- Bounded loop: max iterations + numeric pass threshold.
- Fail-open at every stage — a failed role degrades the pipeline, never 500s
  the whole request unless nothing at all could answer.

## Non-Goals (YAGNI)

- **No dashboard UI this pass.** Configuration is via `settings.comboStrategies`
  (the same object the dashboard already persists). A visual team builder is a
  later, separate spec.
- **No interactive human-in-the-loop.** "Send to User" / "Plan feedback" nodes
  in the original diagram resolve to internal-only stages; the only
  client-facing output is the final streamed answer.
- **Chat only.** Image / TTS / fetch / embeddings endpoints keep their existing
  strategies. `team` is ignored (treated as `fallback`) outside chat.
- No persistence of intermediate artifacts (plans, critiques) beyond logs.

## Configuration

Extends the existing `settings.comboStrategies[comboName]` object. The combo's
own `models[]` array remains the canonical model list; `team.*` fields are role
overrides.

```jsonc
"comboStrategies": {
  "my-team": {
    "fallbackStrategy": "team",
    "team": {
      "planner":    ["gpt-5", "claude-opus-4-8"], // string | string[]; [] = fallback chain
      "worker":     ["claude-sonnet-5", "gpt-5"],  // string | string[]; [] = fallback chain
      "reviewers":  ["gpt-5", "gemini-3-pro"],     // string[]; panel (parallel)
      "judge":      "claude-opus-4-8",             // string | string[]; synthesise + score
      "compressor": "claude-haiku-4-5",            // string | string[]; "turn into haiku"
      "maxIters":   2,                             // loop cap; default 2
      "passThreshold": 8,                          // 0-10; default 8
      "planReview": true                           // vet plan before worker; default true
    }
  }
}
```

### Defaults when a field is omitted

| Role       | Default                                    |
|------------|--------------------------------------------|
| planner    | `models[0]`                                |
| worker     | `models[0]`                                |
| reviewers  | `models` (the full combo list)             |
| judge      | `models[0]`                                |
| compressor | resolved `judge`                           |
| maxIters   | `2`                                        |
| passThreshold | `8`                                     |
| planReview | `true`                                     |

A role value may be a string (single model) or an array (fallback chain).
`reviewers` is always treated as a parallel panel, never a fallback chain.

## Pipeline

All stages run **internally, non-streaming, tools stripped** (like fusion's
panel calls) except the final Compressor call, which keeps the client's
original `stream` flag and tools so streaming + downstream tool use still work.

```
Planner ── plan text
   │  (if planReview) Plan Reviewer vets + revises the plan once   [internal]
   ▼
┌─ LOOP (iteration ≤ maxIters) ───────────────────────────────────┐
│ Worker    ── answer, given (plan + prior consolidated feedback)  │
│ Reviewers ── critiques, parallel fan-out via collectPanel        │
│ Judge     ── { score: 0..10, feedback: string }  [synthesise]    │
│ score ≥ passThreshold ? break : append feedback, next iteration ─┘
▼  (pass, OR cap reached → keep highest-scored iteration)
Compressor ── condense the approved answer into tight final form
   ▼  ← keeps client stream flag + tools = the response "Sent to User"
```

### Stage details

1. **Planner.** Given the original conversation, produce a short plan/approach.
   Prompt appended as a synthesised user turn (reuse `appendUserTurn`).
2. **Plan Reviewer** (optional, `planReview`). Same model chain as planner (or
   judge — implementation detail, default to planner chain); critiques and
   returns a revised plan. One pass only, no loop.
3. **Worker.** Produce the answer, given the plan and (on iterations > 1) the
   consolidated reviewer feedback from the previous round.
4. **Reviewers (panel).** Fan out the worker answer to every reviewer in
   parallel; each returns a critique. Collected with `collectPanel`
   (quorum-grace + hard timeout), reusing fusion's tuning constants.
5. **Judge / Synthesise.** Given the worker answer + all critiques, return a
   JSON `{ score, feedback }`. Score gates the loop; feedback drives the next
   Worker iteration. Parsing is defensive: unparseable → treat as a fail with
   the raw text as feedback, but never throw.
6. **Compressor ("turn into haiku").** Condense the approved answer into a
   tighter final form. This is the only client-facing call.

### Role invocation — `callRole`

New helper: `callRole(roleModels, body, handleSingleModel, { isPanel })`.
- `roleModels` normalised to an array.
- Tries each model in order; returns the first `res.ok`. Uses
  `checkFallbackError` (from `accountFallback.js`) to decide retry-vs-abort,
  matching `handleComboChat`'s fallback semantics.
- Exhausted chain → returns `null` (caller decides degradation).

## Dispatch

Add a `strategy === "team"` branch at **both** combo call sites in
`src/sse/handlers/chat.js` (the primary path ~line 122 and the
`handleSingleModelChat` combo-detection path ~line 178), mirroring the existing
`fusion` branch:

```js
if (comboStrategy === "team") {
  log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: team)`);
  return handleTeamChat({
    body,
    models: comboModels,
    handleSingleModel: (b, m, isInternal) => { /* strip tools when isInternal, like fusion isPanel */ },
    log,
    comboName: modelStr,
    team: comboStrategies[modelStr]?.team,
  });
}
```

`handleTeamChat` lives in a **new file** `open-sse/services/team.js` (keeps the
already-576-line `combo.js` focused). It imports the shared helpers it needs
from `combo.js` (`appendUserTurn`, `flattenToolHistory`, `collectPanel`,
`extractPanelText`, `buildJudgePrompt`) and `checkFallbackError` from
`accountFallback.js`. Any helper currently module-private in `combo.js` that
`team.js` needs will be `export`ed from `combo.js` (no behaviour change).

## Error handling / degradation (fail-open)

| Failure                              | Behaviour                                              |
|--------------------------------------|-------------------------------------------------------|
| `models.length === 1`                | Direct single-model call; no team.                    |
| `team` config missing/empty          | Fall back to `handleComboChat` (fallback strategy).   |
| Planner chain exhausted              | Skip plan; Worker answers the raw prompt.             |
| Plan Reviewer fails                  | Use the unreviewed plan.                              |
| Worker chain exhausted, iter 1       | 503 (nothing to return).                              |
| Worker chain exhausted, iter > 1     | Return best-scored prior iteration.                   |
| All reviewers fail                   | Skip review; go straight to Compressor with worker's answer. |
| Judge fails / unparseable score      | Treat as non-pass; if at cap, return best-so-far.     |
| Compressor chain exhausted           | Stream the approved (uncompressed) answer directly.   |

No stage throws out of `handleTeamChat`; the worst case returns a structured
503 like `handleFusionChat` does.

## Testing

New `tests/unit/team-strategy.test.js` (vitest), mocking `handleSingleModel`:

- Role routing: correct model chain invoked for each role; defaults applied
  when fields omitted.
- Fallback chain: planner/worker first model fails → second model used.
- Loop: stops early when judge score ≥ threshold; caps at `maxIters` and
  returns best-scored iteration.
- Panel: reviewers fan out in parallel; partial reviewer failure tolerated.
- Degradation: each row of the table above.
- Single-model bypass; missing-team-config bypass.

Additive only — no changes to existing provider/alias/OAuth baseline snapshots,
so `tests/__baseline__/verify-*.mjs` remain green.

## Files touched

| File | Change |
|------|--------|
| `open-sse/services/team.js` | **New.** `handleTeamChat`, `callRole`, role-resolution + loop. |
| `open-sse/services/combo.js` | Export the shared helpers `team.js` needs. No behaviour change. |
| `src/sse/handlers/chat.js` | Two `strategy === "team"` dispatch branches. |
| `src/lib/db/repos/settingsRepo.js` | (If needed) document `team` shape; `comboStrategies` already defaults to `{}`. |
| `tests/unit/team-strategy.test.js` | **New.** Unit coverage. |
| `CHANGELOG.md` | Feature entry. |
