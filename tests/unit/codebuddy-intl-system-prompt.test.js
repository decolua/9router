import { describe, it, expect } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

describe("CodeBuddyIntlExecutor system prompt & agent sanitization", () => {
  const exec = new CodeBuddyIntlExecutor();

  it("forwards user custom system prompt when provided", () => {
    const out = exec.transformRequest(
      "deepseek-v4.1-flash",
      {
        messages: [
          { role: "system", content: "You are a professional translator." },
          { role: "user", content: "Translate this text." },
        ],
      },
      false,
      {}
    );

    expect(out.messages[0]).toEqual({
      role: "system",
      content: "You are a professional translator.",
    });
    expect(out.messages[1]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Translate this text." }],
    });
  });

  it("falls back to default system prompt when omitted by client", () => {
    const out = exec.transformRequest(
      "deepseek-v4.1-flash",
      {
        messages: [{ role: "user", content: "Hello" }],
      },
      false,
      {}
    );

    expect(out.messages[0]).toEqual({
      role: "system",
      content: "You are CodeBuddy Code.",
    });
    expect(out.messages[1]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Hello" }],
    });
  });

  it("neutralizes sensitive third-party agent identity to prevent WAF rejection", () => {
    const out = exec.transformRequest(
      "deepseek-v4.1-flash",
      {
        messages: [
          {
            role: "system",
            content: "You are Claude Code, Anthropic's official CLI for coding.",
          },
          { role: "user", content: "Fix this bug" },
        ],
      },
      false,
      {}
    );

    expect(out.messages[0]).toEqual({
      role: "system",
      content: "You are a helpful AI assistant that helps with software engineering tasks.",
    });
  });
});
