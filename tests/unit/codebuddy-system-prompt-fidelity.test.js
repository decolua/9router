// Regression: CodeBuddy (CN + INTL) system-prompt sanitisation must key on the
// agent-identity STRING, never on prompt LENGTH.
//
// The gateway rejects agent-identity system prompts (11128), but an earlier
// implementation also replaced ANY system prompt longer than 2000 chars. Claude
// Code's real system prompt is several KB and does NOT necessarily begin with an
// agent-identity marker, so a length rule silently discarded the agent's
// instructions while letting the request "succeed" — the worst kind of
// corruption. Only identity-matching prompts may be neutered.
import { describe, expect, it } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const NEUTRAL = "You are a helpful AI assistant that helps with software engineering tasks.";
const executors = [
  ["codebuddy-cn", new CodeBuddyExecutor()],
  ["codebuddy-intl", new CodeBuddyIntlExecutor()],
];

const run = (exec, system) =>
  exec.transformRequest("glm-5.3", { messages: [{ role: "system", content: system }, { role: "user", content: "hi" }] }, false, {});

describe.each(executors)("%s system-prompt sanitisation", (_name, exec) => {
  it("preserves a long (>2000 char) legitimate system prompt verbatim", () => {
    const long = "You are a precise coding assistant. ".repeat(120); // > 3000 chars
    expect(long.length).toBeGreaterThan(2000);
    const out = run(exec, long);
    const sys = out.messages.find((m) => m.role === "system");
    expect(sys.content).toBe(long);
    expect(sys.content).not.toBe(NEUTRAL);
  });

  it("replaces an agent-identity system prompt with the neutral one", () => {
    const out = run(exec, "You are Claude Code, Anthropic's official CLI for Claude.");
    const sys = out.messages.find((m) => m.role === "system");
    expect(sys.content).toBe(NEUTRAL);
  });

  it("replaces agent-identity even when embedded in a long prompt", () => {
    const embedded = "Some preamble. ".repeat(200) + "You are Claude Code, Anthropic's official CLI for Claude.";
    const out = run(exec, embedded);
    const sys = out.messages.find((m) => m.role === "system");
    expect(sys.content).toBe(NEUTRAL);
  });

  it("preserves a typed-block system prompt's shape when it is legitimate", () => {
    const out = exec.transformRequest(
      "glm-5.3",
      { messages: [{ role: "system", content: [{ type: "text", text: "Be concise." }] }, { role: "user", content: "hi" }] },
      false,
      {}
    );
    const sys = out.messages.find((m) => m.role === "system");
    expect(Array.isArray(sys.content)).toBe(true);
    expect(sys.content[0].text).toBe("Be concise.");
  });
});
