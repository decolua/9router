import { describe, it, expect } from "vitest";
import { pruneContext, formatPruneLog } from "../../open-sse/rtk/contextPruning.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function makeMessages(n, bytesEach = 2000) {
  const out = [{ role: "user", content: "initial task: " + "a".repeat(bytesEach) }];
  for (let i = 0; i < n; i++) {
    out.push({ role: "assistant", content: "reply " + i + " " + "b".repeat(bytesEach) });
    out.push({ role: "user", content: "follow-up " + i + " " + "c".repeat(bytesEach) });
  }
  return out;
}

describe("pruneContext", () => {
  it("returns null when disabled", () => {
    expect(pruneContext({ messages: makeMessages(20) }, false, FORMATS.OPENAI)).toBeNull();
  });

  it("returns null when conversation is short", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    expect(pruneContext(body, true, FORMATS.OPENAI)).toBeNull();
  });

  it("prunes middle when above threshold", () => {
    const body = { messages: makeMessages(20, 1000) };
    const before = body.messages.length;
    const stats = pruneContext(body, true, FORMATS.OPENAI, { keepLast: 6, minBytes: 5000 });
    expect(stats).not.toBeNull();
    expect(stats.prunedMessages).toBeGreaterThan(0);
    expect(body.messages.length).toBeLessThan(before);
    // First user message and trailing window survive
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toMatch(/^initial task/);
    // A pruning marker is inserted
    const hasMarker = body.messages.some((m) =>
      typeof m.content === "string" && m.content.startsWith("[context-pruned:")
    );
    expect(hasMarker).toBe(true);
  });

  it("preserves last K turns exactly", () => {
    const body = { messages: makeMessages(20, 1000) };
    const tail = body.messages.slice(-6).map((m) => m.content);
    pruneContext(body, true, FORMATS.OPENAI, { keepLast: 6, minBytes: 5000 });
    const newTail = body.messages.slice(-6).map((m) => m.content);
    expect(newTail).toEqual(tail);
  });

  it("emits Claude-shaped marker for Claude format", () => {
    const body = {
      messages: makeMessages(20, 1000).map((m) => ({
        role: m.role,
        content: [{ type: "text", text: m.content }],
      })),
    };
    pruneContext(body, true, FORMATS.CLAUDE, { keepLast: 6, minBytes: 5000 });
    const marker = body.messages.find((m) =>
      Array.isArray(m.content) && m.content[0]?.text?.startsWith("[context-pruned:")
    );
    expect(marker).toBeTruthy();
  });

  it("never prunes when nothing meaningful to drop", () => {
    const body = { messages: makeMessages(3, 500) };
    expect(pruneContext(body, true, FORMATS.OPENAI, { keepLast: 8, minBytes: 5000 })).toBeNull();
  });

  it("respects unpaired tool_use boundary", () => {
    // Build a conversation where the prune window edge would otherwise split tool_use/tool_result
    const body = {
      messages: [
        { role: "user", content: "task " + "a".repeat(3000) },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
        ...makeMessages(15, 1500),
      ],
    };
    const stats = pruneContext(body, true, FORMATS.CLAUDE, { keepLast: 6, minBytes: 5000 });
    // Should still produce a valid pruning (the boundary code expands outward if needed)
    if (stats) {
      // No assistant tool_use should be immediately followed by a pruning marker
      for (let i = 0; i < body.messages.length - 1; i++) {
        const cur = body.messages[i];
        const next = body.messages[i + 1];
        if (cur.role === "assistant" && Array.isArray(cur.content) && cur.content.some((b) => b.type === "tool_use")) {
          const nextText = Array.isArray(next.content) ? next.content[0]?.text : next.content;
          expect(nextText?.startsWith?.("[context-pruned:") || false).toBe(false);
        }
      }
    }
  });

  it("formatPruneLog returns null for empty stats", () => {
    expect(formatPruneLog(null)).toBeNull();
    expect(formatPruneLog({ prunedMessages: 0 })).toBeNull();
  });

  it("formatPruneLog produces a readable line", () => {
    const line = formatPruneLog({ prunedMessages: 5, prunedBytes: 10000, keptMessages: 8, totalBytesBefore: 20000 });
    expect(line).toContain("[PRUNE]");
    expect(line).toContain("elided 5 msgs");
  });
});
