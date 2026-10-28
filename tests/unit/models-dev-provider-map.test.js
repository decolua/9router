import { describe, expect, it } from "vitest";
import { resolveModelsDevProviderId } from "@/lib/modelsDev/providerMap.js";

describe("resolveModelsDevProviderId", () => {
  it("maps known 9router ids via the candidates table", () => {
    expect(resolveModelsDevProviderId("claude", ["anthropic", "openai"])).toBe("anthropic");
    expect(resolveModelsDevProviderId("gemini", ["google"])).toBe("google");
    expect(resolveModelsDevProviderId("kimi", ["moonshotai"])).toBe("moonshotai");
  });

  it("picks the first candidate that exists in the catalog", () => {
    expect(resolveModelsDevProviderId("vertex", ["google"])).toBe("google");
    expect(resolveModelsDevProviderId("vertex", ["google-vertex", "google"])).toBe("google-vertex");
    expect(resolveModelsDevProviderId("siliconflow", ["siliconflow-cn"])).toBe("siliconflow-cn");
  });

  it("falls back to an exact id match", () => {
    expect(resolveModelsDevProviderId("deepseek", ["deepseek"])).toBe("deepseek");
  });

  it("falls back to a normalized id match (dashes/case stripped)", () => {
    expect(resolveModelsDevProviderId("some-provider", ["someprovider"])).toBe("someprovider");
    expect(resolveModelsDevProviderId("SomeProvider", ["someprovider"])).toBe("someprovider");
  });

  it("returns null when nothing maps", () => {
    expect(resolveModelsDevProviderId("unknown-xyz", ["openai"])).toBeNull();
    expect(resolveModelsDevProviderId("unknown-xyz", [])).toBeNull();
    expect(resolveModelsDevProviderId(null, ["openai"])).toBeNull();
    expect(resolveModelsDevProviderId("", ["openai"])).toBeNull();
  });

  it("accepts a Set of catalog ids", () => {
    expect(resolveModelsDevProviderId("claude", new Set(["anthropic"]))).toBe("anthropic");
    expect(resolveModelsDevProviderId("claude", new Set(["openai"]))).toBeNull();
  });
});
