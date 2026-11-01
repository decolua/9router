import { describe, it, expect } from "vitest";
import zaiRegistry from "../../open-sse/providers/registry/zai-web.js";
import { ZaiWebExecutor } from "../../open-sse/executors/zai-web.js";

describe("zai-web provider integration", () => {
  it("exports valid registry metadata for webCookie category", () => {
    expect(zaiRegistry.id).toBe("zai-web");
    expect(zaiRegistry.category).toBe("webCookie");
    expect(zaiRegistry.transport?.authType).toBe("cookie");
    expect(zaiRegistry.models.length).toBeGreaterThan(0);
    expect(zaiRegistry.models.map((m) => m.id)).toContain("glm-5.3");
  });

  it("instantiates ZaiWebExecutor without errors", () => {
    const executor = new ZaiWebExecutor();
    expect(executor).toBeDefined();
    expect(typeof executor.execute).toBe("function");
  });
});
