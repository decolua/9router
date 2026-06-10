import { describe, expect, it } from "vitest";

import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

describe("claudeToOpenAIRequest billing header handling", () => {
  it("strips Anthropic billing header from system text for OpenAI targets", () => {
    const result = claudeToOpenAIRequest("gpt-5.5", {
      system: [
        {
          type: "text",
          text: "x-anthropic-billing-header: cc_version=2.1.156.e2c; cc_entrypoint=sdk-cli; cch=4a0f6;\nYou are helpful.",
        },
      ],
      messages: [{ role: "user", content: "hi" }],
    }, true);

    expect(result.messages[0]).toEqual({
      role: "system",
      content: "You are helpful.",
    });
  });
});
