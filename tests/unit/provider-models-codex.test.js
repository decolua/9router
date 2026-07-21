import { describe, expect, it } from "vitest";
import {
  getModelReasoningEfforts,
  getModelReasoningMode,
  getModelReasoningModes,
  getModelUpstreamId,
  getProviderModels,
} from "../../open-sse/config/providerModels.js";

const GPT_56_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"];

describe("Codex model reasoning metadata", () => {
  it.each(["sol", "terra", "luna"])("exposes GPT-5.6 %s capabilities", (variant) => {
    const model = `gpt-5.6-${variant}`;
    expect(getModelReasoningEfforts("cx", model)).toEqual(GPT_56_EFFORTS);
    expect(getModelReasoningModes("cx", model)).toEqual(["standard", "pro"]);
  });

  it.each(["sol", "terra", "luna"])("maps the GPT-5.6 %s Pro alias without leaking it upstream", (variant) => {
    const alias = `gpt-5.6-${variant}-pro`;
    expect(getModelReasoningEfforts("cx", alias)).toEqual(GPT_56_EFFORTS);
    expect(getModelReasoningModes("cx", alias)).toEqual(["standard", "pro"]);
    expect(getModelReasoningMode("cx", alias)).toBe("pro");
    expect(getModelUpstreamId("cx", alias)).toBe(`gpt-5.6-${variant}`);
  });

  it("exposes the virtual Pro aliases through the Codex model catalogue", () => {
    const ids = getProviderModels("cx").map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining([
      "gpt-5.6-sol-pro",
      "gpt-5.6-terra-pro",
      "gpt-5.6-luna-pro",
    ]));
  });

  it("preserves metadata and upstream mapping for review aliases", () => {
    expect(getModelReasoningEfforts("cx", "gpt-5.6-sol-review")).toEqual(GPT_56_EFFORTS);
    expect(getModelReasoningModes("cx", "gpt-5.6-sol-review")).toEqual(["standard", "pro"]);
    expect(getModelUpstreamId("cx", "gpt-5.6-sol-review")).toBe("gpt-5.6-sol");
  });

  it("keeps legacy models on the legacy reasoning contract", () => {
    expect(getModelReasoningEfforts("cx", "gpt-5.5")).toBeNull();
    expect(getModelReasoningModes("cx", "gpt-5.5")).toBeNull();
    expect(getModelReasoningMode("cx", "gpt-5.5")).toBeNull();
  });
});
