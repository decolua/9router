import { describe, it, expect } from "vitest";
import { translateRequest } from "open-sse/translator/index.js";
import { AntigravityExecutor } from "open-sse/executors/antigravity.js";

describe("Prompt normalization test", () => {
  it("translates Claude Code prompt to Antigravity envelope", () => {
    const dummyBody = {
      model: "claude-opus-5-5",
      system: "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.\n\nIMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.",
      messages: [
        { role: "user", content: "Hello" }
      ]
    };

    const translated = translateRequest("claude", "antigravity", "gemini-3.8-flash-tiered", dummyBody);
    const executor = new AntigravityExecutor();
    const envelope = executor.transformRequest("gemini-3.8-flash-tiered", translated, true, { projectId: "test-proj" });

    const text = envelope.request.systemInstruction.parts.map(p => p.text).join("\n");
    expect(text).not.toContain("Claude Code");
    expect(text).not.toContain("Dual-use security tools");
    expect(text).toContain("authorized security testing");
  });
});
