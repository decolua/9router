import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { stripUnsupportedAssistantPrefill } from "../../open-sse/utils/requestNormalization.js";

describe("assistant prefill normalization", () => {
  it("strips trailing Claude assistant prefill for OpenAI-compatible providers", () => {
    const log = { debug: vi.fn() };
    const body = {
      model: "claude-fable-5",
      messages: [
        { role: "user", content: "hai" },
        { role: "assistant", content: "Hi" },
      ],
    };

    const normalized = stripUnsupportedAssistantPrefill({
      provider: "openai-compatible-chat-test",
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI,
      body,
      clientTool: "claude",
      log,
    });

    expect(normalized.messages).toEqual([{ role: "user", content: "hai" }]);
    expect(log.debug).toHaveBeenCalledWith(
      "NORMALIZE",
      "stripped trailing Claude assistant prefill for OpenAI-compatible provider"
    );
  });

  it("keeps assistant tool calls", () => {
    const body = {
      messages: [
        { role: "user", content: "run tool" },
        { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "x", arguments: "{}" } }] },
      ],
    };

    const normalized = stripUnsupportedAssistantPrefill({
      provider: "openai-compatible-chat-test",
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI,
      body,
      clientTool: "claude",
    });

    expect(normalized).toBe(body);
  });

  it("does not alter non-compatible providers", () => {
    const body = {
      messages: [
        { role: "user", content: "hai" },
        { role: "assistant", content: "Hi" },
      ],
    };

    const normalized = stripUnsupportedAssistantPrefill({
      provider: "openai",
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI,
      body,
      clientTool: "claude",
    });

    expect(normalized).toBe(body);
  });
});
