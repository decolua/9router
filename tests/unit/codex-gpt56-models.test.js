import { describe, expect, it } from "vitest";

import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getModelUpstreamId, isValidModel, PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import codexRegistry from "../../open-sse/providers/registry/codex.js";

function transform(model, extra = {}) {
  const executor = new CodexExecutor();
  const body = {
    model,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "probe" }] }],
    stream: true,
    ...extra,
  };
  executor.transformRequest(model, body, true, {
    connectionId: "test-codex-gpt56",
    providerSpecificData: {},
  });
  return body;
}

describe("Codex GPT-5.6 registry + reasoning", () => {
  it("exposes gpt-5.6 family model ids including alias to sol", () => {
    const ids = (PROVIDER_MODELS.cx || []).map((m) => m.id);
    for (const id of [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.6",
      "gpt-5.6-sol-review",
      "gpt-5.6-terra-review",
      "gpt-5.6-luna-review",
      "gpt-5.6-review",
    ]) {
      expect(ids, `missing ${id}`).toContain(id);
      expect(isValidModel("cx", id)).toBe(true);
    }

    expect(getModelUpstreamId("cx", "gpt-5.6")).toBe("gpt-5.6-sol");
    expect(getModelUpstreamId("cx", "gpt-5.6-review")).toBe("gpt-5.6-sol");
    expect(getModelUpstreamId("cx", "gpt-5.6-sol-review")).toBe("gpt-5.6-sol");
  });

  it("bumps Codex client fingerprint to >= 0.144.0", () => {
    const ua = PROVIDERS.codex?.headers?.["User-Agent"] || codexRegistry.transport?.headers?.["User-Agent"];
    expect(ua).toMatch(/^codex_cli_rs\/(\d+)\.(\d+)\.(\d+)$/);
    const [, major, minor, patch] = ua.match(/^codex_cli_rs\/(\d+)\.(\d+)\.(\d+)$/);
    const version = [Number(major), Number(minor), Number(patch)];
    expect(version[0] > 0 || version[1] > 144 || (version[1] === 144 && version[2] >= 0)).toBe(true);
    // Prefer exact official minimum from Codex docs when we control the constant.
    expect(ua).toBe("codex_cli_rs/0.144.0");
    expect(codexRegistry.thinkingConfig.options).toEqual([
      "auto",
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("maps model suffixes and reasoning_effort through xhigh/max for gpt-5.6-sol", () => {
    const high = transform("gpt-5.6-sol-high");
    expect(high.model).toBe("gpt-5.6-sol");
    expect(high.reasoning).toEqual({ effort: "high", summary: "auto" });

    const xhigh = transform("gpt-5.6-sol-xhigh");
    expect(xhigh.model).toBe("gpt-5.6-sol");
    expect(xhigh.reasoning).toEqual({ effort: "xhigh", summary: "auto" });

    const maxSuffix = transform("gpt-5.6-sol-max");
    expect(maxSuffix.model).toBe("gpt-5.6-sol");
    expect(maxSuffix.reasoning).toEqual({ effort: "max", summary: "auto" });

    const aliasMax = transform("gpt-5.6", { reasoning_effort: "max" });
    expect(aliasMax.model).toBe("gpt-5.6-sol");
    expect(aliasMax.reasoning).toEqual({ effort: "max", summary: "auto" });

    const levels = getThinkingLevels("codex", "gpt-5.6-sol");
    expect(levels).toEqual(expect.arrayContaining(["low", "medium", "high", "xhigh", "max"]));
    expect(levels).not.toContain("none");
  });
});
