import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers";

describe("v1m System One provider", () => {
  const entry = REGISTRY.find((e) => e.id === "v1m");

  it("is registered as a System One apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.serviceKinds).toEqual(["systemone"]);
    expect(PROVIDER_MEDIA["v1m"]?.systemoneConfig?.baseUrl).toBe("https://v1m.ir/v1/systemone");
  });

  it("appears in getProvidersByKind('systemone')", () => {
    const list = getProvidersByKind("systemone");
    const found = list.find((p) => p.id === "v1m");
    expect(found).toBeDefined();
    expect(found.alias).toBe("v1m");
    expect(found.systemoneConfig?.baseUrl).toBe("https://v1m.ir/v1/systemone");
  });

  it("exposes calibrated models", () => {
    const ids = (entry.models || []).map((m) => m.id);
    expect(ids).toContain("rev-latest");
    expect(ids).toContain("v1m-decision-engine");
  });
});
