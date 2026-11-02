import { describe, expect, it } from "vitest";

import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

// 2026-10-18: glm-5.3-flash-free on OpenCode's own inference service answered
//   400 [unknown_parameter] invalid request body: json: unknown field "thinking"
// for the zai `thinking` object the *glm-5.3* pattern advertised, while
// reasoning_effort was accepted (probed live on /inference/v1 and /zen/v1; the
// paid glm-5.3-flash already carries the same fix via opencode-go).
const LANES = ["opencode", "opencode-zen"];

describe("OpenCode free GLM-5.3-Flash travels as OpenAI reasoning_effort", () => {
  it.each(LANES)("%s sends reasoning_effort and never a zai thinking object", (provider) => {
    const body = { reasoning_effort: "high", messages: [{ role: "user", content: "hi" }] };
    applyThinking("openai", "glm-5.3-flash-free", body, provider);
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBe("high");
  });

  it.each(LANES)("%s keeps the effort picker free of the zai on/off pair", (provider) => {
    const levels = getThinkingLevels(provider, "glm-5.3-flash-free");
    expect(levels).toContain("high");
    expect(levels).not.toContain("thinking");
    expect(levels).not.toContain("none"); // thinkingCanDisable:false — GLM 5.3 always thinks
  });

  it("does not regress the zai-served GLM-5.3-Flash lines", () => {
    // glm / glm-cn / codebuddy-cn speak the native z.ai shapes: glm-5.3-flash
    // keeps the binary thinking switch (codebuddy-cn uses reasoning_effort).
    expect(getCapabilitiesForModel("glm", "glm-5.3-flash").thinkingFormat).toBe("zai");
    const body = { reasoning_effort: "high" };
    applyThinking("openai", "glm-5.3-flash", body, "glm");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBeUndefined();
  });
});
