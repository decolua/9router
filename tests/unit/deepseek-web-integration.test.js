import { describe, it, expect } from "vitest";
import deepseekRegistry from "../../open-sse/providers/registry/deepseek-web.js";
import { DeepSeekWebExecutor } from "../../open-sse/executors/deepseek-web.js";

describe("deepseek-web provider integration", () => {
  it("exports valid registry metadata for webCookie category", () => {
    expect(deepseekRegistry.id).toBe("deepseek-web");
    expect(deepseekRegistry.category).toBe("webCookie");
    expect(deepseekRegistry.transport?.authType).toBe("cookie");
    expect(deepseekRegistry.models.length).toBeGreaterThan(0);
    expect(deepseekRegistry.models.map((m) => m.id)).toContain("deepseek-chat");
    expect(deepseekRegistry.models.map((m) => m.id)).toContain("deepseek-reasoner");
  });

  it("instantiates DeepSeekWebExecutor without errors", () => {
    const executor = new DeepSeekWebExecutor();
    expect(executor).toBeDefined();
    expect(typeof executor.execute).toBe("function");
  });
});
