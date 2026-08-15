import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  addCustomModelsBulk: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.jsonResponse },
}));

vi.mock("@/lib/db/index.js", () => ({
  addCustomModelsBulk: mocks.addCustomModelsBulk,
}));

const { POST } = await import("../../src/app/api/models/custom/bulk/route.js");

function request(body) {
  return { json: async () => body };
}

describe("POST /api/models/custom/bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addCustomModelsBulk.mockResolvedValue({ added: 2, skipped: 0 });
  });

  it("trims, dedupes and forwards ids to the repo", async () => {
    const response = await POST(request({ providerAlias: "openrouter", ids: ["a", " a ", "b", "a", ""] }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, added: 2, skipped: 0 });
    expect(mocks.addCustomModelsBulk).toHaveBeenCalledWith({
      providerAlias: "openrouter",
      type: "llm",
      ids: ["a", "b"],
    });
  });

  it("passes a non-default type through", async () => {
    mocks.addCustomModelsBulk.mockResolvedValue({ added: 1, skipped: 0 });
    await POST(request({ providerAlias: "voyage", type: "embedding", ids: ["voyage-3"] }));

    expect(mocks.addCustomModelsBulk).toHaveBeenCalledWith({
      providerAlias: "voyage",
      type: "embedding",
      ids: ["voyage-3"],
    });
  });

  it("rejects when providerAlias or ids are missing", async () => {
    expect((await POST(request({ ids: ["a"] }))).status).toBe(400);
    expect((await POST(request({ providerAlias: "x" }))).status).toBe(400);
    expect(mocks.addCustomModelsBulk).not.toHaveBeenCalled();
  });

  it("rejects an ids list with no usable strings", async () => {
    const response = await POST(request({ providerAlias: "x", ids: ["", "  "] }));

    expect(response.status).toBe(400);
    expect(mocks.addCustomModelsBulk).not.toHaveBeenCalled();
  });

  it("rejects more than 500 ids", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `m${i}`);
    const response = await POST(request({ providerAlias: "x", ids }));

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("500");
    expect(mocks.addCustomModelsBulk).not.toHaveBeenCalled();
  });

  it("returns 500 when the repo throws", async () => {
    mocks.addCustomModelsBulk.mockRejectedValue(new Error("db down"));
    const response = await POST(request({ providerAlias: "x", ids: ["a"] }));

    expect(response.status).toBe(500);
  });
});
