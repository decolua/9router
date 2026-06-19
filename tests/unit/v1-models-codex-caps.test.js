import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("v1/models Codex caps derivation", () => {
  it("models yield a boolean supports_search_tool", () => {
    const caps = getCapabilitiesForModel("claude", "claude-sonnet-4-5");
    expect(typeof caps.search).toBe("boolean");
  });

  it("unknown custom models resolve to default (no search)", () => {
    const caps = getCapabilitiesForModel("custom", "some-unknown-xyz");
    expect(caps.search).toBeFalsy();
  });
});
