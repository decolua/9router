# Plan 002: Guard SSRF in `/api/headroom/probe`

> **Executor instructions**: Follow step by step. Run every verification command and confirm expected output before proceeding. STOP on any mismatch — do not improvise.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `1271db0`, 2026-06-19 (target file `src/app/api/headroom/probe/route.js` is untracked — `?? src/app/api/headroom/` in git status)

## Why this matters

`GET /api/headroom/probe?url=<arbitrary>` does a server-side `fetch()` to any user-supplied URL with no host validation. An attacker (or any user when `requireLogin=false`) can probe internal services — cloud metadata endpoints (`169.254.169.254`), intranet hosts, `file://` URIs (if the runtime honors them), or any RFC-1918 address — and exfiltrate information via response status, timing, or body content. This is a textbook SSRF vulnerability introduced in the most recent session.

Headroom is designed to run **on the same machine** as 9router. The probe should be **loopback-only by default**. An explicit admin-allowlisted URL list (stored in settings) can extend this if the user genuinely needs to probe a remote headroom server. DNS rebinding must be guarded: resolve the hostname, validate the IP, then connect to the IP — not the hostname.

## Current state

`src/app/api/headroom/probe/route.js` (82 lines, untracked). Key vulnerable code:

```js
// Line 15-40: probeUrl does fetch() to any URL
async function probeUrl(url) {
  const endpoint = `${String(url).replace(/\/$/, "")}/v1/compress`;
  // ...
  const res = await fetch(endpoint, { method: "POST", /* ... */ });
  // ...
}

// Line 45-81: GET handler accepts ?url=<anything>
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const custom = searchParams.get("url");
  if (custom) {
    const result = await probeUrl(custom);  // ← SSRF: no validation
    return NextResponse.json({ url: custom, ...result });
  }
  // default candidates (localhost:8787, 127.0.0.1:8787) — safe but should be gated too
}
```

No URL validation, no IP check, no scheme restriction. The `CANDIDATE_URLS` array is hardcoded to loopback — that's safe — but the `?url=` branch is wide open.

Repo conventions: error responses return `NextResponse.json({ error: "..." }, { status: N })`. Settings are read via `getSettings()` from `@/lib/localDb`. The route uses `export const dynamic = "force-dynamic"`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `cd /home/cortexos/Developer/github.com/bloodf/9router && npx vitest run --config tests/vitest.config.js tests/unit/headroom-ssrf-guard.test.js` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/app/api/headroom/probe/route.js` — add URL validation + loopback gate
- `tests/unit/headroom-ssrf-guard.test.js` (create)

**Out of scope**:
- Do NOT modify the headroom compression page (`src/app/(dashboard)/dashboard/system/compress/headroom/page.js`) — it calls the probe endpoint and will continue to work because its default candidates are loopback.
- Do NOT modify `open-sse/rtk/headroom.js` (the compression consumer).
- Do NOT add admin allowlist storage to settings — the plan stubs it as a future enhancement (see Maintenance Notes). Loopback-only is sufficient for now.

## Steps

### Step 1: Add URL validation helper

Add a `validateProbeUrl(input)` function to `src/app/api/headroom/probe/route.js` before `probeUrl`:

```js
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Allowlist for non-loopback hosts (admin-configured via settings, future).
// Currently empty — only loopback is allowed.
const REMOTE_HOST_ALLOWLIST = new Set([]);

function validateProbeUrl(input) {
  if (!input || typeof input !== "string") {
    return { ok: false, error: "URL required" };
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, error: `Scheme "${parsed.protocol}" not allowed (http/https only)` };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(hostname) || REMOTE_HOST_ALLOWLIST.has(hostname)) {
    return { ok: true, url: parsed };
  }
  return { ok: false, error: `Host "${hostname}" not allowed — probe is loopback-only. Set headroomUrl manually for remote servers.` };
}
```

**Verify**: Read the file — `validateProbeUrl` function exists, `LOOPBACK_HOSTS` contains localhost/127.0.0.1/::1, `REMOTE_HOST_ALLOWLIST` is empty.

### Step 2: Gate the `?url=` branch

In the `GET` handler, replace the unguarded custom-URL fetch:

```js
// BEFORE (line 50-53):
if (custom) {
  const result = await probeUrl(custom);
  return NextResponse.json({ url: custom, ...result });
}

// AFTER:
if (custom) {
  const validation = validateProbeUrl(custom);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
  }
  const result = await probeUrl(validation.url.origin);
  return NextResponse.json({ url: validation.url.origin, ...result });
}
```

Note: use `validation.url.origin` (normalized) rather than the raw input to prevent path/query injection.

**Verify**: Read the GET handler — `validateProbeUrl` is called before `probeUrl` for the custom branch; rejection returns `{ status: 400 }`.

### Step 3: Write SSRF guard tests

Create `tests/unit/headroom-ssrf-guard.test.js`. Test `validateProbeUrl` directly by importing the function (export it from the route module, or duplicate the pure logic in a shared helper — simplest: export it).

If exporting from a Next.js route module is problematic (Next may tree-shake non-handler exports), extract `validateProbeUrl` and the host constants into `src/lib/headroom/probeGuard.js` and import from both the route and the test.

```js
import { describe, it, expect } from "vitest";
import { validateProbeUrl } from "../../src/lib/headroom/probeGuard.js";

describe("headroom probe SSRF guard", () => {
  it("allows localhost", () => {
    expect(validateProbeUrl("http://localhost:8787").ok).toBe(true);
  });
  it("allows 127.0.0.1", () => {
    expect(validateProbeUrl("http://127.0.0.1:8787").ok).toBe(true);
  });
  it("allows ::1", () => {
    expect(validateProbeUrl("http://[::1]:8787").ok).toBe(true);
  });
  it("rejects external host", () => {
    const r = validateProbeUrl("http://169.254.169.254/latest/meta-data/");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("loopback-only");
  });
  it("rejects RFC-1918 private range", () => {
    expect(validateProbeUrl("http://192.168.1.1:8787").ok).toBe(false);
    expect(validateProbeUrl("http://10.0.0.1:8787").ok).toBe(false);
  });
  it("rejects cloud metadata endpoint", () => {
    expect(validateProbeUrl("http://169.254.169.254").ok).toBe(false);
  });
  it("rejects non-http scheme", () => {
    expect(validateProbeUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateProbeUrl("gopher://localhost:6379/").ok).toBe(false);
  });
  it("rejects invalid URL", () => {
    expect(validateProbeUrl("not-a-url").ok).toBe(false);
    expect(validateProbeUrl("").ok).toBe(false);
    expect(validateProbeUrl(null).ok).toBe(false);
  });
});
```

**Verify**: `npx vitest run --config tests/vitest.config.js tests/unit/headroom-ssrf-guard.test.js` → all pass.

## Done criteria

- [ ] `validateProbeUrl` exists and is tested
- [ ] `?url=http://169.254.169.254` returns `{ status: 400 }` with error mentioning "loopback-only"
- [ ] `?url=http://localhost:8787` still works (200)
- [ ] `?url=file:///etc/passwd` returns 400
- [ ] All SSRF guard tests pass
- [ ] `npm run build` exits 0
- [ ] No files outside in-scope list are modified

## STOP conditions

- The route file doesn't match the excerpts (it's untracked and may have been modified since the plan was written).
- Exporting `validateProbeUrl` from the route module fails — instead extract to `src/lib/headroom/probeGuard.js` and import in both places.
- The existing default-candidate probe (no `?url=` param) breaks — it should still work because CANDIDATE_URLS are all loopback.

## Maintenance notes

- **Future: admin allowlist** — if users genuinely need to probe a remote headroom server, add a `headroomAllowlistedHosts` array to settings and populate `REMOTE_HOST_ALLOWLIST` from it at request time. This is deliberately deferred; loopback-only is the secure default.
- **DNS rebinding** — `validateProbeUrl` checks the hostname string, not the resolved IP. A hostname like `evil.com` could resolve to `127.0.0.1` (safe) or `169.254.169.254` (unsafe). Since the allowlist only accepts explicit hostnames, not arbitrary DNS, this is not currently exploitable. If a remote allowlist is added later, resolve the hostname, validate ALL resolved IPs against the allowlist, and connect to the IP directly.
- The headroom compression page (`headroom/page.js`) calls `/api/headroom/probe?url=...` with the user-entered URL. After this fix, a non-loopback URL will return 400 and the page shows the error banner. This is correct behavior — the user must run headroom locally or set the URL manually without probing.
