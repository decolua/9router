---
name: goal-loop-orchestrator
description: "Trigger: autonomous loop, keep working until done, goal loop, no babysitting, quota retry. Runs a Pi-CLI-only goal-driven orchestration loop with Advisor gates, worktree isolation, retry/quota fallback, and final completion checks."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Use when the user asks for autonomous multi-agent delivery until a defined goal is complete. Do not use for one-file fixes, conversational planning, or when destructive actions are needed without explicit approval.

## Hard Rules

- Define a binary final goal and backlog before spawning workers.
- The parent is an orchestrator only: no engineering, planning, review, or QA work inline.
- Spawn every agent with `pi` CLI. Never use non-`pi` agent mechanisms.
- Run a fresh Advisor gate before every consequential action. If Advisor is unavailable, apply the quota policy below; do not silently bypass.
- Use one task per agent. Use fresh context except reviewer-directed rework on the same task.
- Parallel writers require isolated git worktrees and disjoint file scopes. Never merge, commit, push, publish, or run destructive git without explicit user approval.
- Keep state in `.pi/orchestrator/outputs/autonomous-state.md` and append events to `.pi/orchestrator/outputs/autonomous-supervisor-events.log`.

## Decision Gates

| Situation | Action |
| --- | --- |
| Missing final goal or acceptance criteria | Ask or create a draft goal and stop for confirmation |
| Independent read-only review/planning | Run in parallel |
| Independent writes | Use separate worktrees and exclusive output dirs |
| Shared files or integration needed | Stop writers; run read-only integration planner first |
| Reviewer/QA returns FINDINGS | Route exact findings to a rework Engineer; then re-review |
| Policy/product decision needed | Stop and surface decision; do not invent policy |
| Verification failed | Keep task open; spawn rework or blocker analysis |

## Execution Steps

1. Create a state file with `goal`, `acceptance`, `backlog`, `active`, `closed`, `blocked`, and `next_actions`.
2. Loop until all acceptance criteria are closed or a true blocker remains.
3. In each loop: collect agent outputs; classify CLEAN/FINDINGS/BLOCKER; Advisor-gate next actions; spawn the smallest safe batch.
4. Enforce lifecycle per task: PLAN → BUILD → REVIEW → QA → QA REVIEW → CLOSE.
5. Close only with clean implementation review, clean QA review, and pasted verification evidence.
6. After branch tasks are clean, run an integration planner; integrate only after a separate Advisor gate.

## Quota / Exhaustion Policy

- On provider quota/token-window failure, record the exact model, role, command, error, and timestamp in state.
- Retry the same blocked role/model every 30 minutes for up to 7 hours while other independent work continues.
- If the model is still unavailable after 7 hours, automatically move to the next configured model for that role and record the fallback.
- If all role models are exhausted, quarantine the task, continue unrelated tasks, and retry the quarantined task every 30 minutes.
- Advisor fallback is allowed only when the current user/project policy explicitly permits non-default Advisor models; otherwise pause Advisor-gated actions and continue read-only collection.

## Output Contract

Return concise loop status: closed tasks, active agents, blockers, next gated actions, verification evidence, and any quota fallback/quarantine state.

## References

- `.pi/orchestrator/outputs/autonomous-state.md` — live loop state.
- `.pi/orchestrator/outputs/autonomous-supervisor-events.log` — event log.
