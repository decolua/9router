import { describe, expect, it } from "vitest";
import { normalizeModelsUrl } from "../../src/lib/providerModelsUrl.js";

describe("provider models URL normalization", () => {
  it("keeps a full HTTPS models endpoint instead of deriving it from the base URL", () => {
    expect(normalizeModelsUrl(" https://example.com/catalog/available-models ")).toBe(
      "https://example.com/catalog/available-models",
    );
  });

  it("allows clearing an override so the provider default is used", () => {
    expect(normalizeModelsUrl("  ")).toBe("");
  });

  it("rejects unsupported URL protocols", () => {
    expect(() => normalizeModelsUrl("file:///tmp/models.json")).toThrow("http or https");
  });
});
