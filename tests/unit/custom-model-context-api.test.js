import { beforeEach, describe, expect, it, vi } from "vitest";

const addCustomModel = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/models", () => ({
  getCustomModels: vi.fn(async () => []),
  addCustomModel,
  deleteCustomModel: vi.fn(),
}));

const { POST } = await import("../../src/app/api/models/custom/route.js");

function request(contextWindow) {
  return new Request("http://localhost/api/models/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerAlias: "glm", id: "glm-5.3", caps: { contextWindow } }),
  });
}

describe("POST /api/models/custom context override", () => {
  beforeEach(() => addCustomModel.mockClear());

  it("persists a positive integer context window and accepts null to clear it", async () => {
    expect((await POST(request(262144))).status).toBe(200);
    expect(addCustomModel).toHaveBeenLastCalledWith(expect.objectContaining({ caps: { contextWindow: 262144 } }));

    expect((await POST(request(null))).status).toBe(200);
    expect(addCustomModel).toHaveBeenLastCalledWith(expect.objectContaining({ caps: { contextWindow: null } }));
  });

  it.each([0, -1, 1.5, "262144"])("rejects invalid context window %j", async (value) => {
    expect((await POST(request(value))).status).toBe(400);
  });
});