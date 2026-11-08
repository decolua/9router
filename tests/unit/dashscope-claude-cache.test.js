import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const marker = { type: "ephemeral" };
const convert = (body, provider) => translateRequest(
  FORMATS.CLAUDE, FORMATS.OPENAI, "qwen3-coder-plus", body, false, null, provider,
);

describe("Claude cache markers for DashScope (#2069)", () => {
  it.each(["alicode", "alicode-intl", "alims-intl", "alitp-intl"])(
    "preserves explicit system and user text cache boundaries for %s", (provider) => {
      const body = {
        system: [{ type: "text", text: "x-anthropic-billing-header: transient\nStable instructions", cache_control: marker }],
        messages: [{ role: "user", content: [{ type: "text", text: "Stable question", cache_control: marker }] }],
        max_tokens: 1024,
      };
      const original = structuredClone(body);
      const result = convert(body, provider);
      expect(result.messages).toEqual([
        { role: "system", content: [{ type: "text", text: "Stable instructions", cache_control: marker }] },
        { role: "user", content: [{ type: "text", text: "Stable question", cache_control: marker }] },
      ]);
      expect(body).toEqual(original);
    }
  );

  it("retains marked text next to assistant tool calls", () => {
    const result = convert({ messages: [
      { role: "assistant", content: [
        { type: "text", text: "Calling tool", cache_control: marker },
        { type: "tool_use", id: "c1", name: "read", input: {} },
      ] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "done" }] },
    ] }, "alicode");
    expect(result.messages[0].content).toEqual([{ type: "text", text: "Calling tool", cache_control: marker }]);
    expect(result.messages[0].tool_calls[0].id).toBe("c1");
    expect(result.messages[1]).toEqual({ role: "tool", tool_call_id: "c1", content: "done" });
  });

  it("keeps legacy flattened content and omits markers for other providers", () => {
    const result = convert({
      system: [{ type: "text", text: "one" }, { type: "text", text: "two", cache_control: marker }],
      messages: [{ role: "user", content: [{ type: "text", text: "hi", cache_control: marker }] }],
    }, "groq");
    expect(result.messages).toEqual([
      { role: "system", content: "one\ntwo" }, { role: "user", content: "hi" },
    ]);
  });

  it("does not add cache markers or alter unmarked single-text messages", () => {
    expect(convert({ system: "instructions", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }, "alicode").messages)
      .toEqual([{ role: "system", content: "instructions" }, { role: "user", content: "hi" }]);
  });

  it("retains distinct system block boundaries around a marker", () => {
    expect(convert({ system: [
      { type: "text", text: "prefix" }, { type: "text", text: "cached", cache_control: marker },
      { type: "text", text: "uncached tail" },
    ], messages: [{ role: "user", content: "hi" }] }, "alicode").messages[0].content).toEqual([
      { type: "text", text: "prefix" }, { type: "text", text: "cached", cache_control: marker },
      { type: "text", text: "uncached tail" },
    ]);
  });

  it("retains a cache boundary when its billing-only block is removed", () => {
    expect(convert({ system: [
      { type: "text", text: "Stable prefix" },
      { type: "text", text: "x-anthropic-billing-header: transient", cache_control: marker },
      { type: "text", text: "Uncached tail" },
    ], messages: [{ role: "user", content: "hi" }] }, "alicode").messages[0].content).toEqual([
      { type: "text", text: "Stable prefix", cache_control: marker },
      { type: "text", text: "Uncached tail" },
    ]);
  });
});
