/**
 * Unit tests for CodeBuddy CLI spoofing headers - SIMPLE VERSION
 */

import { describe, it, expect } from "vitest";
import DefaultExecutor from "open-sse/executors/default.js";

describe("CodeBuddy buildHeaders() - RED phase test", () => {
  it("should include X-App: cli header", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-App"]).toBe("cli");
  });

  it("should include X-Stainless-Runtime: node header", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-Stainless-Runtime"]).toBe("node");
  });

  it("should include X-Stainless-Lang: js header", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-Stainless-Lang"]).toBe("js");
  });

  it("should include X-Stainless-Helper-Method: stream header", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-Stainless-Helper-Method"]).toBe("stream");
  });

  it("should include X-Stainless-Retry-Count: 0 header", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-Stainless-Retry-Count"]).toBe("0");
  });
});
