import { describe, expect, it } from "vitest";

import { PROVIDERS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getTtsVoicesForModel } from "../../open-sse/config/ttsModels.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { FORMAT_HANDLERS } from "../../open-sse/handlers/ttsProviders/genericFormats.js";

describe("Alibaba Token Plan provider", () => {
  it("does not collide with the other three Alibaba key types", () => {
    const hosts = ["alicode", "alicode-intl", "alims-intl", "alitp-intl"]
      .map((id) => new URL(PROVIDERS[id].baseUrl).host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("registers an executor for every declared media kind", () => {
    expect(getImageAdapter("alitp-intl")).toBeTruthy();
    expect(FORMAT_HANDLERS[PROVIDER_MEDIA["alitp-intl"].ttsConfig.format]).toBeTypeOf("function");
    expect(getTtsVoicesForModel("alitp-intl", "qwen-audio-3.0-tts-plus").map((v) => v.id))
      .toEqual(["longanlingxin", "longanlufeng"]);
  });

  it("resolves each model's own capability key ahead of the generic qwen patterns", () => {
    // Exact key: OpenAI wire and the plan's real limits. "*qwen*max*" would
    // otherwise answer thinkingFormat "qwen" and cap output at 65536.
    expect(getCapabilitiesForModel("alitp-intl", "qwen3.7-max")).toMatchObject({
      thinkingFormat: "openai",
      maxOutput: 131072,
    });
  });

  it("exposes each model's probed reasoning_effort levels", () => {
    const levels = {
      "qwen3.8-max": ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      "qwen3.8-flash": ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      "qwen3.7-max": ["none", "minimal", "low", "medium", "high", "xhigh"],
      "qwen3.7-plus": ["none", "minimal", "low", "medium", "high", "xhigh"],
      "qwen3.6-flash": ["none", "minimal", "low", "medium", "high", "xhigh"],
      "glm-5.2": ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      "deepseek-v4-pro": ["low", "medium", "high", "xhigh", "max"],
      "deepseek-v4-pro-0813": ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      "deepseek-v4-flash-0731": ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
    };
    for (const [id, expected] of Object.entries(levels)) {
      expect(getThinkingLevels("alitp-intl", id)).toEqual(expected);
    }
  });

  it("sends the lowest accepted effort when thinking cannot be disabled", () => {
    const apply = (model, intent) => {
      const body = {};
      applyThinking(FORMATS.OPENAI, model, body, "alitp-intl", intent);
      return body.reasoning_effort;
    };
    const none = { mode: "none" };
    const minimal = { mode: "level", level: "minimal" };
    const max = { mode: "level", level: "max" };
    const ultra = { mode: "level", level: "ultra" };
    // Upstream: "'reasoning_effort' must be one of: 'low', 'medium', 'high', 'xhigh', 'max'".
    expect(apply("deepseek-v4-pro", none)).toBe("low");
    // Upstream rejects "minimal" here too, so it is raised to the floor.
    expect(apply("deepseek-v4-pro", minimal)).toBe("low");
    expect(apply("qwen3.8-max", none)).toBe("none");
    expect(apply("qwen3.7-max", max)).toBe("xhigh");
    expect(apply("qwen3.8-max", max)).toBe("max");
    expect(apply("qwen3.8-max", ultra)).toBe("max");
    expect(apply("qwen3.7-max", ultra)).toBe("xhigh");
  });

  it("normalizes thinking per transport surface", () => {
    const intent = { mode: "level", level: "high" };
    const openaiBody = {};
    applyThinking(FORMATS.OPENAI, "qwen3.8-max", openaiBody, "alitp-intl", intent);
    expect(openaiBody.reasoning_effort).toBe("high");
    expect(openaiBody.thinking).toBeUndefined();
    // A claude-format target always rides the claude transport (default surface
    // is openai), so its transport-level claude-budget format applies.
    const claudeBody = {};
    applyThinking(FORMATS.CLAUDE, "qwen3.8-max", claudeBody, "alitp-intl", intent, {
      runtimeTransport: { format: "claude", thinkingFormat: "claude-budget" },
    });
    expect(claudeBody.thinking).toMatchObject({ type: "enabled" });
    expect(claudeBody.thinking.budget_tokens).toBeGreaterThan(0);
    expect(claudeBody.reasoning_effort).toBeUndefined();
    // Upstream accepts budget_tokens 512 and 1023 on this surface (probed), so
    // the minimal effort budget is sent unchanged.
    const offBody = {};
    applyThinking(FORMATS.CLAUDE, "deepseek-v4-pro", offBody, "alitp-intl", { mode: "none" }, {
      runtimeTransport: { format: "claude", thinkingFormat: "claude-budget" },
    });
    expect(offBody.thinking).toEqual({ type: "enabled", budget_tokens: 512 });
  });
});
