import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// claude-sonnet-5-5 has no exact entry and matched only the generic *claude*sonnet*
// pattern (claude-budget). That sent thinking.type "enabled" and made the translator
// forge signed thinking placeholders on every tool_use turn; Sonnet 5.5 answered
// large Codex conversations with stop_reason "refusal". It must resolve like the
// rest of the 5.x family: adaptive thinking, 1M context.
describe("Claude Sonnet 5.5 capabilities", () => {
  for (const model of ["claude-sonnet-5-5", "claude-sonnet-5.5", "anthropic/claude-sonnet-5-5"]) {
    it(`${model} resolves to adaptive thinking + 1M context`, () => {
      expect(getCapabilitiesForModel("claude", model)).toMatchObject({
        thinkingFormat: "claude-adaptive",
        contextWindow: 1000000,
        maxOutput: 128000,
        reasoning: true,
      });
    });
  }
});
