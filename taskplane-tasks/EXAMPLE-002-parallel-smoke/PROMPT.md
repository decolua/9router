# Task: EXAMPLE-002 — Parallel Smoke

**Created:** 2026-04-22
**Size:** S

## Review Level: 0 (None)

**Assessment:** Trivial parallel-safe smoke task to demonstrate orchestrator lanes.
**Score:** 0/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/EXAMPLE-002-parallel-smoke/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Create a simple `hello-taskplane-2.md` file in the project root. This task is
intentionally independent from EXAMPLE-001 so both can run in parallel when
using `/orch`.

## Expected File Content

`hello-taskplane-2.md` should include:

- A title line (for example: `# Parallel Hello from Taskplane`)
- A line containing the task ID: `EXAMPLE-002`
- A short note that this task is parallel-safe

## Dependencies

- **None**

## Context to Read First

_No additional context needed._

## Environment

- **Workspace:** Project root
- **Services required:** None

## File Scope

- `hello-taskplane-2.md`

## Steps

### Step 0: Preflight

- [ ] Verify this PROMPT.md is readable
- [ ] Verify STATUS.md exists in the same folder

### Step 1: Create Parallel Hello File

- [ ] Create `hello-taskplane-2.md` in the project root
- [ ] Add title plus lines containing task ID `EXAMPLE-002` and a parallel-safe note

### Step 2: Verification

- [ ] Verify `hello-taskplane-2.md` exists and matches the expected content

### Step 3: Delivery



## Documentation Requirements

**Must Update:** None
**Check If Affected:** None

## Completion Criteria

- [ ] `hello-taskplane-2.md` exists in the project root
- [ ] `hello-taskplane-2.md` includes a title, task ID (`EXAMPLE-002`), and a parallel-safe note

## Git Commit Convention

- **Implementation:** `feat(EXAMPLE-002): description`
- **Checkpoints:** `checkpoint: EXAMPLE-002 description`

## Do NOT

- Modify any existing project files
- Create files outside the project root
- Add dependencies between EXAMPLE-001 and EXAMPLE-002

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
