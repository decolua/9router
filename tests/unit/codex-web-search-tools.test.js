import { describe, it, expect } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";

describe("CodexExecutor web search tools", () => {
  it("normalizes Claude Code web_search before sending to Codex", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.3-codex",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "search the docs" }],
        },
      ],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          allowed_domains: ["docs.example.com", ""],
          blocked_domains: ["internal.example.com"],
          max_uses: 2,
        },
      ],
      tool_choice: { type: "web_search" },
    };

    const result = executor.transformRequest("gpt-5.3-codex", body, true, {});

    expect(result.tools).toEqual([
      {
        type: "web_search",
        filters: { allowed_domains: ["docs.example.com"] },
      },
    ]);
    expect(result.tool_choice).toEqual({ type: "web_search" });
  });

  it("keeps OpenAI web_search_preview as a hosted tool", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.3-codex",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "search the web" }],
        },
      ],
      tools: [{ type: "web_search_preview", search_context_size: "low" }],
    };

    const result = executor.transformRequest("gpt-5.3-codex", body, true, {});

    expect(result.tools).toEqual([{ type: "web_search_preview", search_context_size: "low" }]);
  });
});
