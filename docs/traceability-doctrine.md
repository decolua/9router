# Repository Traceability Doctrine

This repository records enough context to let a contributor or reviewer answer a
simple question: what was changed, why was it changed, and what evidence supports
calling it complete? Traceability is an engineering record, not a substitute for
review or testing.

## Marker

Use a `ch:trace` marker when recording a meaningful work item. A marker connects
the work across its planning, implementation, verification, and close-out records.
Keep it as a single line of space-separated `key=value` fields so it remains easy
to search and copy between repository records.

```text
ch:trace row=<work-item> spec=<requirement-or-design> wave=<work-batch> test=<test-or-none:reason> doc=<documentation-path> prompt=<task-brief> evidence=<artifact-or-none:reason> witness=<independent-observer-or-none:reason> verdict=<review-result-or-none:reason> commit=<commit-id-or-none:reason> memory=<durable-record-or-none:reason>
```

The fields establish the following links:

- `row` identifies the tracked work item.
- `spec` identifies the requirement, design, or source contract that governed the
  change.
- `wave` identifies the work batch when one exists.
- `test` identifies the verification command, test file, or an explicit reason a
  test does not apply.
- `doc` identifies the contributor or user-facing documentation affected by the
  work.
- `prompt` identifies the task brief or other implementation instruction.
- `evidence` points to the artifact that supports the completion claim.
- `witness` identifies an independent check, reviewer, live probe, or source
  verification.
- `verdict` identifies the review or judgement outcome.
- `commit` identifies the change that carries the work.
- `memory` identifies any durable project record, where the project uses one.

Not every field applies to every task. Use `none:<reason>` for an inapplicable or
unavailable field, for example `test=none:documentation-contract`. Do not leave a
field blank, and do not use `none` to conceal missing verification.

## Evidence

Every completion claim needs a real evidence artifact. Suitable evidence includes
a committed diff, a test or build log, a reproducible command and its result, a
review verdict, or a published documentation page. Evidence must name enough
context for another contributor to find or reproduce it.

A claim with no applicable artifact must say so explicitly using
`none:<reason>`. Examples include documentation-only work with no runtime path,
or an intentionally deferred external verdict. An explicit absence is honest
metadata; it is not a passing result.

Do not record credentials, private host paths, personal data, or other sensitive
values in markers or evidence references. Use repository-relative paths, public
URLs, commit IDs, or neutral artifact identifiers where possible.

## Witnesses and verdicts

A witness is a check independent of the implementation assertion: a reviewer, a
separate verification command, a live probe, or a source-document comparison.
Where an independent witness is not available, record `none:<reason>` rather than
inventing one.

A verdict records the result of the applicable review or judgement process. A
verdict alone is not sufficient close-out evidence: it must be bound to the exact
landed commit it evaluated. If a verdict is pending, the marker must say that
plainly and the completion record must not imply that the verdict already passed.

## Close-out

Before closing a work item:

1. Record the marker with the row, governing source, changed documentation or
   code, verification, and evidence fields.
2. Preserve or link the evidence artifact, or use an explicit `none:<reason>`.
3. Bind any verdict evidence to the exact landed commit, not merely a local
   working tree or an earlier revision.
4. Verify that the commit is present on the published branch used for the work.
   A local branch alone is not a published result.
5. State remaining uncertainty, pending reviews, and non-applicable checks
   explicitly.

A close-out is complete only when its evidence, verdict (when applicable), landed
commit, and published branch all refer to the same delivered change. This makes
later review possible without relying on recollection or private operational
context.
