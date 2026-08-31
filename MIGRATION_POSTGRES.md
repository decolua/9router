# 9router → Postgres storage

This fork replaces 9router's SQLite storage layer (`better-sqlite3` / `sql.js` /
`node:sqlite` / `bun:sqlite`) with **PostgreSQL**. Everything else — routing,
translation, OAuth, the dashboard — is unchanged.

## TL;DR

```bash
cp .env.example .env          # then set DATABASE_URL (+ CA for managed PG)
npm install
npm run db:smoke              # verify the storage layer end-to-end
npm run dev                   # or: npm run build && npm start
```

The schema is created automatically on first connect (see `runMigrationOnce`).
No manual DDL, no `psql` step.

## Configuration

| Env var | Purpose |
|---|---|
| `DATABASE_URL` | libpq connection URL. **Required.** `POSTGRES_URL` / `PG_CONNECTION_STRING` also accepted. |
| `DATABASE_CA_PATH` | Path to a CA `.pem` file (managed Postgres: Aiven, RDS, Supabase…). `PGSSLROOTCERT` also accepted. |
| `DATABASE_CA_CERT` | CA certificate as inline PEM text (alternative to a file — handy for container secrets). |
| `DATABASE_SSL` | `true` to force TLS without pinning a CA. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `false` to skip certificate verification (only if you have no CA). |
| `PG_POOL_MAX` | Pool size (default `10`). |
| `PG_CONNECT_TIMEOUT_MS` | Connection timeout (default `10000`). |

TLS is auto-enabled when any of `DATABASE_CA_PATH` / `DATABASE_CA_CERT` /
`DATABASE_SSL=true` is set, or when the URL carries `?sslmode=require`
(`verify-ca` / `verify-full` too). With a CA present, certificates are verified;
without one, TLS is used but not verified.

### Local Postgres

```bash
# option A — your own server
createdb ninerouter && createuser ninerouter --pwprompt
# DATABASE_URL=postgresql://ninerouter:<pw>@127.0.0.1:5432/ninerouter

# option B — throwaway container (does not touch a system Postgres)
docker compose -f docker-compose.pg.yml up -d
# DATABASE_URL=postgresql://ninerouter:ninerouter@127.0.0.1:5433/ninerouter
```

### Aiven / managed Postgres

```env
DATABASE_URL=postgres://avnadmin:<pw>@<host>.aivencloud.com:<port>/defaultdb?sslmode=require
DATABASE_CA_PATH=./certs/aiven-ca.pem
```

Download the project CA from the Aiven console → service → *Connection
information* → *CA certificate*, and drop it at `certs/aiven-ca.pem`
(`*.pem` is git-ignored).

## Extra: connection groups + dedup on add

Beyond the storage swap, this fork adds:

- **`group` field on provider connections** (stored in the connection's `data`
  JSON — no schema change). Blank = no group.
  - Add-key modal: a "Group" field (datalist combobox — pick an existing group
    or type a new one), single and bulk.
  - Bulk-add line format is now `name | apiKey | group` (group optional →
    `name | apiKey` still works). Caveat: with 3 fields the last `|` segment is
    the group, so a key containing a literal `|` must use the 2-field form.
  - Providers page: select connections → **Set Group** to assign/clear a group
    on many at once (`PUT /api/providers/:id { group }`).
  - Shown as a badge on each connection row.
- **`skipIfExists`** on `POST /api/providers` — dedup by **API-key value**
  (distinct from the existing name-based upsert). A matching key is left
  untouched and the response is `{ skipped: true }` (HTTP 200). The bulk-add
  modal has a "Skip keys that already exist" checkbox (on by default), so
  re-pasting an overlapping list only adds the new keys.

## What changed

| Area | Before (SQLite) | After (Postgres) |
|---|---|---|
| Driver | `src/lib/db/adapters/*SqliteAdapter.js`, chosen by `driver.js` fallback chain | `src/lib/db/adapters/postgresAdapter.js` (only driver) |
| Connection | local file at `~/.9router/db/data.sqlite` | pool in `src/lib/db/pg.js`, `DATABASE_URL` |
| Adapter API | **synchronous** (`db.get(...)`) | **async** (`await db.get(...)`) — every repo + `migrate.js` updated |
| Placeholders | `?` (better-sqlite3) | rewritten to `$1..$n` in the adapter (`toPgPlaceholders`) |
| Identifier case | mixed-case columns readable directly | Postgres folds to lower-case; the adapter wraps rows in a case-insensitive proxy (`ciRow`) so `row.isActive` still works |
| `INSERT OR REPLACE` | SQLite-only | `helpers/upsert.js` → `INSERT ... ON CONFLICT ... DO UPDATE` |
| Schema DDL | SQLite types | `toPgColumnDef()` maps `INTEGER PRIMARY KEY AUTOINCREMENT`→`BIGSERIAL`, `REAL`→`DOUBLE PRECISION` |
| Column diff (auto-sync) | `PRAGMA table_info` | `information_schema.columns` |
| Transactions | `better-sqlite3` sync `db.transaction(fn)` | dedicated pooled client + `BEGIN/COMMIT`, pinned via `AsyncLocalStorage` so nested `db.*` calls join the tx |
| Pre-migration backup | `.sqlite` file copy via `ATTACH` | `pg_dump` (plain SQL, excludes `requestdetails` data); best-effort |
| Removed deps | — | `sql.js` dropped; `better-sqlite3` kept **optional**, used only by the Cursor OAuth auto-import route (reads Cursor's own local DB) |

Consumers outside `src/lib/db/` were **not** touched — they already call the
async repo functions (`getSettings()`, `getProviderConnections()`, …) exported
from `src/lib/db/index.js` / the `src/lib/localDb.js` shim.

## Data migration from an existing SQLite install

There is no automatic SQLite→Postgres copy. Two paths:

1. **Dashboard export/import** — on the old (SQLite) instance, Dashboard →
   Settings → *Export*; on the new (Postgres) instance, *Import*. Covers
   settings, connections, nodes, proxy pools, API keys, combos, aliases,
   pricing. (Usage history is not included.)
2. **Legacy JSON** — if `~/.9router/db.json` (etc.) still exist and the Postgres
   DB is empty on first boot, `migrate.js` imports them one time, exactly as the
   SQLite layer did.

## Verifying

`npm run db:smoke` runs `scripts/pg-smoke.mjs`: connects, runs migrations, then
exercises every repo (CRUD, transactions, kv scopes, usage aggregation,
export/import) and cleans up after itself. Green output = the storage layer is
wired correctly for your `DATABASE_URL`.

## Clearing test data

`POST /api/settings/database/reset` truncates every data table (keeps `_meta`, so
the schema is **not** re-migrated; resets the lifetime request counter to 0).

- Guards: JWT/CLI-token (it's under `/api/settings/database`, already
  `ALWAYS_PROTECTED`), **plus** dashboard-password re-auth, **plus** a
  `{ "confirm": "RESET" }` body.
- Disabled when `NODE_ENV=production` unless `ALLOW_DB_RESET=true`.
- `{ "keepSettings": true }` preserves the `settings` row (dashboard password,
  auth mode…).

```bash
# authenticate, then:
curl -X POST http://localhost:20127/api/settings/database/reset \
  -b cookies.txt -H 'content-type: application/json' \
  -d '{"password":"<dashboard-password>","confirm":"RESET"}'
# → {"success":true,"cleared":[...],"keptSettings":false}
```

After a full reset the dashboard password falls back to `INITIAL_PASSWORD`.
