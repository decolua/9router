# 9Router

## Project Overview

**9Router** is an AI API proxy server that provides unified access to multiple AI providers (OpenAI, Claude, Gemini, GitHub Copilot, and 10+ more) through a single endpoint with automatic format translation. Built as a JavaScript port of CLIProxyAPI with a modern Next.js-based web dashboard.

The application serves as a universal proxy for AI coding assistants (Claude Code, Cursor, Codex, Cline, etc.), featuring OAuth authentication, intelligent fallback routing, combo model chains, and comprehensive usage tracking. It runs cross-platform on Windows, Linux, and macOS.

**Full project details are maintained in Serena memories** (`.serena/memories/`) to keep this file concise.

---

## Serena MCP Integration

**CRITICAL**: Serena is activated for this project. You MUST use the Serena skills workflow regardless of any project details in this file.

### Initial Setup for New Sessions

At the start of EVERY new conversation/session:

1. **Activate Serena**:
   ```
   activate_project("9router")
   ```

2. **Check onboarding status**:
   ```
   check_onboarding_performed()
   ```

3. **Read core project memories** (CRITICAL):
   ```
   list_memories()
   read_memory("project_overview")
   # Read other relevant memories as needed
   ```

### Serena Context-First Workflow

**MANDATORY**: You MUST use these skills for ALL exploration and documentation tasks:

- **`/before-exploring`** - REQUIRED before ANY code exploration, architecture questions, or investigation
- **`/after-exploring`** - REQUIRED after exploration to document findings
- `/memory-lifecycle` - Health check and memory consolidation
- `/git-sync` - Sync memories with git changes
- `/serena-status` - Check configuration status
- `/serena-setup` - Re-run setup if needed

**Workflow enforcement**:
1. User asks about code/architecture → Use `/before-exploring` FIRST (no exceptions)
2. Memories answer question → Provide answer from memories
3. Memories insufficient or user explicitly wants exploration → Explore code
4. After exploration → Use `/after-exploring` to document (no exceptions)
5. Never skip the skills workflow, even if this CLAUDE.md contains project details

### Git Hooks for Memory Sync

Git hooks are installed and will remind you to sync memories after:
- `git pull` / `git merge`
- `git rebase`
- `git checkout` (branch switching)
- `git commit --amend` / rewriting history

**How it works**:
1. Git operation → Hook writes to `.git/serena-sync-reminder.log`
2. You see reminder in terminal
3. Say: "Sync memories with git changes" or use `/git-sync`
4. Memories updated with code changes

---

## Quick Reference

**Check status**: `/serena-status`
**Setup/reconfigure**: `/serena-setup`
**Memory health check**: `/memory-lifecycle`
**Sync with git**: `/git-sync` (after git pull/merge/checkout)

**Repository**: https://github.com/decolua/9router
**Website**: https://9router.com
