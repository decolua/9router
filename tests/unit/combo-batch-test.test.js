import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/localDb", () => ({
  getComboById: vi.fn(),
}));

vi.mock("@/app/api/models/test/ping", () => ({
  pingModelByKind: vi.fn(),
}));

import { POST } from "@/app/api/combos/[id]/test-models/route.js";
import { getComboById } from "@/lib/localDb";
import { pingModelByKind } from "@/app/api/models/test/ping";

describe("POST /api/combos/[id]/test-models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when no models are provided and combo has no models", async () => {
    getComboById.mockResolvedValueOnce({ id: "combo-1", name: "test-combo", models: [] });

    const request = new Request("http://localhost/api/combos/combo-1/test-models", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: "combo-1" });

    const response = await POST(request, { params });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("No models");
  });

  it("returns 404 when combo ID is not found and no draft models provided", async () => {
    getComboById.mockResolvedValueOnce(null);

    const request = new Request("http://localhost/api/combos/non-existent/test-models", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: "non-existent" });

    const response = await POST(request, { params });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Combo not found");
  });

  it("tests models for an existing combo and computes dead/alive summary", async () => {
    getComboById.mockResolvedValueOnce({
      id: "c1",
      name: "my-combo",
      kind: "llm",
      models: ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"],
    });

    pingModelByKind.mockImplementation(async (model) => {
      if (model === "openai/gpt-4o") {
        return { ok: true, latencyMs: 250, error: null, status: 200 };
      }
      return { ok: false, latencyMs: 500, error: "HTTP 429: Rate limit", status: 429 };
    });

    const request = new Request("http://localhost/api/combos/c1/test-models", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: "c1" });

    const response = await POST(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      total: 2,
      alive: 1,
      dead: 1,
    });
    expect(data.results).toHaveLength(2);
    expect(data.results[0]).toEqual({
      model: "openai/gpt-4o",
      ok: true,
      latencyMs: 250,
      error: null,
      status: 200,
    });
    expect(data.results[1]).toEqual({
      model: "anthropic/claude-3-5-sonnet",
      ok: false,
      latencyMs: 500,
      error: "HTTP 429: Rate limit",
      status: 429,
    });
  });

  it("supports draft testing by providing models in the body directly", async () => {
    pingModelByKind.mockResolvedValue({
      ok: true,
      latencyMs: 120,
      error: null,
      status: 200,
    });

    const request = new Request("http://localhost/api/combos/draft/test-models", {
      method: "POST",
      body: JSON.stringify({
        models: ["groq/llama-3.3-70b-versatile"],
        kind: "llm",
      }),
    });
    const params = Promise.resolve({ id: "draft" });

    const response = await POST(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.alive).toBe(1);
    expect(data.summary.dead).toBe(0);
    expect(getComboById).not.toHaveBeenCalled();
  });
});
