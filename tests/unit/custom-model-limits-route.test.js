import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addCustomModel: vi.fn(),
}));

vi.mock("@/models", () => ({
  getCustomModels: vi.fn(),
  addCustomModel: mocks.addCustomModel,
  deleteCustomModel: vi.fn(),
}));

const { POST } = await import("../../src/app/api/models/custom/route.js");

function request(body) {
  return new Request("https://router.test/api/models/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("custom model limit persistence route", () => {
  beforeEach(() => {
    mocks.addCustomModel.mockReset().mockResolvedValue(true);
  });

  it("accepts top-level compatibility names and stores canonical caps", async () => {
    const response = await POST(request({
      providerAlias: "provider-a",
      id: "model-a",
      max_input_tokens: 131072,
      max_output_tokens: 8192,
    }));

    expect(response.status).toBe(200);
    expect(mocks.addCustomModel).toHaveBeenCalledWith({
      providerAlias: "provider-a",
      id: "model-a",
      type: "llm",
      name: undefined,
      caps: { contextWindow: 131072, maxOutput: 8192 },
    });
  });

  it("prefers an explicit context length over max input tokens", async () => {
    await POST(request({
      providerAlias: "provider-a",
      id: "model-a",
      context_length: 64000,
      max_input_tokens: 32000,
    }));

    expect(mocks.addCustomModel.mock.calls[0][0].caps.contextWindow).toBe(64000);
  });

  it("accepts direct canonical fields in caps", async () => {
    await POST(request({
      providerAlias: "provider-a",
      id: "model-a",
      caps: { contextWindow: 100000, maxOutput: 4000, vision: true },
    }));

    expect(mocks.addCustomModel.mock.calls[0][0].caps).toEqual({
      vision: true,
      contextWindow: 100000,
      maxOutput: 4000,
    });
  });

  it("rejects invalid explicitly supplied limits", async () => {
    const response = await POST(request({
      providerAlias: "provider-a",
      id: "model-a",
      contextWindow: false,
    }));

    expect(response.status).toBe(400);
    expect(mocks.addCustomModel).not.toHaveBeenCalled();
  });

  it("rejects numeric strings from the manual persistence API", async () => {
    const response = await POST(request({
      providerAlias: "provider-a",
      id: "model-a",
      context_length: "131072",
    }));

    expect(response.status).toBe(400);
    expect(mocks.addCustomModel).not.toHaveBeenCalled();
  });
});
