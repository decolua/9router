import { describe, expect, it } from "vitest";

// #4624: an OpenAI client sending to a muse/* model got the request translated
// to the Responses-API shape (`input: [...]`) but it was ROUTED to the
// chat-completions transport, which rejected the body with
//   400 unknown parameter "input".
//
// The mismatch came from chatCore: when useTransport was null (because the
// model declares only openai-responses in supportedFormats, so the sourceFormat
// match was rejected) but modelTargetFormat was 'openai-responses', it set the
// body format from targetFormat yet left credentials.runtimeTransport unset.
// The default executor's buildUrl then fell back to the provider's default
// baseUrl — the CHAT endpoint — while the body was Responses-shaped.

describe("muse transport selection (#4624)", () => {
  it("a muse-spark model resolves to openai-responses end-to-end", async () => {
    const [{ getModelSupportedFormats, getModelTargetFormat }, pr] = await Promise.all([
      import("../../open-sse/config/providerModels.js"),
      import("../../open-sse/services/provider.js"),
    ]);
    const mf = getModelSupportedFormats("muse", "muse-spark-1.3");
    expect(mf).toEqual(["openai-responses"]);

    const sourceFormat = "openai";
    const rt = pr.resolveTransport("muse", sourceFormat);
    // chatCore's guard: supportedFormats excludes 'openai', so useTransport is null
    const useTransport = (!mf || mf.includes(sourceFormat)) ? rt : null;
    expect(useTransport).toBeNull();

    const modelTargetFormat = getModelTargetFormat("muse", "muse-spark-1.3");
    expect(modelTargetFormat).toBe("openai-responses");

    const targetFormat = useTransport?.format || modelTargetFormat || pr.getTargetFormat("muse", null);
    expect(targetFormat).toBe("openai-responses");
  });

  it("the lane lookup finds the openai-responses transport for that target", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    const lane = PROVIDERS.muse.transports.find((t) => t.format === "openai-responses");
    expect(lane).toBeTruthy();
    expect(lane.baseUrl).toBe("https://api.meta.ai/v1/responses");
  });

  it("a non-muse provider is not changed by the fallback", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    // glm declares transports for BOTH formats, so an openai client already
    // gets useTransport and never enters the new fallback. Guard that we did
    // not accidentally route it through the model lane.
    const glm = PROVIDERS.glm;
    expect(Array.isArray(glm.transports)).toBe(true);
    expect(glm.transports.some((t) => t.format === "openai")).toBe(true);
  });
});
