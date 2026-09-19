import { NextResponse } from "next/server";
import { resetCircuitBreakersByPrefix } from "open-sse/utils/circuitBreaker.js";

export const dynamic = "force-dynamic";

/**
 * Reset breaker route.
 *
 * Real breaker keys are `provider:connectionId:model` (buildAccountBreakerName)
 * because upstream locks are per model, but the dashboard only knows the
 * account (`provider:connectionId`) — so this route resolves the account into
 * every per-model key underneath it. Keying the reset on an exact name made the
 * panel's button a silent no-op that still answered `{ ok: true }`, which is the
 * one thing a recovery endpoint must never do: an untrusted reset that reports
 * success is indistinguishable from one that worked.
 *
 * Accepted shapes (first match wins):
 *   body/query  { provider, connectionId, model? }
 *   path [name] "provider:connectionId" or "provider:connectionId:model"
 */

function clean(value) {
  if (typeof value === "string") return value.trim() || null;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

/**
 * Next hands route params over already decoded; the panel URL-encodes the key,
 * so a second decode is needed only when percent-escapes survive. Decoding
 * unconditionally would corrupt identifiers that legitimately contain "%".
 */
function decodeNameSegment(raw) {
  const name = clean(raw);
  if (!name) return null;
  if (!/%[0-9a-fA-F]{2}/.test(name)) return name;
  try {
    return decodeURIComponent(name);
  } catch {
    return null;
  }
}

function readQuery(req) {
  const url = typeof req?.url === "string" ? req.url : null;
  if (!url) return null;
  try {
    return new URL(url, "http://localhost").searchParams;
  } catch {
    return null;
  }
}

async function readBody(req) {
  if (!req || typeof req.json !== "function") return null;
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // No/undecodable body: the path name or query string still identifies it.
    return null;
  }
}

/** @returns {{ prefix: string|null } | { error: string }} */
function resolvePrefix({ body, query, name }) {
  const provider = clean(body?.provider) || query?.get("provider") || null;
  const connectionId = clean(body?.connectionId) || query?.get("connectionId") || null;
  const model = clean(body?.model) || query?.get("model") || null;

  if (provider && connectionId) {
    const base = `${provider}:${connectionId}`;
    return { prefix: model ? `${base}:${model}` : base };
  }
  if (provider || connectionId) {
    return { error: "provider and connectionId must be supplied together" };
  }
  if (!name) return { error: "missing provider + connectionId (or breaker name)" };
  return { prefix: name };
}

export async function POST(req, ctx) {
  const params = (await ctx?.params) || {};
  const name = decodeNameSegment(params.name);
  if (params.name && name === null) {
    return NextResponse.json({ error: "malformed breaker name" }, { status: 400 });
  }

  const query = readQuery(req);
  const body = await readBody(req);
  const resolved = resolvePrefix({ body, query, name });

  if (resolved.error) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  const cleared = resetCircuitBreakersByPrefix(resolved.prefix);
  if (cleared.length === 0) {
    return NextResponse.json(
      { error: `no circuit breaker matched "${resolved.prefix}"`, prefix: resolved.prefix, cleared: [] },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ok: true,
    prefix: resolved.prefix,
    cleared,
    count: cleared.length,
  });
}
