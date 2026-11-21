import { describe, expect, it } from "vitest";
import { resolvedModelHeaders } from "../../open-sse/utils/upstreamHeaders.js";

describe("resolvedModelHeaders", () => {
  it("exposes resolved provider/model and context window headers", () => {
    const headers = resolvedModelHeaders("claude", "claude-opus-5.5");
    expect(headers["x-9router-model"]).toBe("claude/claude-opus-5.5");
    expect(headers["x-9router-context-window"]).toBe("1000000");
  });

  it("returns empty object when model is missing", () => {
    expect(resolvedModelHeaders("deepseek", "")).toEqual({});
    expect(resolvedModelHeaders("deepseek", null)).toEqual({});
  });
});
