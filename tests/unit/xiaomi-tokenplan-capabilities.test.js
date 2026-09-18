import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { augmentModelsWithCapacityAdapter } from "../../open-sse/services/capacityAdapter.js";

const TOKENPLAN_TEXT_MODELS = [
  "mimo-v2.5-pro",
  "mimo-v2.5-pro-claude",
  "mimo-v2.5",
];

describe("Xiaomi Token Plan capabilities", () => {
  it.each(["xiaomi-tokenplan", "xmtp"])(
    "marks V2.5 chat models as text-only through %s",
    (provider) => {
      for (const model of TOKENPLAN_TEXT_MODELS) {
        expect(getCapabilitiesForModel(provider, model)).toMatchObject({
          vision: false,
          audioInput: false,
          videoInput: false,
          contextWindow: 1048576,
          maxOutput: 131072,
        });
      }
    },
  );

  it("does not change the standard MiMo capability pattern", () => {
    expect(getCapabilitiesForModel("xiaomi-mimo", "mimo-v2.5-pro")).toMatchObject({
      vision: true,
      audioInput: true,
      videoInput: true,
    });
  });

  it("keeps Token Plan omni models multimodal", () => {
    expect(getCapabilitiesForModel("xmtp", "mimo-v2-omni")).toMatchObject({
      vision: true,
      audioInput: true,
    });
  });

  it("adds the configured vision fallback before a Token Plan text model", () => {
    const settings = {
      capacityAdapter: {
        vision: { enabled: true, models: ["glm/glm-4.6v"] },
      },
    };

    expect(augmentModelsWithCapacityAdapter(
      ["xmtp/mimo-v2.5-pro"],
      new Set(["vision"]),
      settings,
    )).toEqual(["glm/glm-4.6v", "xmtp/mimo-v2.5-pro"]);
  });
});
