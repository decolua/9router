import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

// Regression for #4031. OpenAI's reasoning models reject the value outright:
//   400 Unsupported value: 'reasoning_effort' does not support 'none'
// so a request that merely omits reasoning_effort was failing, because
// applyThinking wrote "none" for them. The mechanism to avoid that already
// existed -- `thinkingCanDisable: false` clamps to the minimum instead of
// disabling -- and these models simply did not declare it.
const REASONING_MODELS = [
  ["codex", "gpt-6-astra"],
  ["codex", "gpt-5.6-sol"],
  ["codex", "gpt-5.6-terra"],
  ["codex", "gpt-5.6-luna"],
  ["codex", "gpt-5.6-sol-review"],
  ["kiro", "gpt-5.6-sol"],
  ["kiro", "gpt-5.6-terra-thinking"],
  ["kiro", "gpt-5.6-luna-agentic"],
];

describe("#4031 OpenAI reasoning models cannot disable thinking", () => {
  it.each(REASONING_MODELS)("%s/%s never sends reasoning_effort:none", (provider, model) => {
    const out = applyThinking(FORMATS.OPENAI, model, { reasoning_effort: "none" }, provider);
    expect(out.reasoning_effort).not.toBe("none");
    expect(out.reasoning_effort).toBe("minimal");
  });

  it.each(REASONING_MODELS)("%s/%s does not advertise none as a level", (provider, model) => {
    expect(getThinkingLevels(provider, model)).not.toContain("none");
  });

  it("a request with no thinking field at all stays clean", () => {
    // The reporter's actual call: no reasoning_effort sent, and the upstream
    // still rejected one. Whatever is emitted here, it must not be "none".
    const out = applyThinking(FORMATS.OPENAI, "gpt-6-astra", { model: "gpt-6-astra" }, "codex");
    expect(out.reasoning_effort).not.toBe("none");
  });

  it("an explicit level still passes through", () => {
    // The accept control: clamping "none" must not flatten every request to
    // the minimum. A caller asking for high still gets high.
    const out = applyThinking(FORMATS.OPENAI, "gpt-6-astra", { reasoning_effort: "high" }, "codex");
    expect(out.reasoning_effort).toBe("high");
  });

  it("a model that CAN disable still disables", () => {
    // The other accept control. `thinkingCanDisable` is per model, and a plain
    // openai-format model without the flag must keep its "none".
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", { reasoning_effort: "none" }, "openai");
    expect(out.reasoning_effort).toBe("none");
    expect(getThinkingLevels("openai", "gpt-5")).toContain("none");
  });
});
