import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminApiKeyStatus: vi.fn(),
  createOrRotateAdminApiKey: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
      });
    },
  },
}));

vi.mock("@/lib/auth/adminApiKey", () => ({
  getAdminApiKeyStatus: mocks.getAdminApiKeyStatus,
  createOrRotateAdminApiKey: mocks.createOrRotateAdminApiKey,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

class MockAdminApiKeyRotationConflictError extends Error {
  constructor() {
    super("conflict");
    this.name = "AdminApiKeyRotationConflictError";
  }
}

vi.mock("@/lib/localDb", () => ({
  AdminApiKeyRotationConflictError: MockAdminApiKeyRotationConflictError,
}));

const { GET, POST } = await import("../../src/app/api/settings/admin-key/route.js");

function makeRequest({
  method = "GET",
  headers = {},
  body,
  authToken,
} = {}) {
  const normalizedHeaders = new Headers(headers);
  return {
    method,
    headers: normalizedHeaders,
    cookies: {
      get: vi.fn((name) => {
        if (name !== "auth_token" || !authToken) return undefined;
        return { value: authToken };
      }),
    },
    json: vi.fn(async () => body),
  };
}

describe("settings admin-key route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.getAdminApiKeyStatus.mockResolvedValue({
      configured: true,
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
    });
    mocks.createOrRotateAdminApiKey.mockResolvedValue({
      key: "9r-admin-new",
      status: {
        configured: true,
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });
  });

  it("rejects status reads without jwt or cli token", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.getAdminApiKeyStatus).not.toHaveBeenCalled();
  });

  it("rejects remote rotation without jwt even if dashboard login is disabled elsewhere", async () => {
    const response = await POST(makeRequest({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { expectedUpdatedAt: "" },
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.createOrRotateAdminApiKey).not.toHaveBeenCalled();
  });

  it("allows jwt-authenticated rotation and forwards expectedUpdatedAt", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);

    const response = await POST(makeRequest({
      method: "POST",
      authToken: "jwt-token",
      headers: { "Content-Type": "application/json" },
      body: { expectedUpdatedAt: "2026-06-23T00:00:00.000Z" },
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({
      key: "9r-admin-new",
      status: {
        configured: true,
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });
    expect(mocks.createOrRotateAdminApiKey).toHaveBeenCalledWith(
      expect.any(Date),
      { expectedUpdatedAt: "2026-06-23T00:00:00.000Z" }
    );
  });

  it("allows cli-token access without jwt", async () => {
    const response = await GET(makeRequest({
      headers: { "x-9r-cli-token": "cli-token" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: true,
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
    });
  });

  it("returns 409 without plaintext when rotation hits a stale version", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    mocks.createOrRotateAdminApiKey.mockRejectedValue(new MockAdminApiKeyRotationConflictError());

    const response = await POST(makeRequest({
      method: "POST",
      authToken: "jwt-token",
      headers: { "Content-Type": "application/json" },
      body: { expectedUpdatedAt: "2026-06-22T00:00:00.000Z" },
    }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      error: "Admin API key changed. Reload status and try again.",
    });
    expect(payload).not.toHaveProperty("key");
  });

  it("rejects non-string expectedUpdatedAt values", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);

    const response = await POST(makeRequest({
      method: "POST",
      authToken: "jwt-token",
      headers: { "Content-Type": "application/json" },
      body: { expectedUpdatedAt: 123 },
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "expectedUpdatedAt must be a string",
    });
    expect(mocks.createOrRotateAdminApiKey).not.toHaveBeenCalled();
  });

  it("requires json body and expectedUpdatedAt for rotation", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);

    const missingJson = await POST(makeRequest({
      method: "POST",
      authToken: "jwt-token",
    }));
    const missingExpected = await POST(makeRequest({
      method: "POST",
      authToken: "jwt-token",
      headers: { "Content-Type": "application/json" },
      body: {},
    }));

    expect(missingJson.status).toBe(400);
    expect(await missingJson.json()).toEqual({
      error: "Request body must be JSON",
    });
    expect(missingExpected.status).toBe(400);
    expect(await missingExpected.json()).toEqual({
      error: "expectedUpdatedAt must be a string",
    });
    expect(mocks.createOrRotateAdminApiKey).not.toHaveBeenCalled();
  });

  it("rejects malformed json bodies", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    const request = makeRequest({
      method: "POST",
      authToken: "jwt-token",
      headers: { "Content-Type": "application/json" },
    });
    request.json.mockRejectedValue(new SyntaxError("Unexpected token"));

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mocks.createOrRotateAdminApiKey).not.toHaveBeenCalled();
  });
});
