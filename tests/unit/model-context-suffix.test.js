import { describe, it, expect } from "vitest";

import { getModelInfoCore } from "../../open-sse/services/model.js";
import { getComboModelsFromData } from "../../open-sse/services/combo.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("recognized 1M context suffix routing", () => {
  it("prefers an exact alias over the base-name fallback", async () => {
    await expect(getModelInfoCore("cc-gpt-main-agent[1m]", {
      "cc-gpt-main-agent[1m]": "cx/gpt-5.5",
      "cc-gpt-main-agent": "cx/gpt-5.6-terra",
    })).resolves.toEqual({
      provider: "codex",
      model: "gpt-5.5",
    });
  });

  it("falls back to the base alias when Claude Code appends [1m]", async () => {
    await expect(getModelInfoCore("cc-gpt-main-agent[1m]", {
      "cc-gpt-main-agent": "cx/gpt-5.6-terra",
    })).resolves.toEqual({
      provider: "codex",
      model: "gpt-5.6-terra",
    });
  });

  it("resolves combo lookup through the base name when the request ends with [1m]", () => {
    expect(getComboModelsFromData("subscription[1m]", [
      {
        name: "subscription",
        models: ["cc/claude-opus-4-8", "cx/gpt-5.6-terra"],
      },
    ])).toEqual(["cc/claude-opus-4-8", "cx/gpt-5.6-terra"]);
  });

  it("prefers an exact combo name over the base-name fallback", () => {
    expect(getComboModelsFromData("subscription[1m]", [
      {
        name: "subscription[1m]",
        models: ["cx/gpt-5.5"],
      },
      {
        name: "subscription",
        models: ["cc/claude-opus-4-8", "cx/gpt-5.6-terra"],
      },
    ])).toEqual(["cx/gpt-5.5"]);
  });

  it("strips [1m] from direct Claude upstream model forwarding", () => {
    expect(getModelUpstreamId("cc", "claude-opus-4-8[1m]")).toBe("claude-opus-4-8");
  });

  it("also strips [1M] from direct Claude upstream model forwarding", () => {
    expect(getModelUpstreamId("cc", "claude-opus-4-8[1M]")).toBe("claude-opus-4-8");
  });

  it("strips -1m from GPT/Codex fallback model forwarding", () => {
    expect(getModelUpstreamId("cx", "gpt-5.6-terra-1m")).toBe("gpt-5.6-terra");
  });

  it("keeps Claude 1M capabilities when the client suffix is present", () => {
    expect(getCapabilitiesForModel("claude", "claude-opus-4-8[1M]").contextWindow).toBe(1000000);
  });

  it("does not strip unrecognized suffixes", async () => {
    await expect(getModelInfoCore("cc-gpt-main-agent[preview]", {
      "cc-gpt-main-agent": "cx/gpt-5.6-terra",
    })).resolves.toEqual({
      provider: "openai",
      model: "cc-gpt-main-agent[preview]",
    });
    expect(getComboModelsFromData("subscription[preview]", [
      {
        name: "subscription",
        models: ["cc/claude-opus-4-8", "cx/gpt-5.6-terra"],
      },
    ])).toBeNull();
    expect(getModelUpstreamId("cc", "claude-opus-4-8[preview]")).toBe("claude-opus-4-8[preview]");
  });
});
