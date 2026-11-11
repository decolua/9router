import { describe, expect, it } from "vitest";
import { convertResponsesApiFormat } from "../../open-sse/translator/formats/responsesApi.js";

describe("Responses API request conversion", () => {
  it("preserves nested reasoning.effort", () => {
    const out = convertResponsesApiFormat({
      input: "Reply with OK",
      reasoning: { effort: "low" },
    });

    expect(out.reasoning).toEqual({ effort: "low" });
    expect(out.reasoning_effort).toBeUndefined();
  });
});
