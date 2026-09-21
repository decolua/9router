import { describe, it, expect } from "vitest";

import {
  discoverOrcaRouterModels,
  filterCatalog,
  ORCAROUTER_API_BASE_DEFAULT,
  ORCAROUTER_CATALOG_PATH,
} from "../../open-sse/providers/orcarouterCatalog.js";

/**
 * Live gate: exercises the real OrcaRouter relay through the same provider code
 * path the application uses. Requires ORCAROUTER_API_KEY; this is deliberate —
 * a silent skip would let a broken integration pass as green.
 *
 * No credential value is ever asserted into a message, and no response body is
 * printed, so a failure cannot leak the key.
 */
const apiKey = process.env.ORCAROUTER_API_KEY;

describe("orcarouter live catalog", () => {
  it("requires a key so the live path cannot silently no-op", () => {
    expect(
      Boolean(apiKey),
      "ORCAROUTER_API_KEY must be set for the live check to run"
    ).toBe(true);
  });

  it("discovers the account's live chat catalog from the inference origin", async () => {
    const result = await discoverOrcaRouterModels({ apiKey, capability: "chat" });

    expect(result.source).toBe("live");
    expect(result.degraded).toBe(false);
    expect(result.models.length).toBeGreaterThan(0);

    // Vendor/model namespaces must survive verbatim.
    for (const model of result.models) {
      expect(model.id).toMatch(/^[^/\s]+\/[^\s]+$/);
    }
  }, 30000);

  it("keeps media-only models out of the text dropdown on real data", async () => {
    const result = await discoverOrcaRouterModels({ apiKey, capability: "chat" });
    const chatIds = new Set(result.models.map((m) => m.id));

    const media = await discoverOrcaRouterModels({ apiKey, capability: "image" });
    const mediaIds = media.models
      .map((m) => m.id)
      .filter((id) => !id.includes("seed"));

    // A model advertised for image generation must not also be offered as text.
    for (const id of mediaIds) {
      if (chatIds.has(id)) {
        const entry = result.models.find((m) => m.id === id);
        expect(entry.endpointTypes).not.toContain("image-generation");
      }
    }
    expect(Array.isArray(media.models)).toBe(true);
  }, 30000);

  it("narrows the live chat catalog to models that declare image input", async () => {
    const all = await discoverOrcaRouterModels({ apiKey, capability: "chat" });

    const vision = filterCatalog(all.models, { capability: "chat", modality: "image" });

    // Every surviving model must explicitly declare image input (fail closed).
    for (const model of vision) {
      expect(model.inputModalities).toContain("image");
    }
    expect(vision.length).toBeLessThanOrEqual(all.models.length);
  }, 30000);

  it("never returns the key or an auth header inside the catalog payload", async () => {
    const result = await discoverOrcaRouterModels({ apiKey, capability: "chat" });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain(apiKey);
  }, 30000);

  it("uses only the configured inference origin, never the auth origin", () => {
    expect(ORCAROUTER_API_BASE_DEFAULT).toBe("https://api.orcarouter.ai");
    expect(ORCAROUTER_CATALOG_PATH).toBe("/v1/models");
    expect(`${ORCAROUTER_API_BASE_DEFAULT}${ORCAROUTER_CATALOG_PATH}`).toBe(
      "https://api.orcarouter.ai/v1/models"
    );
  });
});
