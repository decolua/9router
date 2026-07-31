import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
}));

vi.mock("@/lib/codexNative/pool.js", () => ({
  acquireCodexNativeLease: (...args) => mocks.acquire(...args),
  failCodexNativeLease: vi.fn(),
  getCodexNativeLease: vi.fn(),
  getCodexNativeMetrics: vi.fn(() => ({})),
  ingestCodexNativeQuota: vi.fn(),
  markCodexNativeSemanticOutput: vi.fn(),
  releaseCodexNativeLease: vi.fn(),
  succeedCodexNativeLease: vi.fn(),
  validateCodexNativeLeaseModel: vi.fn(),
}));
vi.mock("@/lib/codexNative/clientAuth.js", () => ({
  validateCodexNativeClient: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/codexNative/clientVersion.js", () => ({
  getInstalledCodexClientVersion: vi.fn(async () => ({
    installed: true,
    version: "0.146.0",
  })),
}));
vi.mock("@/lib/codexNative/catalog.js", () => ({
  getMostRecentCodexClientVersion: vi.fn(async () => "0.145.0"),
}));

describe("Codex Native process-internal lease API", () => {
  beforeEach(() => {
    process.env.CODEX_NATIVE_INTERNAL_SECRET = "process-secret";
    mocks.acquire.mockResolvedValue({
      lease: {
        id: "lease-1",
        connectionId: "account-1",
        credentials: {
          accessToken: "upstream-token",
          providerSpecificData: { chatgptAccountId: "account-binding" },
        },
        proxy: {},
      },
    });
  });

  afterEach(() => {
    delete process.env.CODEX_NATIVE_INTERNAL_SECRET;
    vi.clearAllMocks();
  });

  it("rejects the correct secret when the TCP peer is not loopback", async () => {
    const { POST } = await import("@/app/api/internal/codex-native/lease/[action]/route.js");
    const response = await POST(new Request("http://router/api/internal/codex-native/lease/acquire", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-9r-internal-secret": "process-secret",
        "x-9r-real-ip": "203.0.113.8",
      },
      body: JSON.stringify({ requestHeaders: { authorization: "Bearer client-key" } }),
    }), { params: Promise.resolve({ action: "acquire" }) });
    expect(response.status).toBe(403);
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it("returns rebuilt upstream credentials only to a secret-authenticated loopback peer", async () => {
    const { POST } = await import("@/app/api/internal/codex-native/lease/[action]/route.js");
    const response = await POST(new Request("http://router/api/internal/codex-native/lease/acquire", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-9r-internal-secret": "process-secret",
        "x-9r-real-ip": "::ffff:127.0.0.1",
      },
      body: JSON.stringify({
        requestHeaders: {
          authorization: "Bearer client-key",
          cookie: "client-secret=1",
          "session-id": "session-1",
        },
      }),
    }), { params: Promise.resolve({ action: "acquire" }) });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.upstreamHeaders.authorization).toBe("Bearer upstream-token");
    expect(payload.upstreamHeaders["chatgpt-account-id"]).toBe("account-binding");
    expect(payload.upstreamHeaders.cookie).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("client-key");
    expect(mocks.acquire).toHaveBeenCalledWith(expect.objectContaining({
      clientVersion: "0.146.0",
    }));
  });
});
