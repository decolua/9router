// Regression: Antigravity (Gemini-family) tool translation.
//
//  1. Parallel id-less functionCalls collapsed onto one OpenAI tool_call_id
//     (`call_Foo` twice), so the matching functionResponses could not tell them
//     apart. Ids are now name+occurrence deterministic.
//  2. A content turn that carried functionResponses together with co-located
//     text/tool-calls emitted the assistant message AFTER the role:tool results,
//     inverting the required OpenAI ordering (assistant.tool_calls before the
//     tool replies).
import { describe, expect, it } from "vitest";
import { antigravityToOpenAIRequest } from "../../open-sse/translator/request/antigravity-to-openai.js";

const body = (contents) => ({ contents });

describe("Antigravity tool translation", () => {
  it("gives parallel id-less calls to the same tool distinct ids", () => {
    const out = antigravityToOpenAIRequest(
      "gemini-3-pro",
      body([
        { role: "model", parts: [{ functionCall: { name: "Read", args: { p: 1 } } }, { functionCall: { name: "Read", args: { p: 2 } } }] },
      ]),
      true
    );
    const calls = out.messages.flatMap((m) => m.tool_calls || []);
    expect(calls).toHaveLength(2);
    const ids = calls.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("emits the assistant tool_calls message BEFORE the tool results", () => {
    const out = antigravityToOpenAIRequest(
      "gemini-3-pro",
      body([
        { role: "user", parts: [{ text: "here is output, now continue" }, { functionResponse: { name: "Read", response: { result: "ok" } } }] },
      ]),
      true
    );
    const roles = out.messages.map((m) => m.role);
    const assistantIdx = roles.indexOf("assistant");
    const toolIdx = roles.indexOf("tool");
    // If both exist, the assistant must not come after the tool reply.
    if (assistantIdx !== -1 && toolIdx !== -1) {
      expect(assistantIdx).toBeLessThan(toolIdx);
    }
    // The tool result must always be present.
    expect(toolIdx).toBeGreaterThanOrEqual(0);
  });
});
