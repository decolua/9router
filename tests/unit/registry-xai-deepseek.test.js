import { describe, expect, it } from "vitest";

// FED-023: registries refreshed against the live OpenRouter catalog
// (fetched 2026-08-22). These tests pin the live IDs so a future stale
// registry edit fails loudly instead of silently dropping models.
import xaiEntry from "../../open-sse/providers/registry/xai.js";
import deepseekEntry from "../../open-sse/providers/registry/deepseek.js";

describe("xai registry entry (live catalog refresh)", () => {
  it("includes the current live xAI model IDs", () => {
    const ids = xaiEntry.models.map((m) => m.id);
    for (const live of [
      "grok-4.20",
      "grok-4.20-multi-agent",
      "grok-4.6",
      "grok-4.5",
      "grok-4.3",
      "grok-build-0.1",
    ]) {
      expect(ids).toContain(live);
    }
  });

  it("keeps the existing xAI entries (incl. image/video kinds)", () => {
    const ids = xaiEntry.models.map((m) => m.id);
    for (const keep of [
      "grok-4",
      "grok-4-fast-reasoning",
      "grok-code-fast-1",
      "grok-3",
      "grok-2-image-1212",
      "grok-imagine-video",
    ]) {
      expect(ids).toContain(keep);
    }
    expect(xaiEntry.models.find((m) => m.id === "grok-2-image-1212").kind).toBe("image");
    expect(xaiEntry.models.find((m) => m.id === "grok-imagine-video").kind).toBe("video");
  });

  it("points searchViaChat.defaultModel at a live catalog model", () => {
    const dm = xaiEntry.searchViaChat.defaultModel;
    expect(dm).not.toBe("grok-4.20-reasoning");
    expect(xaiEntry.models.map((m) => m.id)).toContain(dm);
  });
});

describe("deepseek registry entry (live catalog refresh)", () => {
  it("includes the current live DeepSeek model IDs (dated pins + vision variant)", () => {
    const ids = deepseekEntry.models.map((m) => m.id);
    for (const live of [
      "deepseek-v4-flash-0731",
      "deepseek-v4-pro-0813",
      "deepseek-v4-flash-vision-exp",
    ]) {
      expect(ids).toContain(live);
    }
  });

  it("keeps the existing DeepSeek entries incl. internal aliases", () => {
    const ids = deepseekEntry.models.map((m) => m.id);
    for (const keep of [
      "deepseek-v4-pro",
      "deepseek-v4-pro-max",
      "deepseek-v4-pro-none",
      "deepseek-v4-flash",
      "deepseek-chat",
      "deepseek-reasoner",
    ]) {
      expect(ids).toContain(keep);
    }
    // Internal aliases must keep their upstream mapping (not real API IDs).
    expect(deepseekEntry.models.find((m) => m.id === "deepseek-v4-pro-max").upstreamModelId).toBe(
      "deepseek-v4-pro",
    );
    expect(deepseekEntry.models.find((m) => m.id === "deepseek-v4-pro-none").upstreamModelId).toBe(
      "deepseek-v4-pro",
    );
  });
});
