// DF-9ROUTER-56 — the dashboard guard's remote /v1 401 must speak the OpenAI
// error envelope. OpenAI SDK consumers read `error.type` / `error.code`; the
// old flat body `{"error":"API key required for remote API access"}` left both
// undefined, and the SAME auth failure answered two different shapes depending
// on entry path (the endpoint handlers already answered
// authentication_error / invalid_api_key through buildErrorBody).
//
// This file drives the REAL guard against the REAL OpenAI error builder —
// only Next's response objects, the DB seam and the auth seams are mocked —
// and pins both no-regression contracts: loopback stays keyless and
// REQUIRE_API_KEY=false still lets remote keyless traffic through.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
}));

const { proxy } = await import("../../src/dashboardGuard.js");
const { buildErrorBody } = await import("../../open-sse/utils/error.js");
const { HTTP_STATUS } = await import("../../open-sse/config/runtimeConfig.js");

const PEER_TOKEN = "df-56-peer-token";

function request(pathname, headers = {}) {
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers(headers),
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

function localRequest(pathname, headers = {}) {
  return request(pathname, {
    host: "localhost:20128",
    "x-9r-peer-token": PEER_TOKEN,
    "x-9r-real-ip": "127.0.0.1",
    ...headers,
  });
}

// The exact envelope the acceptance criteria name (OpenAI-compatible).
const EXPECTED_ENVELOPE = {
  message: "API key required for remote API access",
  type: "authentication_error",
  code: "invalid_api_key",
};

// Shared shape-builder: proves the guard's body EQUALS the shared builder's
// output for 401 — same source of truth the endpoint handlers use.
function expectEnvelope(body) {
  expect(body).toEqual({ error: EXPECTED_ENVELOPE });
  expect(body).toEqual(buildErrorBody(HTTP_STATUS.UNAUTHORIZED, EXPECTED_ENVELOPE.message));
}

describe("guard remote /v1 401 speaks the OpenAI error envelope (DF-9ROUTER-56)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
    mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("chat/completions with an INVALID bearer key from a remote IP → 401 OpenAI envelope", async () => {
    const response = await proxy(request("/v1/chat/completions", {
      host: "router.example.com",
      authorization: "Bearer sk-definitely-not-a-key",
    }));

    expect(response.status).toBe(401);
    expectEnvelope(response.body);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-definitely-not-a-key");
  });

  it("chat/completions with a MISSING key from a remote IP → the same envelope", async () => {
    const response = await proxy(request("/v1/chat/completions", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expectEnvelope(response.body);
  });

  it("the rewritten /api/v1 surface answers the same envelope", async () => {
    const response = await proxy(request("/api/v1/chat/completions", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expectEnvelope(response.body);
  });

  it("the guard's body is the SHARED builder's output — one source of truth", () => {
    // If buildErrorBody(401) ever drifts from the acceptance envelope, both
    // halves of this assertion fail: the guard tests above AND this direct pin.
    expect(buildErrorBody(401, EXPECTED_ENVELOPE.message)).toEqual({ error: EXPECTED_ENVELOPE });
  });
});

describe("no regression: the paths that must NOT change (DF-9ROUTER-56)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("loopback requests still pass with no key at all", async () => {
    const response = await proxy(localRequest("/v1/chat/completions", { host: "localhost:20128" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("REQUIRE_API_KEY=false still lets remote keyless traffic through", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: false });

    const response = await proxy(request("/v1/chat/completions", { host: "router.example.com" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("settings-read failures still fail CLOSED — and in the envelope", async () => {
    mocks.getSettings.mockRejectedValue(new Error("db unavailable"));

    const response = await proxy(request("/v1/chat/completions", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expectEnvelope(response.body);
  });

  it("dashboard /api/* 401 keeps its FLAT body — the envelope is /v1-only", async () => {
    const response = await proxy(request("/api/keys", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });
});
