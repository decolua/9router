import { beforeEach, describe, expect, it, vi } from "vitest";

const listOpenCodeTokens = vi.fn();
const replaceOpenCodeTokens = vi.fn();

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
  replaceOpenCodeTokens,
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
    listOpenCodeTokens.mockResolvedValue([existingRecord]);
    replaceOpenCodeTokens.mockResolvedValue([]);

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
      mode: "device",
      metadata: { deviceName: "MacBook Pro", platform: "macOS" },
    });
    const persisted = replaceOpenCodeTokens.mock.calls[0][0][0];
    expect(persisted.tokenHash).toBe(existingRecord.tokenHash);
  });

  it("deletes the token on DELETE", async () => {
    listOpenCodeTokens.mockResolvedValue([existingRecord, { ...existingRecord, id: "token-2" }]);
    replaceOpenCodeTokens.mockResolvedValue([]);

    const response = await DELETE(new Request("http://localhost/api/opencode/sync/tokens/token-1"), {
      params: { id: "token-1" },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(replaceOpenCodeTokens).toHaveBeenCalledWith([{ ...existingRecord, id: "token-2" }]);
  });
});
