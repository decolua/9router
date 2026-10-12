import { describe, expect, it } from "vitest";

import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// #4409: intermittent 400 code 1210 "Invalid API parameter" on GLM-5.3-Flash via
// https://api.z.ai/api/anthropic/v1/messages, starting in v0.5.91.
//
// z.ai's docs are explicit: "GLM-5.3 and GLM-5.3-FLASH no longer support
// disabling thinking (an error will occur if the thinking.type parameter is set
// to disabled). Please ensure that thinking is enabled."
//
// capabilities.js advertised thinkingCanDisable:true for that line, so
// applyThinking emitted enable_thinking:false on any turn that asked for no
// reasoning — which is why it was INTERMITTENT: only some turns ask.

const models = ["glm-5.3-flash", "glm-5.3"];

describe("GLM 5.3 must never be sent thinking=disabled (#4409)", () => {
  it.each(models)("%s is marked as unable to disable thinking", (id) => {
    expect(getCapabilitiesForModel("glm", id).thinkingCanDisable).toBe(false);
  });

  it.each([
    ["reasoning_effort: none", { reasoning_effort: "none" }],
    ["reasoning_effort: off", { reasoning_effort: "off" }],
    ["thinking.type: disabled", { thinking: { type: "disabled" } }],
  ])("%s leaves thinking enabled rather than disabling it", (_label, seed) => {
    for (const id of models) {
      const body = structuredClone(seed);
      applyThinking("claude", id, body, "glm");
      // The failure z.ai reports: enable_thinking:false / thinking disabled.
      expect(body.enable_thinking, id).toBeUndefined();
      expect(body.thinking?.type, id).not.toBe("disabled");
    }
  });

  it.each(models)("%s leaves a normal request's own thinking intact", (id) => {
    // With no disable signal, applyThinking does not inject anything — the
    // client's own thinking block passes through untouched. What matters is
    // that nothing turns it OFF.
    const body = { thinking: { type: "enabled" } };
    applyThinking("claude", id, body, "glm");
    expect(body.enable_thinking, id).toBeUndefined();
    expect(body.thinking?.type, id).not.toBe("disabled");
  });

  it("does not regress the models that CAN disable thinking", () => {
    // 5.1 and older still accept thinking.type=disabled, and this fix must not
    // change that. (glm-5.2 is deliberately NOT asserted here: a pre-existing
    // exact MODEL_CAPABILITIES entry sets canDisable:false for it, which is
    // separate from #4409.)
    for (const id of ["glm-5.1", "glm-5-turbo", "glm-5"]) {
      expect(getCapabilitiesForModel("glm", id).thinkingCanDisable, id).toBe(true);
      const b = { reasoning_effort: "none" };
      applyThinking("claude", id, b, "glm");
      expect(b.enable_thinking, id).toBe(false);
    }
  });
});
