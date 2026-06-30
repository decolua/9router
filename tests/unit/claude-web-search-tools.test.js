import { describe, it, expect } from "vitest";

import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

describe("Claude web_search request translation", () => {
  it("keeps Claude web_search as a native Responses tool", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "search the docs" }],
        },
      ],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          allowed_domains: ["docs.example.com"],
          max_uses: 2,
        },
      ],
      tool_choice: { type: "tool", name: "web_search" },
      stream: true,
    };

    const openAIRequest = claudeToOpenAIRequest(
      "gpt-5.3-codex",
      JSON.parse(JSON.stringify(body)),
      true,
    );
    const result = openaiToOpenAIResponsesRequest("gpt-5.3-codex", openAIRequest, true);

    expect(result.tools[0].type).toBe("web_search_20250305");
    expect(result.tools[0].function).toBeUndefined();
    expect(result.tool_choice).toEqual({ type: "web_search" });
  });
});
