# Task: EXAMPLE-001 — Hello World

**Created:** 2026-04-22
**Size:** S

## Review Level: 0 (None)

**Assessment:** Trivial single-file task to verify Taskplane is working.
**Score:** 0/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/EXAMPLE-001-hello-world/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Create a simple `hello-taskplane.md` file in the project root to verify that
Taskplane task execution is working correctly. This is a smoke test — if the
worker can read this prompt, create the file, checkpoint progress, and mark the
task done, the installation is healthy.

## Expected File Content

`hello-taskplane.md` should include:

- A title line (for example: `# Hello from Taskplane`)
- A line containing the task ID: `EXAMPLE-001`
- A line containing today's date

## Dependencies

- **None**

## Context to Read First

_No additional context needed._

## Environment

- **Workspace:** Project root
- **Services required:** None

## File Scope

- `hello-taskplane.md`

## Steps

### Step 0: Preflight

- [ ] Verify this PROMPT.md is readable
- [ ] Verify STATUS.md exists in the same folder

### Step 1: Create Hello File

- [ ] Create `hello-taskplane.md` in the project root
- [ ] Add a title plus lines containing today's date and task ID `EXAMPLE-001`

### Step 2: Verification

- [ ] Verify `hello-taskplane.md` exists and matches the expected content

### Step 3: Delivery



## Documentation Requirements

**Must Update:** None
**Check If Affected:** None

## Completion Criteria

- [ ] `hello-taskplane.md` exists in the project root
- [ ] `hello-taskplane.md` includes a title, task ID (`EXAMPLE-001`), and current date

## Git Commit Convention

- **Implementation:** `feat(EXAMPLE-001): description`
- **Checkpoints:** `checkpoint: EXAMPLE-001 description`

## Do NOT

- Modify any existing project files
- Create files outside the project root
- Over-engineer this — it's a smoke test

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
