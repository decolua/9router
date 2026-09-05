---
name: hermes-skill-prune
description: "Use when pruning Hermes skills: bloat, duplicates."
---

# Hermes Skill Prune

GC for the Hermes skill library. Every registered skill costs tokens in the system-prompt index every single turn. Prune to shrink every future request.

Works for skill dirs installed by 9router too (`~/.agents/skills/`, `~/.hermes/skills/`, `~/AppData/Local/hermes/skills/`).

## When to Use

- User says "too many skills", "prune", "slim down", "slow"
- After installing a big skill pack (dozens of new skills)
- Periodic audit (monthly)

## Scan Signals (rank by confidence)

| Signal | Check | Confidence |
|---|---|---|
| Broken | SKILL.md missing/empty, YAML frontmatter invalid | HIGH |
| Duplicate | Same name different dirs (e.g. nested agent-browser/agent-browser/...) | HIGH |
| Overlapping | Same trigger domain, weaker description | MED |
| Stale | No trigger match in recent sessions | LOW |

## Workflow

1. Scan `~/AppData/Local/hermes/skills/`, `~/.hermes/skills/`, `~/.agents/skills/` (and profiles: `~/AppData/Local/hermes/profiles/*/skills/`).
2. Detect broken first: missing SKILL.md, empty file, invalid YAML frontmatter.
3. Detect duplicates: same basename in multiple category dirs, nested self-duplicates.
4. Rank candidates, cap ~20 per run. Present table: name, signal, size, last-modified.
5. Confirm ONE BY ONE. Never bulk-approve.
6. Soft-delete: `mv skill-dir ~/AppData/Local/hermes/_gc_trash/YYYY-MM-DD/`. Undo = mv back.
7. Log every run to `~/AppData/Local/hermes/gc_log.md`: timestamp, items, why, undo.
8. Report: count removed, dirs remaining, index-token estimate saved (~80 tokens/skill in system prompt).

## Commands

```bash
# broken/empty skills
find ~/AppData/Local/hermes/skills -maxdepth 2 -name SKILL.md -size -200c

# duplicates by name
find ~/AppData/Local/hermes/skills -maxdepth 3 -name SKILL.md | sed 's|.*/skills/||; s|/SKILL.md||' | sort | uniq -d

# nested self-duplicates (skill/skill/skill)
find ~/AppData/Local/hermes/skills -maxdepth 6 -type d -path "*/*/*/*/*" | head

# soft-delete with log
d=$(date +%F); mkdir -p ~/AppData/Local/hermes/_gc_trash/$d
mv ~/AppData/Local/hermes/skills/dead-skill ~/AppData/Local/hermes/_gc_trash/$d/
echo "$(date -Is) moved dead-skill (reason) -> _gc_trash/$d/ (undo: mv back)" >> ~/AppData/Local/hermes/gc_log.md
```

## Anti-Patterns

- Never hard-delete on first pass. Always _gc_trash.
- Never bulk-approve. One item, one [y/n/skip].
- Age alone is not a verdict — seasonal skills exist.
- Duplicate handling: keep the copy with the strongest description; trash the rest.
- Never touch another profile's skills dir unless user explicitly says so.

## Verification

- [ ] Every removal has a gc_log.md entry with undo path
- [ ] `hermes skills list` no longer shows removed skills
- [ ] No skill was trashed that a cron job or MCP references
- [ ] Report includes index-token savings estimate
