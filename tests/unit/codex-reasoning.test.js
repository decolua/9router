import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

function transformCodex(model, body = {}) {
  const executor = new CodexExecutor();
  return executor.transformRequest(model, { input: "hello", ...body }, true, {});
}

describe("CodexExecutor reasoning effort", () => {
  it("defaults missing reasoning effort to medium", () => {
    const body = transformCodex("gpt-5.5");

    expect(body.model).toBe("gpt-5.5");
    expect(body.reasoning).toEqual({ effort: "medium", summary: "auto" });
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
  });

  it("uses model suffixes as reasoning effort selectors", () => {
    const body = transformCodex("gpt-5.5-high");

    expect(body.model).toBe("gpt-5.5");
    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
  });

  it("lets request reasoning_effort override model suffixes", () => {
    const body = transformCodex("gpt-5.5-high", { reasoning_effort: "low" });

    expect(body.model).toBe("gpt-5.5");
    expect(body.reasoning).toEqual({ effort: "low", summary: "auto" });
  });

  it("preserves explicit reasoning objects", () => {
    const body = transformCodex("gpt-5.5-high", {
      reasoning: { effort: "none" },
      reasoning_effort: "low",
    });

    expect(body.model).toBe("gpt-5.5");
    expect(body.reasoning).toEqual({ effort: "none", summary: "auto" });
    expect(body.include).toBeUndefined();
  });

  it("lists GPT 5.5 effort variants for clients that configure by model id", () => {
    const modelIds = PROVIDER_MODELS.cx.map((model) => model.id);

    expect(modelIds).toContain("gpt-5.5-xhigh");
    expect(modelIds).toContain("gpt-5.5-high");
    expect(modelIds).toContain("gpt-5.5-medium");
    expect(modelIds).toContain("gpt-5.5-low");
    expect(modelIds).toContain("gpt-5.5-none");
  });
});
