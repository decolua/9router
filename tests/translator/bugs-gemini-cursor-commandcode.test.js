// OpenAI → Gemini / Cursor / CommandCode request translation.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const O2G = (body) => translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "m", body, true, null, "gemini");
const O2C = (body) => translateRequest(FORMATS.OPENAI, FORMATS.CURSOR, "m", body, true, null, "cursor");
const O2CC = (body) => translateRequest(FORMATS.OPENAI, FORMATS.COMMANDCODE, "m", body, true, null, "commandcode");

describe("OpenAI → Gemini", () => {
  // openai-to-gemini.js:92-96 — each system message overwrites systemInstruction → only last kept
  // KNOWN BUG
  it.fails("multiple system messages are all kept", () => {
    const out = O2G({
      messages: [
        { role: "system", content: "RULE_ONE" },
        { role: "system", content: "RULE_TWO" },
        { role: "user", content: "hi" },
      ],
    });
    expect(JSON.stringify(out.systemInstruction), "earlier system lost").toContain("RULE_ONE");
  });
});

describe("OpenAI → Cursor", () => {
  // openai-to-cursor.js:12-24 — image content fully dropped (text only)
  // KNOWN BUG
  it.fails("image content is preserved", () => {
    const out = O2C({
      messages: [{ role: "user", content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ] }],
    });
    expect(JSON.stringify(out), "image dropped").toContain("AAAA");
  });

  // openai-to-cursor.js:179 — max_tokens hardcoded to 32000
  // KNOWN BUG
  it.fails("respects client max_tokens", () => {
    const out = O2C({ max_tokens: 200, messages: [{ role: "user", content: "hi" }] });
    expect(out.max_tokens).toBe(200);
  });
});

describe("OpenAI → CommandCode", () => {
  // openai-to-commandcode.js:53-57 — safeParseJson returns {} on bad JSON (args silently lost)
  // KNOWN BUG
  it.fails("malformed tool arguments are not silently emptied", () => {
    const out = O2CC({
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "", tool_calls: [
          { id: "c1", type: "function", function: { name: "f", arguments: "{bad" } },
        ] },
        { role: "tool", tool_call_id: "c1", content: "r" },
      ],
    });
    const asst = out.params.messages.find((m) => m.role === "assistant");
    const call = asst.content.find((b) => b.type === "tool-call");
    expect(Object.keys(call.input).length, "arguments silently dropped to {}").toBeGreaterThan(0);
  });

  // FIXED: data-URI images are forwarded as Anthropic-style base64 blocks.
  it("preserves inline image content as a base64 image block", () => {
    const out = O2CC({
      messages: [{ role: "user", content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
      ] }],
    });
    const blocks = out.params.messages[0].content;
    expect(blocks).toContainEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "BBBB" },
    });
    expect(JSON.stringify(out), "image not omitted").not.toContain("[image omitted]");
  });

  // FIXED: AI SDK-style `{type:"image", image:"data:..."}` parts are preserved
  // (issue #1330 shape), not just `{type:"image_url"}`.
  it("preserves AI SDK-style image parts", () => {
    const out = O2CC({
      messages: [{ role: "user", content: [
        { type: "image", image: "data:image/jpeg;base64,CCCC" },
      ] }],
    });
    expect(out.params.messages[0].content).toContainEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "CCCC" },
    });
  });

  // FIXED: remote http(s) image URLs are forwarded as URL image blocks.
  it("preserves remote image URLs", () => {
    const out = O2CC({
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: "https://example.com/a.png" } },
      ] }],
    });
    expect(out.params.messages[0].content).toContainEqual({
      type: "image",
      source: { type: "url", url: "https://example.com/a.png" },
    });
  });

  // Unfetchable/opaque image URLs still degrade to a placeholder rather than
  // producing an invalid block.
  it("falls back to a placeholder for non-fetchable image URLs", () => {
    const out = O2CC({
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: "ftp://example.com/a.png" } },
      ] }],
    });
    expect(out.params.messages[0].content).toContainEqual({ type: "text", text: "[image omitted]" });
  });
});
