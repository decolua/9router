import { describe, expect, it } from "vitest";
import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";

describe("xAI Grok 4.3 reasoning aliases", () => {
  it("maps grok-4.3-high to upstream grok-4.3 with high reasoning_effort", () => {
    const body = injectReasoningContent({
      provider: "xai",
      model: "grok-4.3-high",
      body: { model: "grok-4.3-high", messages: [{ role: "user", content: "test" }] },
    });

    expect(body.model).toBe("grok-4.3");
    expect(body.reasoning_effort).toBe("high");
  });

  it("does not rewrite plain grok-4.3", () => {
    const body = injectReasoningContent({
      provider: "xai",
      model: "grok-4.3",
      body: { model: "grok-4.3", messages: [] },
    });

    expect(body).toEqual({ model: "grok-4.3", messages: [] });
  });

  it("leaves the client free to send reasoning_effort directly on grok-4.3", () => {
    const body = injectReasoningContent({
      provider: "xai",
      model: "grok-4.3",
      body: { model: "grok-4.3", reasoning_effort: "medium", messages: [] },
    });

    expect(body).toEqual({ model: "grok-4.3", reasoning_effort: "medium", messages: [] });
  });
});
