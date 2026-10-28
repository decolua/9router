import { describe, expect, it } from "vitest";

import { POST } from "../../src/app/api/v1/messages/count_tokens/route.js";

async function countTokens(body) {
  const response = await POST(new Request("https://9router.local/v1/messages/count_tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

  expect(response.status).toBe(200);
  return response.json();
}

describe("Anthropic count_tokens estimator", () => {
  it("preserves the existing plain text estimate", async () => {
    const result = await countTokens({
      messages: [
        {
          role: "user",
          content: "hello world",
        },
      ],
    });

    expect(result.input_tokens).toBe(3);
  });

  it("counts tool and thinking content blocks that carry context", async () => {
    const result = await countTokens({
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_01",
              name: "Read",
              input: { file_path: "/tmp/example.txt" },
            },
            {
              type: "thinking",
              thinking: "Need to inspect the file before answering.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_01",
              content: "line1 line2 line3 some file content here",
            },
          ],
        },
      ],
    });

    expect(result.input_tokens).toBeGreaterThan(0);
  });

  it("counts system prompts and tool definitions", async () => {
    const result = await countTokens({
      system: "You are a coding assistant.",
      tools: [
        {
          name: "Read",
          description: "Read a file",
          input_schema: {
            type: "object",
            properties: {
              file_path: { type: "string" },
            },
          },
        },
      ],
      messages: [],
    });

    expect(result.input_tokens).toBeGreaterThan(0);
  });

  it("handles OPTIONS CORS preflight requests", async () => {
    const { OPTIONS } = await import("../../src/app/api/v1/messages/count_tokens/route.js");
    const response = await OPTIONS();
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
  });

  it("returns 400 error when request contains invalid JSON", async () => {
    const response = await POST(new Request("https://9router.local/v1/messages/count_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json ...",
    }));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid JSON body");
  });

  it("handles empty or null payloads gracefully", async () => {
    const result = await countTokens({});
    expect(result.input_tokens).toBe(0);
  });
});

