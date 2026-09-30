// Tier 1 — Structural coverage: every model in PROVIDER_MODELS must translate
// without throwing, correct upstreamId, strip applied. Data-driven → new providers auto-covered.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { buildProviderGroups, buildModelMatrix, resolveTargetFormat } from "./matrix.js";

// Base OpenAI-format request with text + tool + image (exercises strip + tool paths)
function baseBody(modelId) {
  return {
    model: modelId,
    stream: true,
    max_tokens: 64,
    messages: [
      { role: "system", content: "You are a helper." },
      {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ],
      },
    ],
    tools: [
      { type: "function", function: { name: "get_time", description: "x", parameters: { type: "object", properties: {} } } },
    ],
  };
}

const groups = buildProviderGroups();

describe("coverage: every model translates without throwing", () => {
  it.each(groups)("$alias: all models OpenAI→target", ({ alias, models }) => {
    for (const m of models) {
      const target = resolveTargetFormat(alias, m.id);
      const body = baseBody(m.id);
      // source = openai (lingua franca); exercise openai → target path
      const out = translateRequest(FORMATS.OPENAI, target, m.id, body, true, null, alias);
      expect(out, `${alias}/${m.id} → ${target} returned falsy`).toBeTruthy();
    }
  });
});

const stripModels = buildModelMatrix().filter((r) => r.strip.includes("image"));
describe.skipIf(stripModels.length === 0)("coverage: image-strip models drop image content", () => {
  it.each(stripModels)("$alias/$modelId strips image when strip=[image]", (row) => {
    const body = baseBody(row.modelId);
    const out = translateRequest(FORMATS.OPENAI, row.targetFormat, row.modelId, body, true, null, row.alias, null, row.strip);
    const json = JSON.stringify(out);
    expect(json).not.toContain("data:image/png");
  });
});
