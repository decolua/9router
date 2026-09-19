# Agent orchestration (Cursor)

Also see `AGENTS.md` for code quality and commit message rules. Claude Code uses `CLAUDE.md` (`haiku` / `sonnet` / `opus` / `fable`).

## Commits

6. If a task touches multiple concerns, prefer splitting into smaller sequential commits

## Delegating to sub-agents (Cursor Task)

Model tiers for ANY delegated work — Cursor `Task` calls and parallel fan-out alike. Set the `model` parameter explicitly on every call; never omit it (omission silently inherits the session model via `inherit`).

| Tier | Model slug | Use |
|------|------------|-----|
| Fast | `composer-2.5-fast` | Mechanical bulk work: renames, boilerplate, format conversion, log triage |
| Default | `gpt-5.6-terra-medium` | Well-specified implementation with clear acceptance criteria |
| Strong | `gpt-5.6-sol-medium` | Tricky work: concurrency, subtle algorithms, adversarial verify/judge panels, gnarly debugging |
| Alt | `cursor-grok-4.5-high-fast` | When OpenAI tiers blocked, or Grok fits better |

**Independent review:** rare; only when independence from your own context is the point (e.g. adversarial review of your own plan or a large diff). ALWAYS check with me first — never spawn unprompted. Standalone `Task` only — never inside a parallel workflow batch.

When unsure between tiers, pick the cheaper and escalate on failure.

**Route priority:** Claude subscription (P1) → OpenCodex (P2) → Cursor `Task` with slugs above (P3). Detail: `.cursor/rules/15-model-route-priority.mdc`.

## Dynamic workflows (parallel Task fan-out)

Applies to ALL sessions. Reach for parallel `Task` subagents when a task has 3+ independent parallelizable subtasks or would benefit from a pipeline/judge panel.

**Opt-in:** if ultracode is NOT on for the session (no "ultracode" keyword, toggle, or an orchestration request in my own words), check with me first — propose the workflow in one or two sentences with the rough shape and cost, and wait for my reply; my "yes" is the opt-in. If ultracode IS on, invoke directly.

**Models inside parallel workflows:** every `Task` call MUST set `model` explicitly — only `composer-2.5-fast`, `gpt-5.6-terra-medium`, `gpt-5.6-sol-medium`, or `cursor-grok-4.5-high-fast`. No independent-review spawn inside the batch. If that review is warranted, it happens AFTER the workflow completes, as a standalone `Task` call (ask first, per above).
