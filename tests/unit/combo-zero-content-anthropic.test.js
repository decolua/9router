import { describe, it, expect } from "vitest";
import { isZeroContentResponse } from "../../open-sse/services/combo.js";

describe("isZeroContentResponse (Anthropic thinking)", () => {
  it("treats a thinking-only Anthropic answer as non-empty", () => {
    const data = { content: [{ type: "thinking", thinking: "reasoning..." }], stop_reason: "in_progress" };
    expect(isZeroContentResponse(data)).toBe(false);
  });

  it("treats an empty Anthropic answer as empty", () => {
    const data = { content: [], stop_reason: "in_progress" };
    expect(isZeroContentResponse(data)).toBe(true);
  });
});
