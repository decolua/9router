// Federation route-handler guard (FED-003) — spec §3.2.
//
// Shared helper for requests that BYPASS custom-server.js (tests, alternate
// hosting, direct route invocation): enforces the FEDERATION_TOKEN Bearer
// auth that FED-002 explicitly left out of server.js, plus the central-only
// role policy for federation write endpoints.
//
// Two layers:
//   - checkFederationAuth(request, opts) — pure, framework-free decision
//     function (returns { ok:true } or { ok:false, status, message }). Fully
//     testable without next/server.
//   - withFederationAuth(handler, opts) — Next.js-compatible wrapper that
//     translates a rejection into a NextResponse (401/403) and otherwise
//     calls through to the wrapped route handler.
//
// Standalone mode: pure pass-through — no auth, no role check, zero drift.
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isStandalone, isCentral, getToken } from "./config.js";

// Constant-time Bearer token comparison (SHA-256 pre-hash so timingSafeEqual
// sees equal-length inputs regardless of the real token length).
function tokenMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(String(provided)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

// Pure decision function. opts:
//   - role: "central" (default) — the wrapped endpoint is central-only;
//     non-central modes get 403. Pass null to skip the role check.
//   - token: expected FEDERATION_TOKEN (defaults to config getToken()).
//   - mode: "standalone" | "central" | "edge" (defaults to config getMode()).
// Returns { ok: true } or { ok: false, status, message }.
export function checkFederationAuth(request, { role = "central", token = null, mode = null } = {}) {
  const m = mode || (isStandalone() ? "standalone" : isCentral() ? "central" : "edge");
  if (m === "standalone") return { ok: true }; // zero drift

  const expected = token || getToken();
  const header = request?.headers?.get?.("authorization") || request?.headers?.authorization || "";
  const provided = String(header).startsWith("Bearer ") ? String(header).slice(7) : "";
  if (!tokenMatches(provided, expected)) {
    return { ok: false, status: 401, message: "Missing or invalid FEDERATION_TOKEN" };
  }

  if (role === "central" && m !== "central") {
    return { ok: false, status: 403, message: "This endpoint is only served by the central federation instance" };
  }
  return { ok: true };
}

// Next.js-compatible wrapper. `handler` is the route's GET/POST function;
// opts pass through to checkFederationAuth plus corsHeaders (merged into
// 401/403 responses so CORS keeps working).
export function withFederationAuth(handler, { role = "central", corsHeaders = null, token = null, mode = null } = {}) {
  return async function federationGuarded(request, ...rest) {
    const decision = checkFederationAuth(request, { role, token, mode });
    if (!decision.ok) {
      return NextResponse.json(
        { error: decision.message },
        { status: decision.status, headers: corsHeaders || undefined }
      );
    }
    return handler(request, ...rest);
  };
}
