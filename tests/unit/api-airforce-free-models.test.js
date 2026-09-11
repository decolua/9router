import { describe, it, expect } from "vitest";
import airforce from "../../open-sse/providers/registry/api-airforce.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("api-airforce free models", () => {
  const ids = airforce.models.map((m) => m.id);

  it("registers the three live free models", () => {
    expect(ids).toContain("gpt-oss-120b");
    expect(ids).toContain("gpt-oss-20b");
    expect(ids).toContain("kimi-k2.7-code");
  });

  it("drops the dead catalog ids", () => {
    expect(ids).not.toContain("anthropic/claude-3.7-sonnet");
    expect(ids).not.toContain("moonshot/kimi-k2.6");
    expect(ids).not.toContain("google/gemini-2.5-flash");
  });

  it("is passthrough so any live id resolves", () => {
    expect(airforce.passthroughModels).toBe(true);
    expect(PROVIDERS["api-airforce"].forceStream).toBe(true);
  });

  it("PROVIDER_MODELS['af'] exposes the new ids", () => {
    expect(PROVIDER_MODELS.af.map((m) => m.id)).toEqual(expect.arrayContaining([
      "gpt-oss-120b", "gpt-oss-20b", "kimi-k2.7-code",
    ]));
  });

  it("caps resolve for the free ids", () => {
    expect(getCapabilitiesForModel("api-airforce", "kimi-k2.7-code").reasoning).toBe(true);
    expect(getCapabilitiesForModel("api-airforce", "gpt-oss-120b").reasoning).toBe(true);
  });
});
