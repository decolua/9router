import { beforeEach, describe, expect, it, vi } from "vitest";

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
  mutateOpenCodeTokens,
}));

vi.mock("@/lib/opencodeSync/tokens.js", async () => {
  const actual = await vi.importActual("../../src/lib/opencodeSync/tokens.js");
  return actual;
});

let PATCH;
let DELETE;

const existingRecord = {
  id: "token-1",
  name: "Laptop",
  mode: "device",
  metadata: { deviceName: "MacBook" },
  tokenHash: "a".repeat(64),
  createdAt: "2026-04-21T00:00:00.000Z",
  updatedAt: "2026-04-21T00:00:00.000Z",
};

describe("/api/opencode/sync/tokens/[id]", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/app/api/opencode/sync/tokens/[id]/route.js");
    PATCH = mod.PATCH;
    DELETE = mod.DELETE;
  });

  it("updates editable fields on PATCH and returns a public record", async () => {
    mutateOpenCodeTokens.mockImplementation(async (mutator) => {
      const result = mutator([existingRecord]);
      return result.tokens;
    });

    const response = await PATCH(
      new Request("http://localhost/api/opencode/sync/tokens/token-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Updated Laptop",
          metadata: { deviceName: "MacBook Pro", platform: "macOS" },
        }),
      }),
      { params: { id: "token-1" } }
    );

    expect(response.status).toBe(200);
    expect(response.body.record).toMatchObject({
      id: "token-1",
      name: "Updated Laptop",
      metadata: { deviceName: "MacBook Pro", platform: "macOS" },
    });
    expect(response.body.record).not.toHaveProperty("mode");
    const persistedResult = await mutateOpenCodeTokens.mock.results[0].value;
    const persisted = persistedResult[0];
    expect(persisted.tokenHash).toBe(existingRecord.tokenHash);
  });

  it("deletes the token on DELETE", async () => {
    mutateOpenCodeTokens.mockImplementation(async (mutator) => {
      const result = mutator([existingRecord, { ...existingRecord, id: "token-2" }]);
      return result.tokens;
    });

    const response = await DELETE(new Request("http://localhost/api/opencode/sync/tokens/token-1"), {
      params: { id: "token-1" },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mutateOpenCodeTokens).toHaveBeenCalledTimes(1);
    const persisted = await mutateOpenCodeTokens.mock.results[0].value;
    expect(persisted).toEqual([{ ...existingRecord, id: "token-2" }]);
  });

  it("returns 404 when token id does not exist", async () => {
    mutateOpenCodeTokens.mockImplementation(async (mutator) => {
      const result = mutator([existingRecord]);
      return result.tokens;
    });

    const response = await PATCH(
      new Request("http://localhost/api/opencode/sync/tokens/missing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Nope" }),
      }),
      { params: { id: "missing" } }
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Token not found" });
  });

  it("ignores mode updates on PATCH and keeps mode internal-only", async () => {
    mutateOpenCodeTokens.mockImplementation(async (mutator) => {
      const result = mutator([existingRecord]);
      return result.tokens;
    });

    const response = await PATCH(
      new Request("http://localhost/api/opencode/sync/tokens/token-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "shared" }),
      }),
      { params: { id: "token-1" } }
    );

    expect(response.status).toBe(200);
    expect(response.body.record).not.toHaveProperty("mode");
    const persistedResult = await mutateOpenCodeTokens.mock.results[0].value;
    const persisted = persistedResult[0];
    expect(persisted.mode).toBe("device");
  });
});
