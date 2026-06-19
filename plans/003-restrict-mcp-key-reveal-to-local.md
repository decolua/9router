# Plan 003: Restrict `?reveal=1` to local requests on MCP gateway keys

> **Executor instructions**: Follow step by step. Run every verification command. STOP on mismatch.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `1271db0`, 2026-06-19 (target file modified in working tree: `M src/app/api/mcp-gateway/keys/[id]/route.js`)

## Why this matters

`GET /api/mcp-gateway/keys/[id]?reveal=1` returns the raw plaintext gateway key. Any authenticated dashboard user can fetch any key's plaintext by guessing or enumerating UUIDs — no additional auth check, no rate limit, no audit log. The list endpoint (`GET /api/mcp-gateway/keys`) correctly strips the key; this is the only plaintext-returning path and it's broad.

The fix: require the `?reveal=1` query to come from a loopback (local) request, using the existing `isLocalRequest` helper from `src/dashboardGuard.js`. Remote requests get 403. This matches the security posture of other local-only routes (the `LOCAL_ONLY_PATHS` pattern in `dashboardGuard.js:69-83`).

## Current state

`src/app/api/mcp-gateway/keys/[id]/route.js` — the vulnerable branch (lines 17-31):

```js
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const k = await getGatewayKeyById(id);
    if (!k) return NextResponse.json({ error: "not found" }, { status: 404 });
    const grants = await getGrantsForKeyDetailed(id);
    const url = new URL(request.url);
    const reveal = url.searchParams.get("reveal") === "1";
    // reveal=1 returns the raw key for local copy-to-clipboard.
    return NextResponse.json({ key: reveal ? k : stripKey(k), grants });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
```

The `isLocalRequest` helper exists in `src/dashboardGuard.js:112` and is exported:

```js
export function isLocalRequest(request) { /* checks hostname is loopback */ }
```

`LOOPBACK_HOSTS` is defined at `src/dashboardGuard.js:85`:
```js
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Build | `npm run build` | exit 0 |
| Test (manual curl) | `curl -s -o /dev/null -w "%{http_code}" "http://localhost:11434/api/mcp-gateway/keys/test-id?reveal=1"` | `200` or `404` (not 403 — local is allowed) |

## Scope

**In scope**:
- `src/app/api/mcp-gateway/keys/[id]/route.js`

**Out of scope**:
- Do NOT modify `src/dashboardGuard.js` — only import its `isLocalRequest` helper.
- Do NOT modify the MCP keys page UI — it calls this endpoint from the browser; when accessed via localhost (normal dashboard usage), it continues to work.
- Do NOT change the list endpoint (`GET /api/mcp-gateway/keys`) — it already strips keys correctly.

## Steps

### Step 1: Import `isLocalRequest` and gate `reveal=1`

Edit `src/app/api/mcp-gateway/keys/[id]/route.js`:

Add the import (after existing imports):
```js
import { isLocalRequest } from "@/dashboardGuard";
```

In the GET handler, after computing `reveal`, add a local-only gate:
```js
const reveal = url.searchParams.get("reveal") === "1";
if (reveal && !isLocalRequest(request)) {
  return NextResponse.json(
    { error: "Key reveal is only available from local requests." },
    { status: 403 }
  );
}
return NextResponse.json({ key: reveal ? k : stripKey(k), grants });
```

**Verify**: Read the file — `isLocalRequest` imported from `@/dashboardGuard`; `reveal && !isLocalRequest` check returns 403 before the key is sent.

### Step 2: Build and verify

```bash
cd /home/cortexos/Developer/github.com/bloodf/9router && npm run build
```

**Verify**: exit 0, no errors.

## Done criteria

- [ ] `?reveal=1` from a loopback request returns the raw key (200)
- [ ] `?reveal=1` from a non-loopback request returns `{ status: 403 }` with error message
- [ ] `?reveal=1` omitted (no reveal) still returns the stripped key (no change)
- [ ] `npm run build` exits 0
- [ ] No files outside in-scope list modified

## STOP conditions

- `isLocalRequest` is not exported from `src/dashboardGuard.js` (check line 112 — it should be `export function isLocalRequest`).
- The import path `@/dashboardGuard` doesn't resolve — check `jsconfig.json` for the `@` alias mapping.

## Maintenance notes

- The MCP keys page (`mcp-gateway/keys/page.js`) calls this endpoint from the browser. In normal local dashboard usage (localhost), `isLocalRequest` returns true and reveal works. If the dashboard is accessed via a tunnel (Tailscale, etc.), reveal will be blocked — this is correct security behavior; the user can copy the key from the creation modal instead.
- Future enhancement: add an admin-role check for remote reveal, reusing the admin API auth pattern from `src/app/api/v1/admin/_auth.js`.
