/**
 * Kimchi executor: strip reasoning_content echoed by clients.
 *
 * Background: when 9Router streams a thinking model (deepseek-r1,
 * minimax-m3) to a client, the response carries `reasoning_content`.
 * Most OpenAI-compatible SDKs echo the whole history on the next turn,
 * so Kimchi's upstream counts the scratch block as input tokens.
 * Multi-turn conversations balloon to 100k+ input tokens and the model
 * starts returning empty content.
 *
 * `stripReasoningContent` is intentionally conservative: it only strips
 * `reasoning_content` that is clearly a real thinking block. The 1-char
 * placeholder that `injectReasoningContent` (in `DefaultExecutor`) may
 * insert for upstream validation is preserved — stripping it would
 * re-trigger upstream complaints about missing reasoning on the next
 * turn.
 */
import { describe, it, expect } from "vitest";

import KimchiExecutor, { stripReasoningContent } from "../../open-sse/executors/kimchi.js";
import DefaultExecutor from "../../open-sse/executors/default.js";

describe("kimchi stripReasoningContent", () => {
  it("removes long reasoning_content from assistant messages but keeps content", () => {
    const body = {
      messages: [
        { role: "user", content: "solve x+5=12" },
        {
          role: "assistant",
          content: "x = 7",
          reasoning_content: "subtract 5 from both sides ... (long reasoning block)",
        },
        { role: "user", content: "now try x+10=20" },
      ],
    };
    stripReasoningContent(body);
    expect(body.messages[1].reasoning_content).toBeUndefined();
    expect(body.messages[1].content).toBe("x = 7");
  });

  it("preserves the 1-char placeholder that injectReasoningContent sets", () => {
    // `injectReasoningContent` may insert " " (single space) on assistant
    // messages so the upstream's validation doesn't complain about missing
    // reasoning. Stripping that placeholder would defeat its purpose.
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello", reasoning_content: " " },
      ],
    };
    stripReasoningContent(body);
    expect(body.messages[1].reasoning_content).toBe(" ");
    expect(body.messages[1].content).toBe("hello");
  });

  it("preserves short custom reasoning under the threshold", () => {
    // Anything ≤8 chars is treated as a placeholder-shaped value, kept
    // verbatim. Real thinking content from a thinking model is always
    // well above this threshold.
    const body = {
      messages: [
        { role: "assistant", content: "ok", reasoning_content: "short" },
      ],
    };
    stripReasoningContent(body);
    expect(body.messages[0].reasoning_content).toBe("short");
  });

  it("leaves non-assistant messages untouched", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "be helpful" },
      ],
    };
    stripReasoningContent(body);
    expect(body.messages[0].content).toBe("hi");
    expect(body.messages[1].content).toBe("be helpful");
  });

  it("returns early on missing/empty messages array", () => {
    expect(() => stripReasoningContent({})).not.toThrow();
    expect(() => stripReasoningContent({ messages: null })).not.toThrow();
    expect(() => stripReasoningContent({ messages: [] })).not.toThrow();
  });

  it("ignores assistant messages that have no reasoning_content", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    };
    stripReasoningContent(body);
    expect(body.messages[1]).toEqual({ role: "assistant", content: "hello" });
  });

  it("handles multi-turn: strips old turns, keeps recent one", () => {
    const LONG = "x".repeat(1000);
    const body = {
      messages: [
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1", reasoning_content: LONG },
        { role: "user", content: "q2" },
        { role: "assistant", content: "a2", reasoning_content: " " }, // placeholder
      ],
    };
    stripReasoningContent(body);
    expect(body.messages[1].reasoning_content).toBeUndefined();
    expect(body.messages[3].reasoning_content).toBe(" ");
  });
});

describe("kimchi executor wiring", () => {
  it("KimchiExecutor extends DefaultExecutor via prototype chain", () => {
    const inst = new KimchiExecutor();
    expect(inst instanceof DefaultExecutor).toBe(true);
  });

  it("default export is KimchiExecutor class", () => {
    expect(typeof KimchiExecutor).toBe("function");
    expect(KimchiExecutor.name).toBe("KimchiExecutor");
  });
});
