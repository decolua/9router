import { describe, it, expect } from "vitest";
import { dedupePrompt, formatDedupLog } from "../../open-sse/rtk/promptDedup.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const LARGE = "x".repeat(600);
const LARGE_2 = "y".repeat(800);
const SMALL = "below threshold";

describe("dedupePrompt", () => {
  it("returns null when disabled", () => {
    const body = { messages: [{ role: "user", content: LARGE }, { role: "user", content: LARGE }] };
    expect(dedupePrompt(body, false, FORMATS.OPENAI)).toBeNull();
  });

  it("returns null when no duplicates", () => {
    const body = { messages: [{ role: "user", content: LARGE }, { role: "user", content: LARGE_2 }] };
    expect(dedupePrompt(body, true, FORMATS.OPENAI)).toBeNull();
  });

  it("collapses string-content duplicates and reports stats", () => {
    const body = {
      messages: [
        { role: "user", content: LARGE },
        { role: "assistant", content: "ok" },
        { role: "user", content: LARGE },
      ],
    };
    const stats = dedupePrompt(body, true, FORMATS.OPENAI);
    expect(stats).not.toBeNull();
    expect(stats.dupBlocks).toBe(1);
    expect(body.messages[2].content.startsWith("[dup-ref:")).toBe(true);
    expect(body.messages[0].content).toBe(LARGE); // first kept intact
    expect(stats.bytesBefore - stats.bytesAfter).toBeGreaterThan(500);
  });

  it("collapses Claude array text blocks", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: LARGE }] },
        { role: "assistant", content: [{ type: "text", text: "ack" }] },
        { role: "user", content: [{ type: "text", text: LARGE }] },
      ],
    };
    const stats = dedupePrompt(body, true, FORMATS.CLAUDE);
    expect(stats?.dupBlocks).toBe(1);
    expect(body.messages[2].content[0].text.startsWith("[dup-ref:")).toBe(true);
  });

  it("skips tool_result blocks (RTK territory)", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "tool_result", content: LARGE }] },
        { role: "user", content: [{ type: "tool_result", content: LARGE }] },
      ],
    };
    expect(dedupePrompt(body, true, FORMATS.CLAUDE)).toBeNull();
  });

  it("skips cache_control-marked blocks (prefix cache territory)", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: LARGE, cache_control: { type: "ephemeral" } }] },
        { role: "user", content: [{ type: "text", text: LARGE }] },
      ],
    };
    // First occurrence is cache_controlled and skipped → second is the only one seen → no dup
    expect(dedupePrompt(body, true, FORMATS.CLAUDE)).toBeNull();
  });

  it("skips small blocks below MIN_DEDUP_SIZE", () => {
    const body = {
      messages: [{ role: "user", content: SMALL }, { role: "user", content: SMALL }],
    };
    expect(dedupePrompt(body, true, FORMATS.OPENAI)).toBeNull();
  });

  it("handles Claude body.system array", () => {
    const body = {
      system: [{ type: "text", text: LARGE }, { type: "text", text: LARGE }],
      messages: [{ role: "user", content: "hi" }],
    };
    const stats = dedupePrompt(body, true, FORMATS.CLAUDE);
    expect(stats?.dupBlocks).toBe(1);
    expect(body.system[1].text.startsWith("[dup-ref:")).toBe(true);
  });

  it("formatDedupLog returns null for empty stats", () => {
    expect(formatDedupLog(null)).toBeNull();
    expect(formatDedupLog({ dupBlocks: 0 })).toBeNull();
  });

  it("formatDedupLog produces a readable line", () => {
    const line = formatDedupLog({ dupBlocks: 2, bytesBefore: 2000, bytesAfter: 100 });
    expect(line).toContain("[DEDUP]");
    expect(line).toContain("collapsed 2");
  });

  it("collapses duplicate text in Gemini contents.parts", () => {
    const body = {
      contents: [
        { role: "user", parts: [{ text: LARGE }] },
        { role: "model", parts: [{ text: "ack" }] },
        { role: "user", parts: [{ text: LARGE }] },
      ],
    };
    const stats = dedupePrompt(body, true, FORMATS.GEMINI);
    expect(stats?.dupBlocks).toBe(1);
    expect(body.contents[2].parts[0].text.startsWith("[dup-ref:")).toBe(true);
  });

  it("collapses duplicate text in Antigravity request.contents", () => {
    const body = {
      userAgent: "antigravity",
      request: {
        contents: [
          { role: "user", parts: [{ text: LARGE }] },
          { role: "user", parts: [{ text: LARGE }] },
        ],
      },
    };
    const stats = dedupePrompt(body, true, FORMATS.ANTIGRAVITY);
    expect(stats?.dupBlocks).toBe(1);
    expect(body.request.contents[1].parts[0].text.startsWith("[dup-ref:")).toBe(true);
  });
});
