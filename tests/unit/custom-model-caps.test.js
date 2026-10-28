import { describe, expect, it } from "vitest";
import { findCustomModelCaps } from "../../src/lib/customModelCaps.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";

describe("custom model capability overrides", () => {
  const models = [
    { providerAlias: "fireworks", id: "image-model", type: "llm", caps: { vision: true } },
    { providerAlias: "other", id: "image-model", type: "llm", caps: { vision: false } },
  ];

  it("restores the user's vision toggle for the matching provider", () => {
    const caps = { ...getCapabilitiesForModel("fireworks", "image-model"), ...findCustomModelCaps(models, ["fireworks"], "image-model") };
    expect(caps.vision).toBe(true);
    const request = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }] };
    stripUnsupportedModalities(request, "openai", caps);
    expect(request.messages[0].content[0].type).toBe("image_url");
  });

  it("does not apply one provider's toggle to another model or modality", () => {
    expect(findCustomModelCaps(models, ["unrelated"], "image-model")).toBeNull();
    expect(findCustomModelCaps(models, ["fireworks"], "different-model")).toBeNull();
  });
});
