import { beforeEach, describe, expect, it, vi } from "vitest";

const listOpenCodeTokens = vi.fn();
const mutateOpenCodeTokens = vi.fn();

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/models", () => ({
  listOpenCodeTokens,
  mutateOpenCodeTokens,
}));

vi.mock("@/lib/opencodeSync/tokens.js", async () => {
  const actual = await vi.importActual("../../src/lib/opencodeSync/tokens.js");
  return actual;
});

let GET;
let POST;

describe("/api/opencode/sync/tokens", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/app/api/opencode/sync/tokens/route.js");
    GET = mod.GET;
    POST = mod.POST;
  });

  it("lists public token records on GET", async () => {
    listOpenCodeTokens.mockResolvedValue([
      {
        id: "token-1",
        name: "Laptop",
        mode: "device",
        metadata: { deviceName: "MacBook" },
        tokenHash: "abc123",
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      tokens: [
        {
          id: "token-1",
          name: "Laptop",
          metadata: { deviceName: "MacBook" },
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
          lastUsedAt: null,
        },
      ],
    });
  });

  it("creates and persists a hashed token on POST", async () => {
    mutateOpenCodeTokens.mockImplementation(async (mutator) => {
      const result = mutator([]);
      return result.tokens;
    });

    const response = await POST(
      new Request("http://localhost/api/opencode/sync/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Team iPad",
          mode: "shared",
          metadata: { owner: "support", platform: "ios" },
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(response.body.token).toMatch(/^ocs_/);
    expect(response.body.record).toMatchObject({
      name: "Team iPad",
      metadata: { owner: "support", platform: "ios" },
    });
    expect(response.body.record).not.toHaveProperty("mode");
    expect(mutateOpenCodeTokens).toHaveBeenCalledTimes(1);
    const persisted = mutateOpenCodeTokens.mock.results[0].value;
    const resolvedTokens = await persisted;
    const saved = resolvedTokens[0];
    expect(saved.tokenHash).toBeTypeOf("string");
    expect(saved.tokenHash).not.toBe(response.body.token);
    expect(saved).not.toHaveProperty("token");
  });
});
