import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createRegistryModelsConfig } from "../../src/app/api/providers/[id]/models/route.js";

describe("provider model discovery", () => {
  it("builds an authenticated /models request from the provider registry", () => {
    expect(createRegistryModelsConfig("verboo-code")).toMatchObject({
      url: "https://code.verboo.ai/router/v1/models",
      method: "GET",
      authHeader: "Authorization",
      authPrefix: "Bearer ",
    });
    expect(createRegistryModelsConfig("digital-ocean")).toMatchObject({
      url: "https://inference.do-ai.run/v1/models",
      authHeader: "Authorization",
      authPrefix: "Bearer ",
    });
  });

  it("derives /v1/models for providers without an explicit models endpoint", () => {
    expect(createRegistryModelsConfig("agentrouter")).toMatchObject({
      url: "https://agentrouter.org/v1/models",
      authHeader: "x-api-key",
      authPrefix: "",
    });
  });

  it("returns null only when the provider does not exist", () => {
    expect(createRegistryModelsConfig("missing-provider")).toBeNull();
  });

  it("renders discovery for every built-in and compatible provider", () => {
    const providerPage = readFileSync(
      new URL("../../src/app/(dashboard)/dashboard/providers/[id]/page.js", import.meta.url),
      "utf8"
    );
    const compatibleSection = readFileSync(
      new URL("../../src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js", import.meta.url),
      "utf8"
    );

    expect(providerPage).toContain('translate("Discover Models")');
    expect(providerPage).not.toContain("providerInfo?.canDiscoverModels");
    expect(compatibleSection).toContain('"Discover Models"');
  });
});
