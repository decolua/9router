// resolveQoderModelKey: clients may pass a Qoder model as the canonical slot
// key (qmodel_latest) OR its display name ("Qwen4-Max-Preview"). Slot keys are
// recycled aliases — qmodel_latest carried Qwen3.7-Max and now carries
// Qwen4-Max-Preview — so the display name is the stable way to ask for a model.
import { describe, expect, it } from "vitest";
import { resolveQoderModelKey } from "../../open-sse/shared/qoder/constants.js";

describe("resolveQoderModelKey", () => {
  it("passes canonical slot keys through", () => {
    expect(resolveQoderModelKey("qmodel_latest")).toBe("qmodel_latest");
    expect(resolveQoderModelKey("qmodel_preview")).toBe("qmodel_preview");
    expect(resolveQoderModelKey("gmodel")).toBe("gmodel");
    expect(resolveQoderModelKey("smodel")).toBe("smodel");
  });

  it("resolves display names to their slot key", () => {
    expect(resolveQoderModelKey("Qwen4-Max-Preview")).toBe("qmodel_latest");
    expect(resolveQoderModelKey("Qwen3.8-Max-Preview")).toBe("qmodel_preview");
    expect(resolveQoderModelKey("GLM-5.3")).toBe("gmodel");
    expect(resolveQoderModelKey("Kimi-K3.1-Pro")).toBe("kmodel_latest");
    expect(resolveQoderModelKey("DeepSeek-V4-Pro")).toBe("dmodel");
    expect(resolveQoderModelKey("Sonus")).toBe("smodel");
  });

  it("is case-insensitive and tolerates spaces/underscores", () => {
    expect(resolveQoderModelKey("qwen4 max preview")).toBe("qmodel_latest");
    expect(resolveQoderModelKey("QWEN4_MAX_PREVIEW")).toBe("qmodel_latest");
    expect(resolveQoderModelKey("  qwen3.8-max-preview ")).toBe("qmodel_preview");
  });

  it("strips an optional qoder/ prefix", () => {
    expect(resolveQoderModelKey("qoder/qmodel_latest")).toBe("qmodel_latest");
    expect(resolveQoderModelKey("qoder/Qwen4-Max-Preview")).toBe("qmodel_latest");
  });

  it("returns unknown names unchanged so model_config resolution fails loudly", () => {
    expect(resolveQoderModelKey("totally-unknown")).toBe("totally-unknown");
    expect(resolveQoderModelKey("")).toBe("");
    expect(resolveQoderModelKey(null)).toBe("");
  });
});
