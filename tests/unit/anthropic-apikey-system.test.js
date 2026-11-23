import { describe, it, expect } from "vitest";
import { prepareClaudeRequest } from "open-sse/translator/formats/claude.js";

// Console API keys reject a "You are Claude Code" system block with a fake "credit balance too low" 400.
describe("anthropic API-key provider drops the Claude Code identity system block", () => {
  const CC = "You are Claude Code, Anthropic's official CLI for Claude.";
  const body = () => ({ model: "claude-opus-5-5", messages: [{ role: "user", content: "hi" }],
    system: [{ type: "text", text: CC }, { type: "text", text: "Be terse." }] });

  it("strips it for provider=anthropic, keeps the user's own system text", () => {
    const out = prepareClaudeRequest(body(), "anthropic", "sk-ant-api03-x");
    expect(out.system.map((b) => b.text)).toEqual(["Be terse."]);
  });

  it("removes system entirely when only the identity block was present", () => {
    const b = body(); b.system = [{ type: "text", text: CC }];
    expect(prepareClaudeRequest(b, "anthropic", "sk-ant-api03-x").system).toBeUndefined();
  });

  it("strips it from a string system prompt (native /v1/messages from Claude Code)", () => {
    const b = body(); b.system = CC + "\nBe terse.";
    expect(prepareClaudeRequest(b, "anthropic", "sk-ant-api03-x").system).toBe("Be terse.");
    const sdk = body(); sdk.system = [{ type: "text", text: "x-anthropic-billing-header: cc_version=2.1.289;" },
      { type: "text", text: "You are a Claude agent, built on Anthropic's Claude Agent SDK." }, { type: "text", text: "Be terse." }];
    expect(prepareClaudeRequest(sdk, "anthropic", "sk-ant-api03-x").system.map((x) => x.text)).toEqual(["Be terse."]);
    const only = body(); only.system = CC;
    expect(prepareClaudeRequest(only, "anthropic", "sk-ant-api03-x").system).toBeUndefined();
  });

  it("keeps it for the subscription (claude) provider", () => {
    const out = prepareClaudeRequest(body(), "claude", "sk-ant-oat-x");
    expect(JSON.stringify(out.system)).toContain("You are Claude Code");
  });
});
