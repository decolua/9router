import { describe, it, expect } from "vitest";
import deepseekRegistry from "../../open-sse/providers/registry/deepseek-web.js";
import { DeepSeekWebExecutor, resolveModelOptions } from "../../open-sse/executors/deepseek-web.js";

describe("deepseek-web provider integration", () => {
  it("exports valid registry metadata for webCookie category", () => {
    expect(deepseekRegistry.id).toBe("deepseek-web");
    expect(deepseekRegistry.category).toBe("webCookie");
    expect(deepseekRegistry.transport?.authType).toBe("cookie");
    expect(deepseekRegistry.models.length).toBeGreaterThan(0);
    expect(deepseekRegistry.models.map((m) => m.id)).toContain("deepseek-chat");
    expect(deepseekRegistry.models.map((m) => m.id)).toContain("deepseek-reasoner");
    expect(deepseekRegistry.models.map((m) => m.id)).toContain("deepseek-v4.1-flash");
    expect(deepseekRegistry.models.map((m) => m.id)).toContain("deepseek-v4.1-pro");
    expect(deepseekRegistry.models.map((m) => m.id)).toContain("deepseek-v4.1-reasoner");
  });

  it.each([
    ["deepseek-v4.1-flash", "default", false],
    ["deepseek-v4.1-pro", "expert", false],
    ["deepseek-v4.1-reasoner", "expert", true],
    ["deepseek-reasoner", "expert", true],
    ["deepseek-r1", "expert", true],
  ])("maps %s to its DeepSeek Web mode and thinking flag", (model, modelType, thinkingEnabled) => {
    expect(resolveModelOptions(model, {})).toEqual({
      modelType,
      thinkingEnabled,
      searchEnabled: false,
    });
  });

  it("instantiates DeepSeekWebExecutor without errors", () => {
    const executor = new DeepSeekWebExecutor();
    expect(executor).toBeDefined();
    expect(typeof executor.execute).toBe("function");
  });
});
