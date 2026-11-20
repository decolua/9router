import { describe, it, expect } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

const makeBody = (header) => ({
  messages: [
    { role: "system", content: `${header}You are a careful assistant.` },
    { role: "user", content: "hello" }
  ]
});

describe("openaiToClaudeRequest - Anthropic billing header", () => {
  it("produces identical system text for header variants", () => {
    const typed = makeBody("x-anthropic-billing-header: cc_version=1.2.3; cc_entrypoint=cli;\n");
    const cron = makeBody("x-anthropic-billing-header: cc_version=1.2.3; cc_entrypoint=cli; cc_workload=cron;\n");

    const a = openaiToClaudeRequest("claude-sonnet-4.5", typed, false);
    const b = openaiToClaudeRequest("claude-sonnet-4.5", cron, false);

    expect(a.system[1].text).toBe("You are a careful assistant.");
    expect(b.system[1].text).toBe(a.system[1].text);
    expect(a.system[1].text).not.toMatch(/x-anthropic-billing-header/i);
  });

  it("drops a system message that is only the billing header", () => {
    const result = openaiToClaudeRequest("claude-sonnet-4.5", {
      messages: [
        { role: "system", content: "x-anthropic-billing-header: cc_version=1.2.3;\n" },
        { role: "user", content: "hello" }
      ]
    }, false);
    expect(result.system).toHaveLength(1);
  });

  it("keeps unrelated system text unchanged", () => {
    const result = openaiToClaudeRequest("claude-sonnet-4.5", makeBody("Be concise.\n"), false);
    expect(result.system[1].text).toBe("Be concise.\nYou are a careful assistant.");
  });
});
