import { afterEach, describe, expect, it, vi } from "vitest";
import { compressWithHeadroom } from "../../open-sse/rtk/headroom.js";

const options = {
  enabled: true, url: "http://headroom:8787", model: "claude-sonnet-4-5", format: "claude",
};
afterEach(() => vi.unstubAllGlobals());

function makeBody() {
  return {
    model: options.model, stream: true, max_tokens: 2048,
    system: [{ type: "text", text: "long system instructions", cache_control: { type: "ephemeral" } }],
    tools: [{ name: "read_pdf", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: [
        { type: "text", text: "long question about the attached document" },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQK" }, title: "report.pdf", citations: { enabled: true }, cache_control: { type: "ephemeral" } },
        { type: "document", source: { type: "url", url: "https://example.com/report.pdf" } },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
      ] },
      { role: "assistant", content: [
        { type: "thinking", thinking: "private reasoning", signature: "signed-thinking" },
        { type: "redacted_thinking", data: "opaque-signature" },
        { type: "tool_use", id: "toolu_pdf", name: "read_pdf", input: { path: "report.pdf" } },
      ] },
      { role: "user", content: [{
        type: "tool_result", tool_use_id: "toolu_pdf", is_error: false,
        content: [
          { type: "text", text: "long extracted PDF tool output", cache_control: { type: "ephemeral" } },
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQK" } },
          { type: "image", source: { type: "url", url: "https://example.com/page.png" } },
        ],
      }] },
      { role: "assistant", content: [{ type: "text", text: "long answer", citations: [{ type: "page_location", document_index: 0, start_page_number: 1, end_page_number: 2 }] }] },
    ],
  };
}

function mockProxy(map = (messages) => messages) {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => Response.json({
    messages: map(JSON.parse(init.body).messages), tokens_before: 100, tokens_after: 40, tokens_saved: 60,
  })));
}

describe("Claude Headroom document preservation (#4670)", () => {
  it("keeps the entire native request intact when compression makes no changes", async () => {
    const body = makeBody();
    const original = structuredClone(body);
    mockProxy();
    expect(await compressWithHeadroom(body, options)).not.toBeNull();
    expect(body).toEqual(original);
  });

  it("compresses text without changing PDF sources, tool IDs, signatures or metadata", async () => {
    const body = makeBody();
    const expected = structuredClone(body);
    const diagnostics = {};
    mockProxy((messages) => messages.map((message) => ({ ...message, content: message.content ? "short" : "" })));
    expect(await compressWithHeadroom(body, { ...options, compressUserMessages: true, diagnostics })).not.toBeNull();
    expected.system[0].text = "short";
    expected.messages[0].content[0].text = "short";
    expected.messages[2].content[0].content[0].text = "short";
    expected.messages[3].content[0].text = "short";
    expect(body).toEqual(expected);
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.config).toEqual({ compress_user_messages: true });
    expect(JSON.stringify(payload)).not.toContain("JVBERi0xLjQK");
    expect(JSON.stringify(payload)).not.toContain("private reasoning");
    expect(payload.messages).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "toolu_pdf", content: "long extracted PDF tool output" }));
    expect(diagnostics.after.bodyBytes).toBeLessThan(diagnostics.before.bodyBytes);
  });

  it("preserves string system, user and tool-result content shapes", async () => {
    const body = { system: "long instructions", messages: [
      { role: "user", content: "long question" },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "long output" }] },
    ] };
    const expected = structuredClone(body);
    mockProxy((messages) => messages.map((message) => ({ ...message, content: message.content ? [{ type: "text", text: "short" }] : "" })));
    expect(await compressWithHeadroom(body, options)).not.toBeNull();
    expected.system = "short";
    expected.messages[0].content = "short";
    expected.messages[2].content[0].content = "short";
    expect(body).toEqual(expected);
  });

  it.each([
    ["missing message", (messages) => messages.slice(1)],
    ["wrong role", (messages) => messages.map((message, i) => i === 1 ? { ...message, role: "assistant" } : message)],
    ["wrong tool ID", (messages) => messages.map((message) => message.role === "tool" ? { ...message, tool_call_id: "wrong" } : message)],
    ["missing text", (messages) => messages.map((message, i) => i === messages.length - 1 ? { ...message, content: null } : { ...message, content: "short" })],
  ])("fails open atomically for %s", async (_name, map) => {
    const body = makeBody();
    const original = structuredClone(body);
    const diagnostics = {};
    mockProxy(map);
    expect(await compressWithHeadroom(body, { ...options, diagnostics })).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toMatch(/Claude/);
  });

  it("keeps documents intact if the proxy fails", async () => {
    const body = makeBody();
    const original = structuredClone(body);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")));
    expect(await compressWithHeadroom(body, options)).toBeNull();
    expect(body).toEqual(original);
  });

  it("skips a document-only request without sending binary data to the proxy", async () => {
    const body = { messages: [{ role: "user", content: [makeBody().messages[0].content[1]] }] };
    const original = structuredClone(body);
    mockProxy();
    expect(await compressWithHeadroom(body, options)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(body).toEqual(original);
  });
});
