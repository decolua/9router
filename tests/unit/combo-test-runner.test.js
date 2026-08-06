import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB repos and ping function before importing routes
vi.mock("../../src/lib/localDb.js", () => ({
  getComboById: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("../../src/app/api/models/test/ping.js", () => ({
  pingModelByKind: vi.fn(),
}));

import { getComboById, getSettings } from "../../src/lib/localDb.js";
import { pingModelByKind } from "../../src/app/api/models/test/ping.js";
import { POST as testComboById } from "../../src/app/api/combos/[id]/test/route.js";
import { POST as testAdhocCombo } from "../../src/app/api/combos/test/route.js";

describe("Combo Test Runner API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({
      comboStrategy: "fallback",
      comboStrategies: {},
    });
  });

  it("returns 404 if combo ID is not found and no inline models provided", async () => {
    getComboById.mockResolvedValue(null);

    const req = new Request("http://localhost/api/combos/nonexistent/test", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await testComboById(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Combo not found");
  });

  it("executes fallback sequence when model 1 fails and model 2 succeeds", async () => {
    const mockCombo = {
      id: "combo-123",
      name: "smart-combo",
      kind: "llm",
      models: ["openai/gpt-4o-mini", "anthropic/claude-3-5-sonnet", "google/gemini-1.5-pro"],
    };
    getComboById.mockResolvedValue(mockCombo);

    // Mock ping responses: Model 1 fails, Model 2 succeeds
    pingModelByKind
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        latencyMs: 150,
        error: "HTTP 401: Invalid API Key",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        latencyMs: 420,
        error: null,
        preview: "Hello! I am Claude.",
      });

    const req = new Request("http://localhost/api/combos/combo-123/test", {
      method: "POST",
      body: JSON.stringify({ prompt: "Test prompt", mode: "fallback" }),
    });

    const res = await testComboById(req, { params: Promise.resolve({ id: "combo-123" }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.comboStatus).toBe("success");
    expect(data.servingModel).toBe("anthropic/claude-3-5-sonnet");
    expect(data.servedStepIndex).toBe(2);
    expect(data.steps).toHaveLength(3);

    // Step 1: Failed & Triggered Fallback
    expect(data.steps[0]).toMatchObject({
      index: 1,
      model: "openai/gpt-4o-mini",
      ok: false,
      status: 401,
      fallbackTriggered: true,
      servedRequest: false,
    });

    // Step 2: Succeeded & Served Request
    expect(data.steps[1]).toMatchObject({
      index: 2,
      model: "anthropic/claude-3-5-sonnet",
      ok: true,
      status: 200,
      preview: "Hello! I am Claude.",
      fallbackTriggered: false,
      servedRequest: true,
    });

    // Step 3: Skipped in fallback mode
    expect(data.steps[2]).toMatchObject({
      index: 3,
      model: "google/gemini-1.5-pro",
      skipped: true,
    });
  });

  it("tests all models in full diagnostic mode (mode='all')", async () => {
    const mockCombo = {
      id: "combo-123",
      name: "smart-combo",
      kind: "llm",
      models: ["model-a", "model-b"],
    };
    getComboById.mockResolvedValue(mockCombo);

    pingModelByKind
      .mockResolvedValueOnce({ ok: true, status: 200, latencyMs: 200, preview: "Model A response" })
      .mockResolvedValueOnce({ ok: true, status: 200, latencyMs: 300, preview: "Model B response" });

    const req = new Request("http://localhost/api/combos/combo-123/test", {
      method: "POST",
      body: JSON.stringify({ mode: "all" }),
    });

    const res = await testComboById(req, { params: Promise.resolve({ id: "combo-123" }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.steps).toHaveLength(2);
    expect(data.steps[0].skipped).toBe(false);
    expect(data.steps[1].skipped).toBe(false);
  });

  it("handles ad-hoc unsaved combo testing via /api/combos/test", async () => {
    pingModelByKind.mockResolvedValueOnce({
      ok: true,
      status: 200,
      latencyMs: 350,
      preview: "Adhoc response",
    });

    const req = new Request("http://localhost/api/combos/test", {
      method: "POST",
      body: JSON.stringify({
        name: "My Unsaved Combo",
        models: ["openai/gpt-4o"],
        kind: "llm",
        prompt: "Ping test",
      }),
    });

    const res = await testAdhocCombo(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.comboName).toBe("My Unsaved Combo");
    expect(data.comboStatus).toBe("success");
    expect(data.servingModel).toBe("openai/gpt-4o");
  });
});
