import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { applyThinking, stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";
import gemini from "../../open-sse/providers/registry/gemini.js";
import { MODEL_PRICING } from "../../open-sse/providers/pricing.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

const require = createRequire(import.meta.url);
const mitmConfig = require("../../src/mitm/config.js");
const here = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Gemini 3.8 Antigravity tiers", () => {
  it.each(["high", "medium", "low"])(
    "maps the %s tier to the shared upstream model with matching thinking level",
    (tier) => {
      const publicModel = `gemini-3.8-flash-${tier}`;
      const upstreamModel = getModelUpstreamId("ag", publicModel);
      const body = {
        model: stripThinkingSuffix(upstreamModel),
        request: {
          contents: [{ role: "user", parts: [{ text: "hello" }] }],
          generationConfig: {},
        },
      };

      applyThinking("antigravity", upstreamModel, body, "antigravity");
      const finalBody = new AntigravityExecutor().transformRequest(
        publicModel,
        body,
        true,
        { projectId: "project", connectionId: "connection" }
      );

      expect(upstreamModel).toBe(`gemini-3.8-flash-tiered(${tier})`);
      expect(finalBody.model).toBe("gemini-3.8-flash-tiered");
      expect(finalBody.request.generationConfig.thinkingConfig).toEqual({
        thinkingLevel: tier,
        includeThoughts: true,
      });
    }
  );
});

describe("Gemini 3.8 MITM model extraction", () => {
  it.each(["high", "medium", "low"])("extracts the %s thinking tier for gemini-3.8-flash-tiered", (tier) => {
    const body = Buffer.from(JSON.stringify({
      request: { generationConfig: { thinkingConfig: { thinkingLevel: tier } } },
    }));

    expect(mitmConfig.extractModel(
      "/v1internal/models/gemini-3.8-flash-tiered:streamGenerateContent",
      body
    )).toBe(`gemini-3.8-flash-${tier}`);
  });

  it("defaults invalid or missing thinking levels to medium", () => {
    const body = Buffer.from(JSON.stringify({
      request: { generationConfig: { thinkingConfig: { thinkingLevel: "unknown" } } },
    }));

    expect(mitmConfig.extractModel(
      "/v1internal/models/gemini-3.8-flash-tiered:streamGenerateContent",
      body
    )).toBe("gemini-3.8-flash-medium");
  });
});

describe("Gemini 3.8 MITM tools and catalog", () => {
  it("includes gemini-3.8-flash tiers in MITM_TOOLS defaultModels", () => {
    const defaultModelIds = MITM_TOOLS.antigravity.defaultModels.map((m) => m.id);
    expect(defaultModelIds).toContain("gemini-3.8-flash-high");
    expect(defaultModelIds).toContain("gemini-3.8-flash-medium");
    expect(defaultModelIds).toContain("gemini-3.8-flash-low");
  });

  it("exposes the direct Gemini 3.8 API models and pricing", () => {
    const ids = gemini.models.map((model) => model.id);
    expect(ids).toContain("gemini-3.8-flash");
    expect(MODEL_PRICING["gemini-3.8-flash"]).toMatchObject({ input: 0.75, output: 3.75, cached: 0.1875 });
  });

  it("keeps the standalone CLI Antigravity catalog synchronized", () => {
    const source = readFileSync(join(here, "../../cli/src/cli/menus/providers.js"), "utf8");
    const agCatalog = source.match(/\n  ag: \[([\s\S]*?)\n  \],/)?.[1] || "";

    expect(agCatalog).toContain("gemini-3.8-flash-high");
    expect(agCatalog).toContain("gemini-3.8-flash-medium");
    expect(agCatalog).toContain("gemini-3.8-flash-low");
  });
});
