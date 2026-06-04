import { describe, expect, it } from "vitest";
import { buildCapabilityRegistry, summarizeCapabilities } from "@/lib/modelRegistry.js";

describe("model capability registry", () => {
  it("classifies enabled provider models by capability including video", () => {
    const models = buildCapabilityRegistry({
      connections: [
        {
          id: "conn-runway",
          provider: "runwayml",
          name: "Runway",
          isActive: true,
          testStatus: "active",
          providerSpecificData: {},
        },
      ],
    });

    const imageModel = models.find((model) => model.id === "runway/gen4_image");
    const videoModel = models.find((model) => model.id === "runway/gen4_turbo");

    expect(imageModel).toMatchObject({
      kind: "image",
      endpoint: "/v1/images/generations",
      availability: { status: "available" },
    });
    expect(videoModel).toMatchObject({
      kind: "video",
      endpoint: "/v1/video/generations",
      availability: { status: "available" },
    });

    const summary = summarizeCapabilities(models);
    expect(summary.image.count).toBeGreaterThan(0);
    expect(summary.video.count).toBeGreaterThan(0);
  });

  it("filters disabled models by provider alias", () => {
    const models = buildCapabilityRegistry({
      connections: [
        {
          id: "conn-runway",
          provider: "runwayml",
          isActive: true,
          testStatus: "active",
          providerSpecificData: {},
        },
      ],
      disabledByAlias: {
        runway: ["gen4_turbo"],
      },
    });

    expect(models.some((model) => model.id === "runway/gen4_turbo")).toBe(false);
    expect(models.some((model) => model.id === "runway/gen4_image")).toBe(true);
  });
});
