import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "open-sse/executors/default.js";

describe("Anthropic API-key beta headers", () => {
  it.each([undefined, "claude-haiku-5-5", "claude-opus-5-5"])(
    "does not label API-key requests as Claude Code traffic (model: %s)",
    (model) => {
      const headers = new DefaultExecutor("anthropic").buildHeaders(
        { apiKey: "sk-test-api-key" }, true, undefined, model
      );
      const flags = headers["Anthropic-Beta"].split(",");

      expect(flags).not.toContain("claude-code-20250219");
      expect(flags).toContain("interleaved-thinking-2025-05-14");
      expect(headers["x-api-key"]).toBe("sk-test-api-key");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      expect(headers["Accept"]).toBe("text/event-stream");
    }
  );

  it("still forwards client beta features alongside the API-key defaults", () => {
    const headers = new DefaultExecutor("anthropic").buildHeaders({
      apiKey: "sk-test-api-key",
      rawHeaders: { "anthropic-beta": "context-management-2025-06-27" },
    }, false, undefined, "claude-sonnet-5-5");

    expect(headers["Anthropic-Beta"].split(",")).toEqual([
      "interleaved-thinking-2025-05-14",
      "context-management-2025-06-27",
    ]);
    expect(headers["Accept"]).toBeUndefined();
  });

  it("keeps the Claude Code identity and OAuth authentication for the claude provider", () => {
    const headers = new DefaultExecutor("claude").buildHeaders(
      { accessToken: "test-oauth-token" }, true, undefined, "claude-sonnet-5-5"
    );

    expect(headers["Anthropic-Beta"].split(",")).toContain("claude-code-20250219");
    expect(headers["Anthropic-Beta"].split(",")).toContain("oauth-2025-04-20");
    expect(headers["Authorization"]).toBe("Bearer test-oauth-token");
    expect(headers["x-api-key"]).toBeUndefined();
  });
});
