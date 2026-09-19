// F17 / T1.2 M9 — the claude→openai pivot silently discarded block semantics:
// tool_result.is_error vanished (model can't tell failure from success),
// image-only tool_result fell into JSON.stringify(block.content) leaking raw
// base64 as prompt text, and document/thinking/redacted_thinking/server_tool_use/
// web_search_tool_result disappeared with no signal.
// Conservative fix scope: structural loss of the bridge is known; we make the
// failure channel + images visible and make every dropped type LOUD (one warn).
import { describe, it, expect, afterEach, vi } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const T = (body) =>
  translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", body, true, null, null);

const toolResultPair = (resultBlock) => ({
  messages: [
    { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "f", input: {} }] },
    { role: "user", content: [resultBlock] },
  ],
});

describe("claude→openai tool_result lossless (M9)", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("is_error=true is propagated as an explicit [tool_error] marker on the tool message", () => {
    const out = T(toolResultPair(
      { type: "tool_result", tool_use_id: "call_1", is_error: true, content: "boom" },
    ));
    const tool = out.messages.find((m) => m.role === "tool");
    expect(tool, "tool message missing").toBeTruthy();
    expect(tool.tool_call_id, "tool id pairing must not break").toBe("call_1");
    expect(tool.content).toContain("[tool_error]");
    expect(tool.content).toContain("boom");
  });

  it("successful tool_result carries no marker", () => {
    const out = T(toolResultPair(
      { type: "tool_result", tool_use_id: "call_1", content: "fine" },
    ));
    const tool = out.messages.find((m) => m.role === "tool");
    expect(tool.content).toBe("fine");
  });

  it("the marker survives the round-trip back to Claude with the tool ids", () => {
    const body = toolResultPair(
      { type: "tool_result", tool_use_id: "call_1", is_error: true, content: "boom" },
    );
    const openaiOut = T(body);
    const back = translateRequest(
      FORMATS.OPENAI, FORMATS.CLAUDE, "m",
      { messages: openaiOut.messages }, true, { apiKey: "sk-x" }, "claude",
    );
    const json = JSON.stringify(back);
    expect(json).toContain("[tool_error]");
    expect(json).toContain("call_1");
  });

  it("image-only tool_result becomes an image_url data-URI part, not JSON-stringified base64", () => {
    const out = T(toolResultPair({
      type: "tool_result", tool_use_id: "call_1", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "ZZZ" } },
      ],
    }));
    const tool = out.messages.find((m) => m.role === "tool");
    expect(Array.isArray(tool.content), "content must be parts, not a JSON string").toBe(true);
    const img = tool.content.find((p) => p.type === "image_url");
    expect(img?.image_url?.url).toBe("data:image/png;base64,ZZZ");
  });

  it("text+image tool_result keeps both as parts (image no longer silently dropped)", () => {
    const out = T(toolResultPair({
      type: "tool_result", tool_use_id: "call_1", content: [
        { type: "text", text: "see below" },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QQQ" } },
      ],
    }));
    const tool = out.messages.find((m) => m.role === "tool");
    expect(Array.isArray(tool.content)).toBe(true);
    expect(tool.content.some((p) => p.type === "text" && p.text.includes("see below"))).toBe(true);
    const img = tool.content.find((p) => p.type === "image_url");
    expect(img?.image_url?.url).toBe("data:image/jpeg;base64,QQQ");
  });

  it("dropped block types trigger exactly one console.warn naming every lost type (no throw)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = T({
      messages: [
        { role: "assistant", content: [
          { type: "thinking", thinking: "s", signature: "sig" },
          { type: "redacted_thinking", data: "d" },
          { type: "server_tool_use", id: "st1", name: "web", input: {} },
          { type: "web_search_tool_result", tool_use_id: "st1", content: [] },
          { type: "text", text: "answer" },
        ] },
        { role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: "PDF" } },
          { type: "text", text: "hi" },
        ] },
      ],
    });
    // Request still succeeds — the warn is loud, never a throw.
    expect(out.messages.length).toBeGreaterThan(0);
    const warns = spy.mock.calls.map((c) => c.join(" ")).filter((s) => s.includes("block types"));
    expect(warns.length, "exactly one aggregated warn per request").toBe(1);
    for (const t of ["thinking", "redacted_thinking", "server_tool_use", "web_search_tool_result", "document"]) {
      expect(warns[0]).toContain(t);
    }
  });

  it("request with no lossy types warns nothing", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    T({ messages: [{ role: "user", content: [{ type: "text", text: "plain" }] }] });
    const warns = spy.mock.calls.map((c) => c.join(" ")).filter((s) => s.includes("block types"));
    expect(warns.length).toBe(0);
  });
});
