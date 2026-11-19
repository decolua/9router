import { describe, it, expect } from "vitest";
import { dropClaudeCodeIdentitySystem } from "open-sse/translator/formats/claude.js";

// Claude Desktop (Cowork) / Claude Code bodies reach provider=anthropic via native passthrough
// with their identity blocks intact; Console API keys answer them with a fake "credit balance" 400.
describe("dropClaudeCodeIdentitySystem", () => {
  const cowork = () => ({
    model: "claude-sonnet-5-5",
    messages: [{ role: "user", content: "hi" }],
    system: [
      { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.326.91e; cc_entrypoint=local-agent;" },
      { type: "text", text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.", cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: "<application_details>Be terse.</application_details>" },
    ],
  });

  it("drops the billing header and Agent SDK identity, keeps the rest", () => {
    expect(dropClaudeCodeIdentitySystem(cowork()).system.map((b) => b.text))
      .toEqual(["<application_details>Be terse.</application_details>"]);
  });

  it("drops the Claude Code identity line from a string system prompt", () => {
    const b = cowork(); b.system = "You are Claude Code, Anthropic's official CLI for Claude.\nBe terse.";
    expect(dropClaudeCodeIdentitySystem(b).system).toBe("Be terse.");
  });

  it("removes system when only identity text was present", () => {
    const b = cowork(); b.system = b.system.slice(0, 2);
    expect(dropClaudeCodeIdentitySystem(b).system).toBeUndefined();
  });

  it("leaves bodies without identity text unchanged", () => {
    const b = { model: "m", messages: [], system: [{ type: "text", text: "Be terse." }] };
    expect(dropClaudeCodeIdentitySystem(b).system).toEqual([{ type: "text", text: "Be terse." }]);
    expect(dropClaudeCodeIdentitySystem({ model: "m", messages: [] }).system).toBeUndefined();
  });
});
