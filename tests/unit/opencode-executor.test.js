import { describe, it, expect } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

describe("OpenCodeExecutor.buildUrl (runtimeTransport)", () => {
  it("uses runtimeTransport baseUrl when present (free Responses model)", () => {
    const ex = new OpenCodeExecutor();
    const url = ex.buildUrl("muse-spark-1.2-contributor-free", true, 0, { runtimeTransport: { baseUrl: "https://opencode.ai/zen/v1/responses" } });
    expect(url).toBe("https://opencode.ai/zen/v1/responses");
  });

  it("appends urlSuffix when runtimeTransport carries one", () => {
    const ex = new OpenCodeExecutor();
    const url = ex.buildUrl("muse-spark-1.2-contributor-free", true, 0, { runtimeTransport: { baseUrl: "https://opencode.ai/zen/v1", urlSuffix: "/responses" } });
    expect(url).toBe("https://opencode.ai/zen/v1/responses");
  });

  it("keeps /zen/v1/chat/completions for models without a runtime transport", () => {
    const ex = new OpenCodeExecutor();
    expect(ex.buildUrl("deepseek-v4-flash", true, 0, {})).toBe("https://opencode.ai/zen/v1/chat/completions");
  });
});
