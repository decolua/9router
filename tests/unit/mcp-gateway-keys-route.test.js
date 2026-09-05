import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  jsonResponse: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  getGatewayKeys: vi.fn(),
  createGatewayKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  isLocalRequest: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: mocks.jsonResponse,
  },
}));

vi.mock("@/lib/localDb", () => ({
  getGatewayKeys: mocks.getGatewayKeys,
  createGatewayKey: mocks.createGatewayKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/dashboardGuard", () => ({
  isLocalRequest: mocks.isLocalRequest,
}));

// Import after mocks are set up
const { GET, POST } = await import("../../src/app/api/mcp-gateway/keys/route");

function request(headers = {}, body = null) {
  const normalizedHeaders = new Headers(headers);
  return {
    headers: normalizedHeaders,
    json: vi.fn().mockResolvedValue(body || {}),
    url: `http://localhost/api/mcp-gateway/keys`,
  };
}

describe("MCP Gateway Keys GET endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns list of keys with secrets stripped", async () => {
    const mockKeys = [
      { id: "1", name: "key1", key: "secret1", createdAt: "2024-01-01" },
      { id: "2", name: "key2", key: "secret2", createdAt: "2024-01-02" },
    ];
    mocks.getGatewayKeys.mockResolvedValue(mockKeys);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.keys).toHaveLength(2);
    expect(response.body.keys[0]).not.toHaveProperty("key");
    expect(response.body.keys[1]).not.toHaveProperty("key");
    expect(response.body.keys[0].id).toBe("1");
    expect(response.body.keys[1].id).toBe("2");
  });

  it("handles empty key list", async () => {
    mocks.getGatewayKeys.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.keys).toEqual([]);
  });

  it("handles database errors", async () => {
    mocks.getGatewayKeys.mockRejectedValue(new Error("Database connection failed"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Database connection failed");
  });
});

describe("MCP Gateway Keys POST endpoint - local-only hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsistentMachineId.mockResolvedValue("test-machine-id");
  });

  it("rejects key creation from remote requests", async () => {
    mocks.isLocalRequest.mockReturnValue(false);

    const req = request({ host: "remote.example.com" }, { name: "test-key" });
    const response = await POST(req);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Key creation is only available from local requests.");
    expect(mocks.createGatewayKey).not.toHaveBeenCalled();
  });

  it("allows key creation from local requests", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    const mockKey = {
      id: "new-key-id",
      name: "test-key",
      key: "gw_secret_key_123",
      createdAt: "2024-01-01",
    };
    mocks.createGatewayKey.mockResolvedValue(mockKey);

    const req = request({ host: "localhost:20128" }, { name: "test-key" });
    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(response.body.key).toEqual(mockKey);
    expect(response.body.key.key).toBe("gw_secret_key_123");
    expect(mocks.createGatewayKey).toHaveBeenCalledWith("test-key", "test-machine-id");
  });

  it("allows key creation with no name from local requests", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    const mockKey = {
      id: "new-key-id",
      name: null,
      key: "gw_secret_key_456",
      createdAt: "2024-01-01",
    };
    mocks.createGatewayKey.mockResolvedValue(mockKey);

    const req = request({ host: "localhost:20128" }, {});
    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(response.body.key).toEqual(mockKey);
    expect(mocks.createGatewayKey).toHaveBeenCalledWith(null, "test-machine-id");
  });

  it("rejects key creation from loopback with proxy header", async () => {
    mocks.isLocalRequest.mockReturnValue(false);

    const req = request(
      {
        host: "localhost:20128",
        "x-9r-via-proxy": "true",
        "x-9r-real-ip": "10.0.0.1",
      },
      { name: "test-key" }
    );
    const response = await POST(req);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Key creation is only available from local requests.");
    expect(mocks.createGatewayKey).not.toHaveBeenCalled();
  });

  it("handles database errors during key creation", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    mocks.createGatewayKey.mockRejectedValue(new Error("Database write failed"));

    const req = request({ host: "localhost:20128" }, { name: "test-key" });
    const response = await POST(req);

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Database write failed");
  });

  it("handles malformed JSON body", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    const mockKey = {
      id: "new-key-id",
      name: null,
      key: "gw_secret_key_789",
      createdAt: "2024-01-01",
    };
    mocks.createGatewayKey.mockResolvedValue(mockKey);

    const req = request({ host: "localhost:20128" });
    req.json.mockRejectedValue(new Error("Invalid JSON"));

    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(mocks.createGatewayKey).toHaveBeenCalledWith(null, "test-machine-id");
  });
});
