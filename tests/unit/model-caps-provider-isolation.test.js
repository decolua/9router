import { describe, expect, it } from "vitest";
import { buildMaps, resolveCaps } from "../../src/shared/hooks/useModelCaps.js";

describe("dashboard model capability ownership", () => {
  it("does not use another provider's custom caps for a qualified model", () => {
    const maps = buildMaps([
      {
        fullModel: "provider-a/shared-id",
        routedModel: "provider-a/shared-id",
        model: "shared-id",
        caps: { contextWindow: 123456, maxOutput: 7890 },
      },
    ]);

    expect(resolveCaps(maps.byFull, maps.byId, "provider-a/shared-id")).toMatchObject({
      contextWindow: 123456,
      maxOutput: 7890,
    });
    expect(resolveCaps(maps.byFull, maps.byId, "provider-b/shared-id")).not.toMatchObject({
      contextWindow: 123456,
      maxOutput: 7890,
    });
  });
});
