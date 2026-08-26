import { describe, expect, it } from "vitest";

// Make sure the chat handler path has the side-effect imports it needs.
describe("chatCore transitive imports", () => {
  it("registers the modality registry into capabilities.js", { timeout: 15000 }, async () => {
    const { getCapabilitiesForModel } = await import("../../open-sse/providers/capabilities.js");
    const { __setForTests } = await import("../../open-sse/services/modalityRegistry.js");
    
    // Simulate what the DB learner does.
    __setForTests(new Map([["test/route", { vision: true }]]));
    
    // Without the side-effect import in chatCore.js, getCapabilitiesForModel
    // would fall through to the static floor (vision: false).
    console.log("importing..."); await import("../../open-sse/handlers/chatCore.js"); console.log("imported.");
    
    const caps = getCapabilitiesForModel("test", "route");
    expect(caps.vision).toBe(true);
  });
});
