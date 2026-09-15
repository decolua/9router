#!/usr/bin/env node
/**
 * Set / update the quota snapshot used by quota-weighted scheduling.
 *
 * This talks to the RUNNING 9router instance over its HTTP API (rather than
 * importing the DB layer directly) so it does not have to deal with the app's
 * bundler aliases / CJS-ESM interop.
 *
 * Usage:
 *   node scripts/set-quota.mjs --base http://localhost:3000 --list
 *   node scripts/set-quota.mjs --connection <idOrName> --remaining 1000 --total 1000 --reset 2026-09-24
 *   node scripts/set-quota.mjs --connection <idOrName> --clear
 *
 * The snapshot is stored at connection.providerSpecificData.quota as:
 *   { remaining: number, total: number|null, resetAt: ISO string|null }
 *
 * For Antigravity accounts the live quota cache (fetched from the upstream API)
 * takes precedence; this snapshot is the fallback for providers that do not
 * expose a usage endpoint.
 */

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function authHeaders(token) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function api(base, token, path, init) {
  const res = await fetch(`${base}${path}`, { headers: authHeaders(token), ...init });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    throw new Error(`${init?.method || "GET"} ${path} → ${res.status}: ${json?.error || text.slice(0, 200)}`);
  }
  return json;
}

function normalizeList(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.connections)) return json.connections;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = (args.base || process.env.NINEROUTER_BASE || "http://localhost:3000").replace(/\/$/, "");
  const token = args.token || process.env.NINEROUTER_TOKEN || "";

  const connections = normalizeList(await api(base, token, "/api/providers"));

  if (args.list) {
    if (connections.length === 0) {
      console.log("No connections returned by /api/providers.");
      return;
    }
    for (const c of connections) {
      const q = c.providerSpecificData?.quota;
      const shown = q
        ? `remaining=${q.remaining} total=${q.total ?? "-"} resetAt=${q.resetAt ?? "-"}`
        : "(no snapshot)";
      console.log(`${c.id}  ${c.name || c.email || ""}  provider=${c.provider}  ${shown}`);
    }
    return;
  }

  const key = args.connection;
  if (!key) {
    console.error("Missing --connection <idOrName>. Use --list to see connections.");
    process.exit(1);
  }

  const target = connections.find((c) => c.id === key || c.name === key || c.email === key);
  if (!target) {
    console.error(`No connection matched "${key}".`);
    process.exit(1);
  }

  const existing = target.providerSpecificData || {};
  let quota;
  if (args.clear) {
    quota = null;
  } else {
    const remaining = Number(args.remaining);
    if (!Number.isFinite(remaining)) {
      console.error("Missing/invalid --remaining <number>.");
      process.exit(1);
    }
    const total = args.total != null ? Number(args.total) : null;
    const resetAt = args.reset ? new Date(args.reset).toISOString() : (existing.quota?.resetAt ?? null);
    quota = { remaining, total, resetAt };
  }

  // Send ONLY the quota key. PUT /api/providers/[id] already merges
  // `providerSpecificData` over the stored object server-side, so echoing back the
  // whole blob we read from the API is both unnecessary and unsafe: the read path
  // strips/redacts sensitive fields, and writing that redacted copy back would
  // clobber the real stored credentials.
  await api(base, token, `/api/providers/${encodeURIComponent(target.id)}`, {
    method: "PUT",
    body: JSON.stringify({ providerSpecificData: { quota } }),
  });

  console.log(
    quota
      ? `Updated ${target.id} quota → remaining=${quota.remaining} total=${quota.total ?? "-"} resetAt=${quota.resetAt ?? "-"}`
      : `Cleared quota snapshot on ${target.id}.`
  );
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
