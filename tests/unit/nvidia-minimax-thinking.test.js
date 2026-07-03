import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

/**
 * Regression guard for issue #2268:
 * NVIDIA-hosted minimaxai/minimax-m2.7 returns 400 "Unsupported parameter(s): thinking"
 * because the *minimax-m2.7* pattern gave thinkingFormat:"minimax" → body.thinking={type:"adaptive"}.
 * NVIDIA's OpenAI-compatible wrapper does not forward the native MiniMax thinking field.
 *
 * Fix: PROVIDER_CAPABILITIES["nvidia"]["minimaxai/minimax-m2.7"] = { reasoning: false }
 * ensures applyThinking calls stripAll() and strips any thinking fields for this model.
 */

describe("NVIDIA minimax-m2.7 capabilities", () => {
  it("has reasoning:false via provider override (not the minimax pattern)", () => {
    const caps = getCapabilitiesForModel("nvidia", "minimaxai/minimax-m2.7");
    expect(caps.reasoning).toBe(false);
  });

  it("does not inherit thinkingFormat:minimax from the pattern", () => {
    const caps = getCapabilitiesForModel("nvidia", "minimaxai/minimax-m2.7");
    // thinkingFormat is irrelevant when reasoning:false, but ensure it's not set to minimax
    // (which would set body.thinking even with the pattern match).
    expect(caps.thinkingFormat).not.toBe("minimax");
  });

  it("direct MiniMax API still gets reasoning:true from pattern", () => {
    // When no provider is given (or provider is 'minimax'), the pattern *minimax-m2.7*
    // should still match and give the correct minimax format.
    const caps = getCapabilitiesForModel(null, "minimax-m2.7");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("minimax");
  });

  it("provider override takes priority over pattern for NVIDIA", () => {
    // Confirm lookup order: provider-specific > exact > pattern.
    const nvidiaMin = getCapabilitiesForModel("nvidia", "minimaxai/minimax-m2.7");
    const directMin = getCapabilitiesForModel(null, "minimaxai/minimax-m2.7");

    expect(nvidiaMin.reasoning).toBe(false); // NVIDIA provider override wins
    expect(directMin.reasoning).toBe(true);  // pattern match wins when no provider
  });
});
