import { describe, it, expect } from "vitest";
import {
  createMinimaxThinkingStreamState,
  processMinimaxThinkingText,
  sanitizeMinimaxDelta,
  flushMinimaxThinkingStreamState,
  isMinimaxThinkingProvider,
} from "../../open-sse/utils/minimaxThinkingStream.js";

describe("minimaxThinkingStream", () => {
  it("detects minimax providers", () => {
    expect(isMinimaxThinkingProvider("minimax")).toBe(true);
    expect(isMinimaxThinkingProvider("minimax-cn")).toBe(true);
    expect(isMinimaxThinkingProvider("openai")).toBe(false);
  });

  it("splits redacted_thinking markers across one chunk", () => {
    const out = processMinimaxThinkingText(
      "<think>\nplan\n</think>\nHi",
      false,
    );
    expect(out).toEqual({
      content: "\nHi",
      reasoning: "\nplan\n",
      carry: "",
      inThinking: false,
    });
  });

  it("splits mm:think markers", () => {
    const out = processMinimaxThinkingText("<mm:think>why</mm:think>ok", false);
    expect(out.content).toBe("ok");
    expect(out.reasoning).toBe("why");
    expect(out.inThinking).toBe(false);
  });

  it("strips orphaned closing mm:think tag", () => {
    const out = processMinimaxThinkingText("</mm:think>answer", false);
    expect(out.content).toBe("answer");
    expect(out.reasoning).toBe("");
  });

  it("holds partial end marker across chunks", () => {
    const state = createMinimaxThinkingStreamState();
    const d1 = { content: "<mm:think>why</mm:thi" };
    sanitizeMinimaxDelta(d1, state);
    expect(d1.content).toBeUndefined();
    expect(d1.reasoning_content).toBe("why");

    const d2 = { content: "nk>ok" };
    sanitizeMinimaxDelta(d2, state);
    expect(d2.content).toBe("ok");
    expect(state.inThinking).toBe(false);
  });

  it("sanitizes delta.content and maps delta.reasoning", () => {
    const state = createMinimaxThinkingStreamState();
    const delta = { content: "</mm:think>answer", reasoning: "trail" };
    expect(sanitizeMinimaxDelta(delta, state)).toBe(true);
    expect(delta.content).toBe("answer");
    expect(delta.reasoning_content).toBe("trail");
    expect(delta.reasoning).toBeUndefined();
  });

  it("flushes trailing carry on stream end", () => {
    const state = createMinimaxThinkingStreamState();
    state.carry = "tail";
    state.inThinking = true;
    const flushed = flushMinimaxThinkingStreamState(state);
    expect(flushed).toEqual({ content: "", reasoning: "tail" });
    expect(state.carry).toBe("");
  });
});
