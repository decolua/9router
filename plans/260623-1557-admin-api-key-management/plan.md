# Admin API Key Management Plan

Status: Implemented; final build/dev smoke blocked locally because `next` is not installed.

## Goal

Add dashboard-managed admin API key and plan-based customer API key expiration.

## Context

- Spec: [docs/superpowers/specs/2026-06-23-admin-api-key-management-design.md](../../docs/superpowers/specs/2026-06-23-admin-api-key-management-design.md)
- Detailed phase: [phase-01-admin-api-key-management.md](phase-01-admin-api-key-management.md)
- Branch: `codex/admin-api-key-management`

## Phases

1. Complete - Core plan/date/auth helpers and tests.
2. Complete - DB schema/repo updates for key plans and lazy expiry.
3. Complete - Admin API routes and dashboard admin key route.
4. Complete - Dashboard UI updates for plans, expiration, renew, admin key.
5. Complete with environment blocker - Focused tests and syntax checks pass; full Next build/dev smoke cannot run until local dependencies include `next`.

## Key Dependencies

- Existing SQLite DB layer in `src/lib/db`.
- Existing dashboard guard in `src/dashboardGuard.js`.
- Existing Endpoint page in `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`.
- Existing Profile page in `src/app/(dashboard)/dashboard/profile/page.js`.

## Success Criteria

- Admin key can be created/regenerated from dashboard.
- Admin API works with admin key and does not require dashboard JWT.
- Customer keys support `1`, `3`, `6`, `12` month plans.
- Renewals add from existing future `expiresAt`; otherwise from now.
- Expired keys become inactive lazily before list/validation.
- Existing dashboard key creation still works with name only.
