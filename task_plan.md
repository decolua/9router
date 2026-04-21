# Task Plan: Provider scale + quota tracker performance

## Goal
Fix the provider dashboard so 800+ Codex provider accounts no longer appear as "no connections", and add scalable quota tracker UX plus more efficient usage refresh.

## Phases

### Phase 1 — Discover current flow
- [in_progress] Map provider dashboard data flow, connection detection, and the Codex/OpenAI list source.
- [pending] Map quota tracker API/UI flow, refresh triggers, and Redis usage.

### Phase 2 — Design target behavior
- [pending] Define pagination, search, and status filters for quota tracker.
- [pending] Define queue-based refresh policy and dedupe/TTL behavior.

### Phase 3 — Implement
- [pending] Fix provider dashboard false "no connections" state.
- [pending] Add quota tracker pagination, search, and status filters.
- [pending] Replace aggressive usage refresh with queued processing.

### Phase 4 — Verify
- [pending] Run diagnostics/tests for changed files.
- [pending] Manually confirm dashboard and quota tracker behavior.

## Risks / Questions
- The dashboard may be conflating "loaded list empty" with "no connections".
- Refresh may be triggered from multiple UI lifecycles; need to identify the real source before changing it.
- Need to confirm whether Redis queue support already exists or needs a lightweight job layer.

## Errors Encountered
- None yet.
