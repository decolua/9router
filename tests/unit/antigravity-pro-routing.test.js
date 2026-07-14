// Regression test for GitHub issue #803:
//   MITM Antigravity does not work for gemini 3.1 pro models — selecting the pro
//   model shows no request in 9router and Antigravity chat does not respond.
//
// Root cause: the antigravity provider registry (open-sse/providers/registry/antigravity.js)
// listed only `gemini-pro-agent` and `gemini-3.1-pro-low`. When the Antigravity/MITM IDE
// sends the canonical Google id `gemini-3.1-pro-preview`, the open-sse engine could not
// resolve it for the `ag` provider (`isValidModel('ag','gemini-3.1-pro-preview')` === false),
// so no route was produced — matching the reporter's "no request in 9router".
//
// Fix: add `gemini-3.1-pro-preview` (+ `gemini-3.1-pro`) to the antigravity registry,
// remapped via `upstreamModelId` to the working antigravity pro endpoint `gemini-pro-agent`.
// This test asserts the pro model id is selectable AND that the id sent upstream is the
// endpoint-accepted `gemini-pro-agent` (not the raw `gemini-3.1-pro-preview`, which the
// Antigravity v1internal API rejects).
import { describe, it, expect } from "vitest";

describe("antigravity gemini 3.1 pro routing (issue #803)", () => {
  it("resolves the canonical pro model id for the antigravity provider", async () => {
    const { isValidModel, getModelsByProviderId, PROVIDER_MODELS } = await import(
      "../../open-sse/config/providerModels.js"
    );

    expect(PROVIDER_MODELS["ag"]).toBeDefined();

    // The exact id the Antigravity/MITM IDE sends for "gemini 3.1 pro".
    const proId = "gemini-3.1-pro-preview";

    // Before the fix this was false → request never reached 9router.
    expect(isValidModel("ag", proId)).toBe(true);

    // It must also be a registered model for the antigravity provider.
    const ids = getModelsByProviderId("antigravity").map((m) => m.id);
    expect(ids).toContain(proId);
  });

  it("remaps the pro preview/base id to the endpoint-accepted gemini-pro-agent upstream id", async () => {
    const { getModelUpstreamId } = await import(
      "../../open-sse/config/providerModels.js"
    );

    // The working Antigravity pro endpoint id is gemini-pro-agent.
    // Forwarding the raw preview id would be rejected by v1internal.
    expect(getModelUpstreamId("ag", "gemini-3.1-pro-preview")).toBe("gemini-pro-agent");
    expect(getModelUpstreamId("ag", "gemini-3.1-pro")).toBe("gemini-pro-agent");
    // The explicit pro id still maps to itself.
    expect(getModelUpstreamId("ag", "gemini-pro-agent")).toBe("gemini-pro-agent");
  });

  it("keeps existing opus/flash/pro/low models routeable (no regression)", async () => {
    const { isValidModel } = await import("../../open-sse/config/providerModels.js");

    // Reported as already-working by the issue; must stay working.
    expect(isValidModel("ag", "gemini-pro-agent")).toBe(true);
    expect(isValidModel("ag", "gemini-3.1-pro-low")).toBe(true);
    expect(isValidModel("ag", "claude-opus-4-6-thinking")).toBe(true);
    expect(isValidModel("ag", "gemini-3.5-flash-low")).toBe(true);
  });
});
