import { describe, it, expect } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

describe("CodeBuddyIntlExecutor system prompt & agent sanitization", () => {
  const exec = new CodeBuddyIntlExecutor();
  const cnExec = new CodeBuddyExecutor();

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

  it("preserves appended user rules (AGENTS.md) and long system prompts (>2000 chars) on codebuddy-cn and codebuddy-intl (#5777)", () => {
    const longRules = [
      "Instructions from: /workspace/AGENTS.md",
      "Always address the user as Captain.",
      "Follow strict repository guidelines. ".repeat(80),
    ].join("\n");
    const harnessPrompt = `You are an AI coding agent.\n\n${longRules}`;

    const cnOut = cnExec.transformRequest(
      "hy3",
      {
        messages: [
          { role: "system", content: harnessPrompt },
          { role: "user", content: "What form of address is prescribed?" },
        ],
      },
      false,
      {}
    );

    expect(cnOut.messages[0].content).toContain(
      "You are a helpful AI assistant that helps with software engineering tasks."
    );
    expect(cnOut.messages[0].content).not.toMatch(/You are an AI coding agent/i);
    expect(cnOut.messages[0].content).toContain("Instructions from: /workspace/AGENTS.md");
    expect(cnOut.messages[0].content).toContain("Always address the user as Captain.");

    const intlOut = exec.transformRequest(
      "deepseek-v4.1-flash",
      {
        messages: [
          { role: "system", content: harnessPrompt },
          { role: "user", content: "What form of address is prescribed?" },
        ],
      },
      false,
      {}
    );

    expect(intlOut.messages[0].content).toContain(
      "You are a helpful AI assistant that helps with software engineering tasks."
    );
    expect(intlOut.messages[0].content).not.toMatch(/You are an AI coding agent/i);
    expect(intlOut.messages[0].content).toContain("Instructions from: /workspace/AGENTS.md");
    expect(intlOut.messages[0].content).toContain("Always address the user as Captain.");
  });
});
