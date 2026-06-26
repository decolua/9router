# Admin API Key Management Design

Date: 2026-06-23
Branch: `codex/admin-api-key-management`

## Goal

Give the dashboard owner one admin API key that can manage customer API keys without a dashboard JWT.
Each existing API key is treated as one user/customer. Admin can create, list, renew, pause, resume, and delete these keys by API.

## Current Context

- Customer keys live in `apiKeys`.
- Current fields: `id`, `key`, `name`, `machineId`, `isActive`, `createdAt`.
- Dashboard already lists and creates keys through `/api/keys`.
- `/api/keys` currently requires dashboard auth or CLI token through `src/dashboardGuard.js`.
- There is no separate app user table.

## Decisions

- Keep one API key as one user/customer.
- Do not add a `users` table for this feature.
- Add plan and expiration metadata to `apiKeys`.
- Admin API uses one primary admin key, created/regenerated from dashboard.
- Store admin key hashed, never store plaintext.
- Plaintext admin key is shown only once after create/regenerate.
- Use lazy expiry, not a background job.
- Valid plans are `1`, `3`, `6`, and `12` months.
- Renewals add from current `expiresAt` when still valid, otherwise from current time.

## Data Model

Extend `apiKeys` with:

- `planMonths`: integer, allowed values `1`, `3`, `6`, `12`.
- `expiresAt`: ISO timestamp. Null only for old keys migrated before a plan is set.
- `deactivatedReason`: text enum: `expired`, `manual`, or null.
- `updatedAt`: ISO timestamp.

Existing fields stay compatible:

- `name` remains customer display name.
- `key` remains the bearer key used by `/v1`.
- `isActive` remains the source of whether a key can be used.

Settings gain admin key state:

- `adminApiKeyHash`: hash of the current admin API key.
- `adminApiKeyCreatedAt`: ISO timestamp.
- `adminApiKeyUpdatedAt`: ISO timestamp.

No plaintext admin key is exported in settings or returned by normal reads.

## Expiration Rules

Lazy expiry runs before returning key lists and before validating a client key for `/v1`.

For each key:

- If `expiresAt` exists and `expiresAt <= now`, set `isActive=false`, `deactivatedReason=expired`, `updatedAt=now`.
- If key is manually paused, set `isActive=false`, `deactivatedReason=manual`.
- Renewing a key sets `isActive=true`, clears `deactivatedReason`, updates `planMonths`, and sets the new `expiresAt`.

Renewal base date:

- If existing `expiresAt` is in the future, add plan months from existing `expiresAt`.
- If existing `expiresAt` is missing or past, add plan months from now.

## Admin Auth

Admin API accepts either:

- `Authorization: Bearer <adminKey>`
- `x-admin-api-key: <adminKey>`

Missing or invalid admin key returns `401`.
Admin API does not accept dashboard JWT as a substitute.
Dashboard admin-key creation/regeneration still requires dashboard auth.

## Admin API

### `GET /api/admin/keys`

List all customer keys after applying lazy expiry.

Response:

```json
{
  "keys": [
    {
      "id": "uuid",
      "key": "sk-...",
      "name": "Customer Name",
      "machineId": "machine",
      "planMonths": 1,
      "expiresAt": "2026-07-23T00:00:00.000Z",
      "isActive": true,
      "deactivatedReason": null,
      "createdAt": "2026-06-23T00:00:00.000Z",
      "updatedAt": "2026-06-23T00:00:00.000Z"
    }
  ]
}
```

### `POST /api/admin/keys`

Create one customer key.

Request:

```json
{ "name": "Customer Name", "planMonths": 1 }
```

Rules:

- `name` required.
- `planMonths` required and must be `1`, `3`, `6`, or `12`.
- `expiresAt = now + planMonths`.
- `isActive=true`.

### `PATCH /api/admin/keys/:id`

Update customer key metadata or active state.

Allowed body fields:

```json
{
  "name": "Customer Name",
  "isActive": false,
  "planMonths": 3
}
```

Rules:

- Unknown fields are rejected with `400`.
- Setting `isActive=false` sets `deactivatedReason=manual`.
- Setting `isActive=true` clears `deactivatedReason` unless key is already expired; expired keys should be renewed instead.
- Changing `planMonths` alone does not change `expiresAt`.

### `POST /api/admin/keys/:id/renew`

Renew a customer key.

Request:

```json
{ "planMonths": 3 }
```

Rules:

- `planMonths` required and must be `1`, `3`, `6`, or `12`.
- Uses renewal base-date rule above.
- Sets `isActive=true`.
- Clears `deactivatedReason`.

### `DELETE /api/admin/keys/:id`

Delete one customer key.

Rules:

- Existing delete behavior remains.
- Return `404` when key does not exist.

## Dashboard API Compatibility

Keep existing `/api/keys` routes for dashboard UI.

Changes:

- `GET /api/keys` returns new fields.
- `POST /api/keys` accepts optional `planMonths`; default `1` month.
- `PUT /api/keys/:id` keeps current `isActive` behavior and may accept new metadata.
- Existing clients that only pass `name` keep working.

## Dashboard UI

Endpoint page:

- Create key modal adds a plan selector: `1`, `3`, `6`, `12` months.
- Key list shows plan, expiration date, and status.
- Status labels:
  - Active: active and not expired.
  - Paused: inactive with `deactivatedReason=manual`.
  - Expired: inactive with `deactivatedReason=expired`.
- Add Renew action with plan selector.

Profile or Settings page:

- Add "Admin API Key" section.
- If no key exists: show Create button.
- If key exists: show masked value/status metadata.
- Regenerate replaces the existing admin key.
- Copy plaintext only immediately after create/regenerate.

## Error Handling

- Invalid admin key: `401`.
- Missing admin key: `401`.
- Invalid plan: `400`.
- Missing name on create: `400`.
- Missing key id: `404`.
- Expired key trying to call `/v1`: `401`, same as invalid key.
- Manual pause trying to call `/v1`: `401`, same as invalid key.

## Security

- Never persist plaintext admin key.
- Do not return admin key from settings reads.
- Admin API should not expose provider secrets.
- Admin key can manage customer keys only.
- Admin key cannot call local-only routes, database import/export, shutdown, OAuth auto-import, or host-secret routes.
- Use timing-safe compare for admin key hash verification where practical.

## Migration

For old keys:

- Preserve existing keys and active state.
- Set `planMonths` to null.
- Set `expiresAt` null so old keys do not unexpectedly expire.
- Set `updatedAt = createdAt` when missing.

Admin can later renew old keys to assign a real plan and expiration.

## Testing

Unit tests:

- plan validation accepts only `1`, `3`, `6`, `12`.
- renewal from active future `expiresAt`.
- renewal from expired/past `expiresAt`.
- lazy expiry marks overdue keys inactive.
- admin key hash verify rejects wrong key.

API tests:

- admin endpoints reject missing/wrong admin key.
- admin endpoints accept correct admin key.
- admin create produces key with `expiresAt`.
- admin renew extends from existing future expiration.
- dashboard `/api/keys` still works with name-only create.

Smoke checks:

- `/v1` rejects expired/deactivated customer key.
- dashboard Endpoint page still loads and lists keys.

## Out Of Scope

- Separate `users` table.
- Multi-admin-key management.
- Per-user usage quota limits.
- Automatic billing/payment integration.
- Background expiry scheduler.
- Email/SMS expiration notices.

## Unresolved Questions

None.
