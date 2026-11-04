// RED test for #4914: handleDisconnect must abort immediately (no 500ms delay)
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("stream disconnect abort immediate (#4914)", () => {
  let createStreamController;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../open-sse/utils/streamHandler.js");
    createStreamController = mod.createStreamController;
  });

  it("abortController.signal.aborted is true immediately after handleDisconnect", () => {
    const ctrl = createStreamController({
      provider: "test",
      model: "test-model",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(ctrl.signal.aborted).toBe(false);

    ctrl.handleDisconnect("client_closed");

    // Must be aborted synchronously — no setTimeout delay
    expect(ctrl.signal.aborted).toBe(true);
  });

  it("handleDisconnect is idempotent", () => {
    const ctrl = createStreamController({
      provider: "test",
      model: "test-model",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    ctrl.handleDisconnect("client_closed");
    ctrl.handleDisconnect("client_closed"); // second call should not throw

    expect(ctrl.signal.aborted).toBe(true);
  });

  it("handleComplete after disconnect is no-op", () => {
    const ctrl = createStreamController({
      provider: "test",
      model: "test-model",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    ctrl.handleDisconnect("client_closed");
    ctrl.handleComplete(); // should not throw

    expect(ctrl.signal.aborted).toBe(true);
  });

  it("handleError after disconnect is no-op", () => {
    const ctrl = createStreamController({
      provider: "test",
      model: "test-model",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    ctrl.handleDisconnect("client_closed");
    ctrl.handleError(new Error("test error")); // should not throw

    expect(ctrl.signal.aborted).toBe(true);
  });
});