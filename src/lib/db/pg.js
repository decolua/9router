// Low-level Postgres connection + SQL-dialect shims.
//
// The rest of the DB layer was written for SQLite (better-sqlite3 semantics):
//  - `?` positional placeholders
//  - synchronous adapter methods
//  - identifiers written in mixed case (`isActive`, `providerConnections`)
//
// Postgres needs `$1..$n` placeholders and folds every unquoted identifier to
// lower-case. We bridge both here so the ~60 hand-written SQL strings in
// repos/ and migrate.js keep working unchanged:
//  - toPgPlaceholders() rewrites `?` → `$n` (quote-aware)
//  - ciRow() wraps result rows so `row.isActive` transparently resolves the
//    stored lower-case column `isactive`
import fs from "node:fs";
import pg from "pg";

// bigint (int8, OID 20) → JS number. Safe here: COUNT(*) / lifetime counters
// never approach 2^53 for a local single-user gateway.
pg.types.setTypeParser(20, (v) => (v == null ? null : parseInt(v, 10)));
// numeric (OID 1700) → float, so REAL-style `cost` columns read back as numbers.
pg.types.setTypeParser(1700, (v) => (v == null ? null : parseFloat(v)));

const { Pool } = pg;

if (!global._pgPool) global._pgPool = null;

function rawConnectionString() {
  const cs =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.PG_CONNECTION_STRING;
  if (!cs) {
    throw new Error(
      "[DB] No Postgres connection string. Set DATABASE_URL " +
        "(e.g. postgresql://ninerouter:ninerouter@127.0.0.1:5432/ninerouter)",
    );
  }
  return cs;
}

// TLS is configured explicitly via getSslConfig() (so a pinned CA is used and
// verified). Strip `sslmode` from the URL so `pg` doesn't ALSO parse it — newer
// pg-connection-string logs a deprecation warning and would otherwise fight our
// explicit `ssl` object.
export function getConnectionString() {
  const raw = rawConnectionString();
  try {
    const u = new URL(raw);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return raw.replace(/([?&])sslmode=[^&]*/, (_, sep) => (sep === "?" ? "?" : "")).replace(/[?&]$/, "");
  }
}

export function hasSslModeRequire() {
  return /[?&]sslmode=(require|verify-ca|verify-full)/.test(rawConnectionString());
}

// TLS config for managed Postgres (Aiven, RDS, Supabase, …).
//   DATABASE_CA_CERT   — CA certificate as inline PEM text
//   DATABASE_CA_PATH / PGSSLROOTCERT — path to a .pem CA file
//   DATABASE_SSL=true / URL `?sslmode=require` — enable TLS without a pinned CA
//   DATABASE_SSL_REJECT_UNAUTHORIZED=false — opt out of cert verification
export function getSslConfig() {
  const inlineCa = process.env.DATABASE_CA_CERT;
  const caPath = process.env.DATABASE_CA_PATH || process.env.PGSSLROOTCERT;
  const wantSsl =
    !!inlineCa ||
    !!caPath ||
    process.env.DATABASE_SSL === "true" ||
    hasSslModeRequire();

  if (!wantSsl) return undefined;

  const ca = inlineCa
    ? inlineCa.replace(/\\n/g, "\n")
    : caPath
      ? fs.readFileSync(caPath, "utf8")
      : undefined;

  return {
    ca,
    // With a CA we verify by default; without one, Aiven-style endpoints still
    // need TLS but can't be verified, so default to non-strict there.
    rejectUnauthorized:
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false"
        ? false
        : !!ca,
  };
}

export function getPool() {
  if (global._pgPool) return global._pgPool;
  const pool = new Pool({
    connectionString: getConnectionString(),
    ssl: getSslConfig(),
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10_000),
  });
  pool.on("error", (err) => {
    console.error("[DB][pg] idle client error:", err.message);
  });
  global._pgPool = pool;
  return pool;
}

export async function closePool() {
  if (!global._pgPool) return;
  const pool = global._pgPool;
  global._pgPool = null;
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
}

// Rewrite `?` placeholders to `$1..$n`, skipping anything inside single- or
// double-quoted string/identifier literals. Postgres also uses `?` inside some
// operators (jsonb `?`, `?|`, `?&`) but this codebase uses none of them.
export function toPgPlaceholders(sql) {
  let out = "";
  let n = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inSingle) {
      out += ch;
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += ch;
      continue;
    }
    if (ch === "?") {
      out += "$" + ++n;
      continue;
    }
    out += ch;
  }
  return out;
}

// Case-insensitive row accessor. Postgres returns lower-cased column keys for
// unquoted identifiers; callers written against SQLite read `row.isActive`,
// `row.createdAt`, `row.connectionId`, etc.
export function ciRow(row) {
  if (row == null || typeof row !== "object") return row;
  return new Proxy(row, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && !(prop in target)) {
        const lower = prop.toLowerCase();
        if (lower in target) return target[lower];
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === "string" && prop.toLowerCase() in target) return true;
      return Reflect.has(target, prop);
    },
  });
}
