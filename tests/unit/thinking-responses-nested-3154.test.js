import { describe, expect, it } from "vitest";

const { applyThinking } = await import("../../open-sse/translator/concerns/thinkingUnified.js");
const { translateRequest } = await import("../../open-sse/translator/index.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

describe("#3154 reasoning effort nesting for Responses targets", () => {
  it("nests effort under reasoning for a gpt-5.6 model on an openai-responses target", () => {
    const body = { model: "gpt-5.6-luna", reasoning_effort: "high" };
    applyThinking(FORMATS.OPENAI_RESPONSES, "gpt-5.6-luna", body, "openai-compatible-responses-abc");

    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toMatchObject({ effort: "high" });
  });

  it("keeps the flat key for chat completions targets", () => {
    const body = { model: "gpt-5.6-luna", reasoning_effort: "high" };
    applyThinking(FORMATS.OPENAI, "gpt-5.6-luna", body, "openai-compatible-chat-abc");

    expect(body.reasoning_effort).toBe("high");
    expect(body.reasoning).toBeUndefined();
  });

  it("nests a disabled effort too", () => {
    const body = { model: "gpt-5.6-luna", reasoning_effort: "none" };
    applyThinking(FORMATS.OPENAI_RESPONSES, "gpt-5.6-luna", body, "openai-compatible-responses-abc");

    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toMatchObject({ effort: "none" });
  });

  it("preserves sibling reasoning keys set by the caller", () => {
    const body = { model: "gpt-5.6-luna", reasoning: { effort: "low", mode: "pro", summary: "detailed" } };
    applyThinking(FORMATS.OPENAI_RESPONSES, "gpt-5.6-luna(high)", body, "openai-compatible-responses-abc");

    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toEqual({ effort: "high", mode: "pro", summary: "detailed" });
  });

  // FORMAT_TO_NATIVE carries both spellings and usageTracking/modality dispatch on the
  // singular one, so a fix keyed to "openai-responses" alone still ships the flat key here.
  it("nests for the singular openai-response target too", () => {
    const body = { model: "gpt-5.6-luna", reasoning_effort: "high" };
    applyThinking(FORMATS.OPENAI_RESPONSE, "gpt-5.6-luna", body, "openai-compatible-responses-abc");

    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toMatchObject({ effort: "high" });
  });

  it("leaves a native Responses request nested rather than flattening it", () => {
    const out = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "gpt-5.6-luna",
      { model: "gpt-5.6-luna", input: "hi", reasoning: { effort: "high", mode: "pro" } },
      true,
      {},
      "openai-compatible-responses-abc",
    );

    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toMatchObject({ effort: "high", mode: "pro" });
  });

  it("leaves non-reasoning models untouched", () => {
    const body = { model: "gpt-4o-mini", reasoning_effort: "high" };
    applyThinking(FORMATS.OPENAI_RESPONSES, "gpt-4o-mini", body, "openai-compatible-responses-abc");

    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it("produces a Responses body with no flat reasoning_effort end to end", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "gpt-5.6-luna",
      { model: "gpt-5.6-luna", messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" },
      true,
      {},
      "openai-compatible-responses-abc",
    );

    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toMatchObject({ effort: "high", summary: "auto" });
  });
});
