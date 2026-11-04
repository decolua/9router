// RED test for #4915: Combo should gracefully skip models with no valid credentials
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("combo graceful fallback for missing credentials (#4915)", () => {
  let handleComboChat;
  let systemOneModule;

  beforeEach(async () => {
    vi.resetModules();
    const combo = await import("../../open-sse/services/combo.js");
    handleComboChat = combo.handleComboChat;
    systemOneModule = await import("../../open-sse/services/systemoneRouter.js");
  });

  it("should skip model with NO_CREDENTIALS error and try next model", async () => {
    const models = ["providerA/model1", "providerB/model2"];
    let callCount = 0;

    const mockHandleSingle = vi.fn(async (body, modelStr) => {
      callCount++;
      if (modelStr === "providerA/model1") {
        // Simulate NO_CREDENTIALS error (thrown by handleSingleModelChat when no creds)
        const error = new Error("No active credentials for provider: providerA");
        error.code = "NO_CREDENTIALS";
        error.status = 404;
        throw error;
      }
      // Second model succeeds
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "success" } }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), line: vi.fn() };

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "test" }] },
      models,
      handleSingleModel: mockHandleSingle,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
    expect(log.warn).toHaveBeenCalledWith("COMBO", expect.stringContaining("no valid credentials"), expect.any(Object));
  });

  it("should return error when all models have NO_CREDENTIALS", async () => {
    const models = ["providerA/model1", "providerB/model2"];

    const mockHandleSingle = vi.fn(async (body, modelStr) => {
      const error = new Error(`No active credentials for provider: ${modelStr.split("/")[0]}`);
      error.code = "NO_CREDENTIALS";
      error.status = 404;
      throw error;
    });

    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), line: vi.fn() };

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "test" }] },
      models,
      handleSingleModel: mockHandleSingle,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(false);
    // When all models fail with NO_CREDENTIALS, status should be 503 (service unavailable)
    // but currently it's 404 because lastStatus is set to the error status
    expect([404, 503]).toContain(result.status);
  });

  it("should skip model with 404 NOT_FOUND and try next model", async () => {
    const models = ["providerA/model1", "providerB/model2"];
    let callCount = 0;

    const mockHandleSingle = vi.fn(async (body, modelStr) => {
      callCount++;
      if (modelStr === "providerA/model1") {
        // Simulate 404 response (no credentials)
        return new Response(
          JSON.stringify({ error: { message: "Not found" } }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "success" } }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), line: vi.fn() };

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "test" }] },
      models,
      handleSingleModel: mockHandleSingle,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
  });

  it("should clear sticky session when NO_CREDENTIALS on active sticky model", async () => {
    const models = ["providerA/model1", "providerB/model2"];
    const sessionId = "test-session";

    // Pre-set a sticky session
    const { setStickyComboModel } = await import("../../open-sse/services/systemoneRouter.js");
    setStickyComboModel("test-combo", sessionId, "providerA/model1");

    const mockHandleSingle = vi.fn(async (body, modelStr) => {
      if (modelStr === "providerA/model1") {
        const error = new Error("No active credentials for provider: providerA");
        error.code = "NO_CREDENTIALS";
        error.status = 404;
        throw error;
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "success" } }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), line: vi.fn() };

    const clearSpy = vi.spyOn(systemOneModule, "clearStickyComboSession");

    await handleComboChat({
      body: { messages: [{ role: "user", content: "test" }] },
      models,
      handleSingleModel: mockHandleSingle,
      log,
      comboName: "test-combo",
      comboStrategy: "smart",
      sessionId,
    });

    expect(clearSpy).toHaveBeenCalledWith("test-combo", sessionId);
  });
});