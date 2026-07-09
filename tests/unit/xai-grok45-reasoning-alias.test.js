import { describe, expect, it } from "vitest";
import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";

describe("xAI Grok 4.5 reasoning aliases", () => {
  it("maps grok-4.5-high to upstream grok-4.5 with high reasoning_effort", () => {
    const body = injectReasoningContent({
      provider: "xai",
      model: "grok-4.5-high",
      body: { model: "grok-4.5-high", messages: [{ role: "user", content: "test" }] },
    });

    expect(body.model).toBe("grok-4.5");
    expect(body.reasoning_effort).toBe("high");
  });

  it("does not rewrite plain grok-4.5", () => {
    const body = injectReasoningContent({
      provider: "xai",
      model: "grok-4.5",
      body: { model: "grok-4.5", messages: [] },
    });

    expect(body).toEqual({ model: "grok-4.5", messages: [] });
  });

  it("leaves the client free to send reasoning_effort directly on grok-4.5", () => {
    const body = injectReasoningContent({
      provider: "xai",
      model: "grok-4.5",
      body: { model: "grok-4.5", reasoning_effort: "low", messages: [] },
    });

    expect(body).toEqual({ model: "grok-4.5", reasoning_effort: "low", messages: [] });
  });
});
