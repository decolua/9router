import { describe, expect, it } from "vitest";
import { GeminiCLIExecutor } from "../../open-sse/executors/gemini-cli.js";

describe("GeminiCLIExecutor stateless header generation", () => {
  it("generates correct User-Agent per model without instance state leakage", () => {
    const executor = new GeminiCLIExecutor();
    const creds = { accessToken: "test-token" };

    // Simulate interleaved calls for different models
    executor.transformRequest("gemini-2.0-flash", { prompt: "hello" }, false, creds);
    executor.transformRequest("gemini-1.5-pro", { prompt: "world" }, false, creds);

    const headersFlash = executor.buildHeaders(creds, false, null, "gemini-2.0-flash");
    const headersPro = executor.buildHeaders(creds, false, null, "gemini-1.5-pro");

    expect(headersFlash["User-Agent"]).toContain("gemini-2.0-flash");
    expect(headersPro["User-Agent"]).toContain("gemini-1.5-pro");
    expect(headersFlash["Authorization"]).toBe("Bearer test-token");
    expect(headersPro["Authorization"]).toBe("Bearer test-token");
  });
});
