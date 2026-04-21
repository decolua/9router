# Findings

## Initial state
- User reported a scale bug on `/dashboard/providers` with 800+ Codex provider accounts.
- User wants quota tracker pagination, search, and status filters: active, quota exhausted, revoked/invalid.
- User wants quota usage refresh to stop refreshing constantly and use a queue-based approach, likely with Redis.

## Research in progress
- Waiting on codebase scans for provider dashboard flow, quota tracker flow, and Redis queue documentation.
