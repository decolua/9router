import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { applyThinking, stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";
import antigravity from "../../open-sse/providers/registry/antigravity.js";
import geminiCli from "../../open-sse/providers/registry/gemini-cli.js";
import gemini from "../../open-sse/providers/registry/gemini.js";
import { MODEL_PRICING } from "../../open-sse/providers/pricing.js";
import {
  getProjectIdForConnection,
  removeConnection,
} from "../../open-sse/services/projectId.js";

const require = createRequire(import.meta.url);
const mitmConfig = require("../../src/mitm/config.js");
const here = dirname(fileURLToPath(import.meta.url));

function cloudCodeResponse(projectId) {
  return {
    ok: true,
    json: async () => ({ cloudaicompanionProject: { id: projectId } }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Gemini Cloud Code endpoint isolation", () => {
  it("keeps Gemini CLI on the official cloudcode host", async () => {
    const connectionId = "gemini-cli-endpoint-test";
    const fetchMock = vi.fn(async () => cloudCodeResponse("gemini-project"));
    vi.stubGlobal("fetch", fetchMock);

    await getProjectIdForConnection(connectionId, "token", "gemini-cli");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      expect.objectContaining({ method: "POST" })
    );
    expect(geminiCli.transport.baseUrl).toBe("https://cloudcode-pa.googleapis.com/v1internal");
    removeConnection(connectionId);
  });

  it("uses the prod cloudcode host for Antigravity discovery but daily for chat", async () => {
    const connectionId = "antigravity-endpoint-test";
    const fetchMock = vi.fn(async () => cloudCodeResponse("antigravity-project"));
    vi.stubGlobal("fetch", fetchMock);

    await getProjectIdForConnection(connectionId, "token", "antigravity");

    // Discovery (loadCodeAssist) on PROD — daily host rejects auth/onboarding calls.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      expect.objectContaining({ method: "POST" })
    );
    // Chat transport still uses the daily host to bypass prod 429.
    expect(antigravity.transport.baseUrls).toEqual(["https://daily-cloudcode-pa.googleapis.com"]);
    removeConnection(connectionId);
  });
});

describe("Gemini 3.6 Antigravity tiers", () => {
  it.each(["high", "medium", "low"])(
    "maps the %s tier to the shared upstream model with matching thinking level",
    (tier) => {
      const publicModel = `gemini-3.6-flash-${tier}`;
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

      expect(upstreamModel).toBe(`gemini-3.6-flash-tiered(${tier})`);
      expect(finalBody.model).toBe("gemini-3.6-flash-tiered");
      expect(finalBody.request.generationConfig.thinkingConfig).toEqual({
        thinkingLevel: tier,
        includeThoughts: true,
      });
    }
  );
});

describe("Gemini 3.6 MITM model extraction", () => {
  it("exports the model extractor from the side-effect-free MITM config module", () => {
    expect(mitmConfig.extractModel).toBeTypeOf("function");
  });

  it.each(["high", "medium", "low"])("extracts the %s thinking tier", (tier) => {
    const body = Buffer.from(JSON.stringify({
      request: { generationConfig: { thinkingConfig: { thinkingLevel: tier } } },
    }));

    expect(mitmConfig.extractModel(
      "/v1internal/models/gemini-3.6-flash-tiered:streamGenerateContent",
      body
    )).toBe(`gemini-3.6-flash-${tier}`);
  });

  it("defaults invalid or missing thinking levels to medium", () => {
    const body = Buffer.from(JSON.stringify({
      request: { generationConfig: { thinkingConfig: { thinkingLevel: "unknown" } } },
    }));

    expect(mitmConfig.extractModel(
      "/v1internal/models/gemini-3.6-flash-tiered:streamGenerateContent",
      body
    )).toBe("gemini-3.6-flash-medium");
  });
});

describe("Gemini 3.6 catalogs and pricing", () => {
  it("exposes the direct Gemini API models and their pricing", () => {
    const ids = gemini.models.map((model) => model.id);
    expect(ids).toContain("gemini-3.6-flash");
    expect(ids).toContain("gemini-3.5-flash-lite");
    expect(MODEL_PRICING["gemini-3.6-flash"]).toMatchObject({ input: 1.5, output: 7.5 });
    expect(MODEL_PRICING["gemini-3.5-flash-lite"]).toMatchObject({ input: 0.3, output: 2.5 });
  });

  it("keeps the standalone CLI Gemini catalog synchronized", () => {
    const source = readFileSync(join(here, "../../cli/src/cli/menus/providers.js"), "utf8");
    const geminiCatalog = source.match(/\n  gemini: \[([\s\S]*?)\n  \],/)?.[1] || "";

    expect(geminiCatalog).toContain("gemini-3.6-flash");
    expect(geminiCatalog).toContain("gemini-3.5-flash-lite");
  });
});
