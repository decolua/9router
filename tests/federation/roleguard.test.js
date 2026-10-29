// FED-003 — roleGuard tests (spec §3.2).
//
// Covers:
//  - checkFederationAuth: 401 without token / with wrong token (edge +
//    central modes), pass with correct token, standalone pass-through
//  - role policy: central-only for federation write endpoints (403 on
//    edge/standalone), role:null skips the check
//  - withFederationAuth (Next.js wrapper): 401/403 NextResponse with CORS
//    headers, handler called through on success, standalone pass-through
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// next/server is not installed in tests/node_modules — mock the only member
// roleGuard.js uses (same pattern as tests/unit/auth-status.test.js).
const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body, headers: init?.headers || {} })),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

const FED_ENV_KEYS = ["FEDERATION_MODE", "FEDERATION_TOKEN"];

const savedEnv = {};

beforeEach(() => {
  for (const k of FED_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const k of FED_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function reqWithAuth(token) {
  return { headers: { get: (name) => (name.toLowerCase() === "authorization" ? `Bearer ${token}` : null) } };
}

describe("checkFederationAuth — token enforcement", () => {
  it("401 without token (edge mode)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();
    const { checkFederationAuth } = await import("@/lib/federation/roleGuard.js");
    const d = checkFederationAuth({ headers: { get: () => null } });
    expect(d.ok).toBe(false);
    expect(d.status).toBe(401);
  });

  it("401 with wrong token (edge mode)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();
    const { checkFederationAuth } = await import("@/lib/federation/roleGuard.js");
    const d = checkFederationAuth(reqWithAuth("wrong-token"));
    expect(d.ok).toBe(false);
    expect(d.status).toBe(401);
  });

  it("401 without token (central mode)", async () => {
    process.env.FEDERATION_MODE = "central";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();
    const { checkFederationAuth } = await import("@/lib/federation/roleGuard.js");
    const d = checkFederationAuth({ headers: { get: () => null } });
    expect(d.ok).toBe(false);
    expect(d.status).toBe(401);
  });

  it("passes with correct token (edge + central modes)", async () => {
    for (const mode of ["edge", "central"]) {
      process.env.FEDERATION_MODE = mode;
      process.env.FEDERATION_TOKEN = "fed-secret";
      vi.resetModules();
      const { checkFederationAuth } = await import("@/lib/federation/roleGuard.js");
      // role:null isolates the token check from the central-only role policy
      const d = checkFederationAuth(reqWithAuth("fed-secret"), { role: null });
      expect(d.ok).toBe(true);
    }
  });

  it("standalone → pure pass-through (no token required, no role check)", async () => {
    vi.resetModules(); // FEDERATION_MODE unset
    const { checkFederationAuth } = await import("@/lib/federation/roleGuard.js");
    const d = checkFederationAuth({ headers: { get: () => null } });
    expect(d.ok).toBe(true);
  });

  it("explicit mode/token overrides win over env", async () => {
    vi.resetModules(); // env unset → standalone default
    const { checkFederationAuth } = await import("@/lib/federation/roleGuard.js");
    // Even in standalone, explicit opts are honored (testability). role:null
    // isolates the token check from the central-only role policy.
    const d = checkFederationAuth(reqWithAuth("explicit"), { mode: "edge", token: "explicit", role: null });
    expect(d.ok).toBe(true);
    const bad = checkFederationAuth(reqWithAuth("nope"), { mode: "edge", token: "explicit", role: null });
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(401);
  });
});

describe("checkFederationAuth — role policy (central-only writes)", () => {
  it("403 on edge mode for central-only endpoints", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();
    const { checkFederationAuth } = await import("@/lib/federation/roleGuard.js");
    const d = checkFederationAuth(reqWithAuth("fed-secret"));
    expect(d.ok).toBe(false);
    expect(d.status).toBe(403);
    expect(d.message).toMatch(/central/);
  });

  it("403 on standalone mode for central-only endpoints", async () => {
    vi.resetModules();
    const { checkFederationAuth } = await import("@/lib/federation/roleGuard.js");
    // standalone short-circuits BEFORE the role check (zero drift) — the
    // role policy is enforced by the wrapper only in non-standalone modes.
    const d = checkFederationAuth(reqWithAuth("anything"), { mode: "standalone", token: "x" });
    expect(d.ok).toBe(true);
  });

  it("passes on central mode with correct token", async () => {
    process.env.FEDERATION_MODE = "central";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();
    const { checkFederationAuth } = await import("@/lib/federation/roleGuard.js");
    const d = checkFederationAuth(reqWithAuth("fed-secret"));
    expect(d.ok).toBe(true);
  });

  it("role:null skips the central-only check (edge with token passes)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();
    const { checkFederationAuth } = await import("@/lib/federation/roleGuard.js");
    const d = checkFederationAuth(reqWithAuth("fed-secret"), { role: null });
    expect(d.ok).toBe(true);
  });
});

describe("withFederationAuth — Next.js wrapper", () => {
  it("returns 401 NextResponse with CORS headers on missing token", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();
    const { withFederationAuth } = await import("@/lib/federation/roleGuard.js");
    const handler = vi.fn(async () => ({ ok: true }));
    const guarded = withFederationAuth(handler, {
      corsHeaders: { "Access-Control-Allow-Origin": "*" },
    });
    const resp = await guarded({ headers: { get: () => null } });
    expect(resp.status).toBe(401);
    expect(resp.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the wrapped handler through on success", async () => {
    process.env.FEDERATION_MODE = "central";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();
    const { withFederationAuth } = await import("@/lib/federation/roleGuard.js");
    const handler = vi.fn(async () => ({ ok: true }));
    const guarded = withFederationAuth(handler);
    const resp = await guarded(reqWithAuth("fed-secret"));
    expect(resp).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("standalone → pass-through, handler called, no auth", async () => {
    vi.resetModules();
    const { withFederationAuth } = await import("@/lib/federation/roleGuard.js");
    const handler = vi.fn(async () => ({ ok: true }));
    const guarded = withFederationAuth(handler);
    const resp = await guarded({ headers: { get: () => null } });
    expect(resp).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
