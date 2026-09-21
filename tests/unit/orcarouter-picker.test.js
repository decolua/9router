import { describe, it, expect } from "vitest";

import {
  ORCA_PICKER_CAPABILITIES,
  orcaCatalogQuery,
  pruneOrcaSelection,
  orcaCatalogOrigin,
  supportsImageFilter,
} from "@/shared/utils/orcaCatalogPicker.js";
import { ORCAROUTER_CAPABILITIES } from "open-sse/providers/orcarouterCatalog.js";

/**
 * The anchored picker's rules, asserted at the module the component uses.
 *
 * These are the properties a reviewer cannot check by eye: that the option list
 * is a capability-scoped API query (never a hand-written list), that the
 * multimodal slice is fail-closed, and that a selection the new slice no longer
 * offers is dropped instead of silently kept.
 */
describe("orcarouter picker query", () => {
  it("scopes every request to a capability the relay actually serves", () => {
    for (const option of ORCA_PICKER_CAPABILITIES) {
      const query = new URLSearchParams(orcaCatalogQuery({ capability: option.value }));
      expect(query.get("capability")).toBe(option.value);
      // The picker must not invent a capability the catalog module rejects.
      expect(ORCAROUTER_CAPABILITIES).toContain(option.value);
    }
  });

  it("only sends the image modality for the chat slice", () => {
    expect(orcaCatalogQuery({ capability: "chat", imageOnly: true })).toBe("capability=chat&modality=image");
    // A media slice cannot be narrowed by input modality, so no modality is sent.
    expect(orcaCatalogQuery({ capability: "image", imageOnly: true })).toBe("capability=image");
    expect(orcaCatalogQuery({ capability: "embedding", imageOnly: true })).toBe("capability=embedding");
    expect(supportsImageFilter("chat")).toBe(true);
    expect(supportsImageFilter("video")).toBe(false);
  });

  it("omits the modality entirely when the image filter is off", () => {
    expect(orcaCatalogQuery({ capability: "chat", imageOnly: false })).toBe("capability=chat");
  });
});

describe("orcarouter picker stale selection", () => {
  const chatModels = [{ id: "openai/gpt-5.5" }, { id: "deepseek/deepseek-v4-pro" }];
  const visionModels = [{ id: "openai/gpt-5.5" }];

  it("drops a selection the new slice no longer offers", () => {
    // A text-only model must not survive switching the picker to image input.
    expect(pruneOrcaSelection(visionModels, "deepseek/deepseek-v4-pro")).toBeNull();
    expect(pruneOrcaSelection(chatModels, "deepseek/deepseek-v4-pro")).toBe("deepseek/deepseek-v4-pro");
  });

  it("keeps a still-compatible selection and tolerates no selection", () => {
    expect(pruneOrcaSelection(visionModels, "openai/gpt-5.5")).toBe("openai/gpt-5.5");
    expect(pruneOrcaSelection(chatModels, "")).toBeNull();
    expect(pruneOrcaSelection(null, "openai/gpt-5.5")).toBeNull();
  });
});

describe("orcarouter picker catalog origin", () => {
  it("marks a live answer as authoritative", () => {
    const origin = orcaCatalogOrigin({ source: "live", degraded: false, models: [{ id: "a/b" }] });
    expect(origin.live).toBe(true);
    expect(origin.degraded).toBe(false);
  });

  it("labels the verified seed as degraded so it cannot pass for live discovery", () => {
    const origin = orcaCatalogOrigin({ source: "fallback", degraded: true, models: [{ id: "orcarouter/auto" }] });
    expect(origin.live).toBe(false);
    expect(origin.degraded).toBe(true);
    // A cold start still yields selectable options — never a free-text field.
    expect(origin.models.length).toBeGreaterThan(0);
  });

  it("treats a degraded flag as degraded even when the source claims live", () => {
    const origin = orcaCatalogOrigin({ source: "live", degraded: true, models: [] });
    expect(origin.live).toBe(false);
    expect(origin.degraded).toBe(true);
  });
});

describe("orcarouter picker wiring", () => {
  it("renders the catalog through the shared hook, not a component-local copy", async () => {
    const fs = await import("node:fs");
    const url = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const repo = path.resolve(here, "../..");
    const picker = fs.readFileSync(path.join(repo, "src/shared/components/OrcaModelDropdown.js"), "utf8");
    const modal = fs.readFileSync(path.join(repo, "src/shared/components/ModelSelectModal.js"), "utf8");

    // One catalog implementation, two consumers.
    expect(picker).toContain('from "@/shared/hooks/useOrcaRouterCatalog"');
    expect(modal).toContain('from "@/shared/hooks/useOrcaRouterCatalog"');
    // The hook must hit the capability-scoped route; a hand-written model list
    // in the component would defeat the live catalog requirement.
    const hook = fs.readFileSync(path.join(repo, "src/shared/hooks/useOrcaRouterCatalog.js"), "utf8");
    expect(hook).toContain("/api/providers/${connectionId}/models");
    expect(picker).not.toMatch(/models\s*=\s*\[\s*\{/);
  });
});

/**
 * The picker's own query string, driven through the real route handler. This is
 * what makes "the dropdown options come from the API" a checked fact rather
 * than a claim about the component's JSX.
 */
describe("orcarouter picker against the real discovery route", () => {
  it("returns exactly the models the picker asks for, and fails closed on modality", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { vi } = await import("vitest");

    const originalDataDir = process.env.DATA_DIR;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-orca-picker-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();

    const catalog = {
      object: "list",
      success: true,
      data: [
        {
          id: "openai/gpt-5.5",
          name: "GPT-5.5",
          supported_endpoint_types: ["openai"],
          architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        },
        {
          id: "deepseek/deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
          supported_endpoint_types: ["openai"],
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(catalog),
    })));

    try {
      const db = await import("@/lib/db/index.js");
      await db.initDb();
      const repos = await import("@/lib/db/repos/connectionsRepo.js");
      const route = await import("@/app/api/providers/[id]/models/route.js");
      const conn = await repos.createProviderConnection({
        provider: "orcarouter",
        authType: "apikey",
        name: "picker route",
        apiKey: "sk-orca-fake-picker-key",
        accessToken: "sk-orca-fake-picker-key",
      });

      const call = async (query) => {
        const request = new Request(`http://127.0.0.1:20128/api/providers/${conn.id}/models?${query}`);
        const res = await route.GET(request, { params: Promise.resolve({ id: conn.id }) });
        return res.json();
      };

      // The text slice the picker renders by default.
      const chat = await call(orcaCatalogQuery({ capability: "chat" }));
      expect(chat.models.map((m) => m.id)).toEqual(["openai/gpt-5.5", "deepseek/deepseek-v4-pro"]);

      // Toggling the image filter must drop the model that declares no image input.
      const vision = await call(orcaCatalogQuery({ capability: "chat", imageOnly: true }));
      const visionIds = vision.models.map((m) => m.id);
      expect(visionIds).toEqual(["openai/gpt-5.5"]);
      expect(pruneOrcaSelection(vision.models, "deepseek/deepseek-v4-pro")).toBeNull();

      // The key stays server-side; the payload the browser renders carries none.
      expect(JSON.stringify(chat)).not.toContain("sk-orca-fake-picker-key");
    } finally {
      vi.unstubAllGlobals();
      if (originalDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = originalDataDir;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
