import { describe, expect, it } from "vitest";
import { normalizeClaudeBaseUrl } from "../../src/shared/utils/claudeSettings.js";

describe("Claude Code settings", () => {
  it("stores the Anthropic base root because Claude Code appends /v1/messages", () => {
    expect(normalizeClaudeBaseUrl("http://127.0.0.1:20128/v1")).toBe("http://127.0.0.1:20128");
    expect(normalizeClaudeBaseUrl("http://127.0.0.1:20128/v1/")).toBe("http://127.0.0.1:20128");
    expect(normalizeClaudeBaseUrl("https://api.kimi.com/coding/v1")).toBe("https://api.kimi.com/coding");
    expect(normalizeClaudeBaseUrl("https://api.kimi.com/coding/")).toBe("https://api.kimi.com/coding");
  });
});
