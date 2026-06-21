/**
 * Unit tests for the Z.ai ZCode free-tier provider (issue #1927).
 *
 * Covers:
 *  - Registry entry shape (id, alias, category, transport)
 *  - PROVIDER_MODELS registration and model list
 *  - PROVIDERS transport config
 *  - No alias collision with glm / glm-cn
 *  - Pricing override ($0 for free-tier models)
 *  - DefaultExecutor handles OpenAI-compatible requests (no custom executor needed)
 */
import { describe, it, expect } from "vitest";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getExecutor, DefaultExecutor } from "../../open-sse/executors/index.js";

const ZAI_ALIAS = "zai";
const ZAI_ID    = "zai";

describe("Z.ai ZCode provider — registry shape", () => {
  it("registers a transport entry for id 'zai'", () => {
    expect(PROVIDERS[ZAI_ID]).toBeDefined();
  });

  it("uses the ZCode OpenAI-compatible base URL", () => {
    expect(PROVIDERS[ZAI_ID].baseUrl).toBe("https://zcode.z.ai/api/v1/chat/completions");
  });

  it("defaults to OpenAI format (no explicit format or format='openai')", () => {
    const fmt = PROVIDERS[ZAI_ID].format;
    expect(fmt === "openai" || fmt === undefined).toBe(true);
  });
});

describe("Z.ai ZCode provider — model catalog", () => {
  it("exposes models under alias 'zai'", () => {
    expect(PROVIDER_MODELS[ZAI_ALIAS]).toBeDefined();
    expect(Array.isArray(PROVIDER_MODELS[ZAI_ALIAS])).toBe(true);
    expect(PROVIDER_MODELS[ZAI_ALIAS].length).toBeGreaterThan(0);
  });

  it("includes glm-5-turbo as the first (default) model", () => {
    const ids = PROVIDER_MODELS[ZAI_ALIAS].map(m => m.id);
    expect(ids[0]).toBe("glm-5-turbo");
  });

  it("includes glm-5.2 and glm-4.5-air", () => {
    const ids = PROVIDER_MODELS[ZAI_ALIAS].map(m => m.id);
    expect(ids).toContain("glm-5.2");
    expect(ids).toContain("glm-4.5-air");
  });

  it("maps provider id 'zai' → alias 'zai'", () => {
    expect(PROVIDER_ID_TO_ALIAS[ZAI_ID]).toBe(ZAI_ALIAS);
  });
});

describe("Z.ai ZCode provider — no alias collision", () => {
  it("GLM (glm alias) remains unchanged", () => {
    const glmModels = PROVIDER_MODELS["glm"];
    expect(glmModels).toBeDefined();
    // GLM Coding uses Anthropic-format transport, not OAI-compatible
    expect(PROVIDERS["glm"]?.baseUrl).toContain("api.z.ai/api/anthropic");
  });

  it("GLM-CN (glm-cn alias) remains unchanged", () => {
    const glmCnModels = PROVIDER_MODELS["glm-cn"];
    expect(glmCnModels).toBeDefined();
    expect(PROVIDERS["glm-cn"]?.baseUrl).toContain("open.bigmodel.cn");
  });

  it("zai alias is distinct from glm and glm-cn", () => {
    expect(ZAI_ALIAS).not.toBe("glm");
    expect(ZAI_ALIAS).not.toBe("glm-cn");
    // Models under zai are independent
    expect(PROVIDER_MODELS[ZAI_ALIAS]).not.toBe(PROVIDER_MODELS["glm"]);
    expect(PROVIDER_MODELS[ZAI_ALIAS]).not.toBe(PROVIDER_MODELS["glm-cn"]);
  });
});

describe("Z.ai ZCode provider — free-tier pricing ($0)", () => {
  it("resolves $0 input pricing for glm-5-turbo via zai", () => {
    const p = getPricingForModel(ZAI_ALIAS, "glm-5-turbo");
    expect(p).not.toBeNull();
    expect(p.input).toBe(0);
    expect(p.output).toBe(0);
  });

  it("resolves $0 pricing for glm-5.2 via zai", () => {
    const p = getPricingForModel(ZAI_ALIAS, "glm-5.2");
    expect(p).not.toBeNull();
    expect(p.input).toBe(0);
    expect(p.output).toBe(0);
  });

  it("resolves $0 pricing for glm-4.5-air via zai", () => {
    const p = getPricingForModel(ZAI_ALIAS, "glm-4.5-air");
    expect(p).not.toBeNull();
    expect(p.input).toBe(0);
    expect(p.output).toBe(0);
  });

  it("GLM provider's glm-5.2 retains standard (non-zero) pricing", () => {
    const p = getPricingForModel("glm", "glm-5.2");
    // Not in PROVIDER_PRICING["glm"], falls through to MODEL_PRICING / PATTERN_PRICING
    expect(p).not.toBeNull();
    expect(p.input).toBeGreaterThan(0);
  });
});

describe("Z.ai ZCode provider — executor routing", () => {
  it("uses DefaultExecutor (no custom executor registered for zai)", () => {
    const exec = getExecutor(ZAI_ID);
    expect(exec).toBeInstanceOf(DefaultExecutor);
  });
});
