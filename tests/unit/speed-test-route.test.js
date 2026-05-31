import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: vi.fn(async () => [{ key: "internal-key", isActive: true }]),
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: vi.fn(async () => "machine-token"),
}));

vi.mock("@/shared/constants/config", () => ({
  UPDATER_CONFIG: { appPort: 20128 },
}));

function makeRequest(body) {
  return {
    json: vi.fn(async () => body),
  };
}

describe("POST /api/models/test speedTest", () => {
  const originalFetch = global.fetch;
  const originalNow = Date.now;

  beforeEach(() => {
    vi.resetModules();
    process.env.PORT = "20128";
    Date.now = vi.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(6_000);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Date.now = originalNow;
    delete process.env.PORT;
    vi.restoreAllMocks();
  });

  it("calculates TPS from reasoning tokens when completion_tokens is zero", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "" } }],
        usage: {
          completion_tokens: 0,
          completion_tokens_details: { reasoning_tokens: 50 },
        },
      }),
    }));

    const { POST } = await import("../../src/app/api/models/test/route.js");
    const res = await POST(makeRequest({ model: "kr/test-model", speedTest: true }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.latencyMs).toBe(5_000);
    expect(body.completionTokens).toBe(50);
    expect(body.tps).toBe(10);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:20128/api/v1/chat/completions",
      expect.objectContaining({
        body: expect.stringContaining('"max_tokens":300'),
      }),
    );
  });

  it("estimates TPS from visible content when usage metadata has no completion tokens", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "a".repeat(800) } }],
        usage: { completion_tokens: 0 },
      }),
    }));

    const { POST } = await import("../../src/app/api/models/test/route.js");
    const res = await POST(makeRequest({ model: "kr/test-model", speedTest: true }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.completionTokens).toBe(200);
    expect(body.tps).toBe(40);
  });
});
