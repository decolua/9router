import { describe, it, expect } from "vitest";
import { resolveConversationItems } from "../../open-sse/rtk/bodyShapes.js";
import { pruneContext } from "../../open-sse/rtk/contextPruning.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("resolveConversationItems", () => {
  it("resolves messages, input, contents, antigravity, and commandcode shapes", () => {
    expect(resolveConversationItems({ messages: [{ role: "user", content: "a" }] })).toHaveLength(1);
    expect(resolveConversationItems({ input: [{ role: "user", content: "a" }] })).toHaveLength(1);
    expect(resolveConversationItems({ contents: [{ role: "user", parts: [{ text: "a" }] }] })).toHaveLength(1);
    expect(resolveConversationItems({
      userAgent: "antigravity",
      request: { contents: [{ role: "user", parts: [{ text: "a" }] }] },
    })).toHaveLength(1);
    expect(resolveConversationItems({ params: { messages: [{ role: "user", content: "a" }] } })).toHaveLength(1);
    expect(resolveConversationItems({})).toBeNull();
  });
});

describe("pruneContext antigravity", () => {
  function makeGeminiMessages(n, bytesEach = 2000) {
    const out = [{ role: "user", parts: [{ text: "initial " + "a".repeat(bytesEach) }] }];
    for (let i = 0; i < n; i++) {
      out.push({ role: "model", parts: [{ text: "reply " + i }] });
      out.push({ role: "user", parts: [{ text: "follow " + i + " " + "b".repeat(bytesEach) }] });
    }
    return out;
  }

  it("prunes antigravity request.contents when above threshold", () => {
    const body = {
      userAgent: "antigravity",
      request: { contents: makeGeminiMessages(20, 1000) },
    };
    const before = body.request.contents.length;
    const stats = pruneContext(body, true, FORMATS.ANTIGRAVITY, { keepLast: 6, minBytes: 5000 });
    expect(stats).not.toBeNull();
    expect(body.request.contents.length).toBeLessThan(before);
  });
});
