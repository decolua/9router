// #2069 — cache_control markers stripped for alicode/alicode-intl (DashScope) providers.
// DashScope supports explicit cache_control: { type: "ephemeral" } in content blocks,
// but the default filterToOpenAIFormat strips them. preserveCacheControl quirk opts-in.
import { describe, it, expect } from "vitest";
import { filterToOpenAIFormat } from "../../open-sse/translator/formats/openai.js";

const msgWithCache = [
  {
    role: "user",
    content: [
      { type: "text", text: "large context", cache_control: { type: "ephemeral" } },
    ],
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "reply", cache_control: { type: "ephemeral" } },
    ],
  },
];

describe("filterToOpenAIFormat cache_control handling (#2069)", () => {
  it("strips cache_control by default (all standard OpenAI providers)", () => {
    const body = { messages: JSON.parse(JSON.stringify(msgWithCache)) };
    filterToOpenAIFormat(body);
    for (const msg of body.messages) {
      for (const block of msg.content) {
        expect(block.cache_control).toBeUndefined();
      }
    }
  });

  it("preserves cache_control when preserveCacheControl option is true (alicode/DashScope)", () => {
    const body = { messages: JSON.parse(JSON.stringify(msgWithCache)) };
    filterToOpenAIFormat(body, { preserveCacheControl: true });
    for (const msg of body.messages) {
      for (const block of msg.content) {
        expect(block.cache_control).toEqual({ type: "ephemeral" });
      }
    }
  });

  it("always strips signature regardless of preserveCacheControl", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hi", signature: "sig123", cache_control: { type: "ephemeral" } },
          ],
        },
      ],
    };
    filterToOpenAIFormat(body, { preserveCacheControl: true });
    expect(body.messages[0].content[0].signature).toBeUndefined();
    expect(body.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("does not add cache_control when block had none (preserveCacheControl: true)", () => {
    const body = {
      messages: [{ role: "user", content: [{ type: "text", text: "no cache" }] }],
    };
    filterToOpenAIFormat(body, { preserveCacheControl: true });
    expect(body.messages[0].content[0].cache_control).toBeUndefined();
  });
});
