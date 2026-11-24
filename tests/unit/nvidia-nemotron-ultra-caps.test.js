import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("NVIDIA-hosted Nemotron 3 Ultra capabilities", () => {
  it("uses the verified hosted window and tools without inventing a larger output limit", () => {
    expect(getCapabilitiesForModel("nvidia", "nvidia/nemotron-3-ultra-550b-a55b"))
      .toMatchObject({ contextWindow: 1000000, tools: true, reasoning: true, maxOutput: 8192 });
  });
});
