// The dashboard shows the registry's `name`, so a stale name is what a user
// sees on the model card. These are the labels Qoder itself publishes in
// /algo/api/v2/model/list, captured live 2026-11-05; the registry used to carry
// older guesses (DeepSeek-V4-Flash, Kimi-K3, Kimi-K2.7-Code, MiniMax-M3).
import { describe, expect, it } from "vitest";
import qoderRegistry from "../../open-sse/providers/registry/qoder.js";
import { QODER_STATIC_MODEL_CONFIGS } from "../../open-sse/shared/qoder/constants.js";

const UPSTREAM_LABELS = {
  dmodel: "DeepSeek-V4-Pro",
  // Qoder calls this plain "DeepSeek-Flash"; it is a COSY-only key — the IDE
  // surface answers invalid_model_error for it.
  dfmodel: "DeepSeek-Flash",
  kmodel_latest: "Kimi-K3.1-Pro",
  kmodel: "Kimi-K2.8-Preview",
  mmodel: "MiniMax-M3.1-Flash",
  gmodel: "GLM-5.3",
  gfmodel: "GLM-5.3-Flash",
  qmodel_38max: "Qwen3.8-Max",
  // Slot keys Qoder recycles — live labels captured from ide-text v1.0.357
  // (2026-11-11): qmodel_latest = Qwen4-Max-Preview (enable:false, usable),
  // qmodel_preview = Qwen3.8-Max-Preview. See registry/qoder.js.
  qmodel_latest: "Qwen4-Max-Preview",
  qmodel_preview: "Qwen3.8-Max-Preview",
  qfmodel: "Qwen3.8-Flash",
  smodel: "Sonus",
  cmodel: "Cantus",
};

describe("qoder registry labels", () => {
  const byId = Object.fromEntries((qoderRegistry.models || []).map((m) => [m.id, m.name]));

  it("match the labels Qoder publishes", () => {
    for (const [id, label] of Object.entries(UPSTREAM_LABELS)) {
      expect(byId[id], id).toBe(label);
    }
  });

  it("agree with the static roster's display names", () => {
    for (const [id, label] of Object.entries(UPSTREAM_LABELS)) {
      const staticConfig = QODER_STATIC_MODEL_CONFIGS[id];
      if (!staticConfig) continue;
      expect(staticConfig.display_name, id).toBe(label);
    }
  });
});
