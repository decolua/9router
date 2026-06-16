// OpenAI → Kiro (AWS CodeWhisperer) request translation.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const O2K = (body) => translateRequest(FORMATS.OPENAI, FORMATS.KIRO, "m", body, true, null, "kiro");

describe("OpenAI → Kiro", () => {
  // openai-to-kiro.js — safeJSONParse guards bad tool-call JSON (fixed in PR #1582)
  it("malformed tool arguments do not throw the whole request", () => {
    expect(() =>
      O2K({
        messages: [
          { role: "user", content: "go" },
          { role: "assistant", content: "", tool_calls: [
            { id: "c1", type: "function", function: { name: "f", arguments: "{not json" } },
          ] },
          { role: "tool", tool_call_id: "c1", content: "r" },
        ],
      })
    ).not.toThrow();
  });

  // openai-to-kiro.js:309 — maxTokens hardcoded to 32000, ignores body.max_tokens
  // KNOWN BUG
  it.fails("respects client max_tokens", () => {
    const out = O2K({ max_tokens: 100, messages: [{ role: "user", content: "hi" }] });
    expect(out.inferenceConfig?.maxTokens, "client max_tokens ignored").toBe(100);
  });

  // openai-to-kiro.js:132-134 — remote http image becomes "[Image: url]" text (lost)
  // KNOWN BUG
  it.fails("remote image url is preserved as an image, not text", () => {
    const out = O2K({
      messages: [{ role: "user", content: [
        { type: "text", text: "see" },
        { type: "image_url", image_url: { url: "https://x.com/p.png" } },
      ] }],
    });
    const content = out.conversationState?.currentMessage?.userInputMessage?.content || "";
    expect(content, "remote image flattened to text").not.toContain("[Image:");
  });
});
