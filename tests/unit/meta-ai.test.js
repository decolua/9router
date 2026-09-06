import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { MetaExecutor, parseMetaSuffix } from "../../open-sse/executors/meta.js";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";

describe("meta registry", () => {
  it("is registered with the OpenAI-compatible base URL", () => {
    expect(PROVIDERS["meta"]).toBeTruthy();
    expect(PROVIDERS["meta"].baseUrl).toBe("https://api.meta.ai/v1/chat/completions");
    expect(PROVIDERS["meta"].thinkingFormat).toBe("meta");
  });

  it("targets Muse Spark to the Responses API (reasoning summary + replay)", () => {
    expect(getModelTargetFormat("meta", "muse-spark-1.3")).toBe(FORMATS.OPENAI_RESPONSES);
    expect(getModelTargetFormat("meta", "muse-spark-1.3-xhigh")).toBe(FORMATS.OPENAI_RESPONSES);
    expect(getModelTargetFormat("meta", "muse-spark-9.0")).toBe(FORMATS.OPENAI_RESPONSES);
  });

  it("keeps non-Muse Spark Meta models on OpenAI chat completions", () => {
    expect(getModelTargetFormat("meta", "llama-4-maverick")).toBeNull();
  });
});

describe("meta capabilities", () => {
  const models = ["muse-spark-1.1", "muse-spark-1.2", "muse-spark-1.2-contributor", "muse-spark-1.3", "muse-spark-1.3-contributor"];

  it.each(models)("%s reasons and cannot disable thinking", (model) => {
    const caps = getCapabilitiesForModel("meta", model);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("meta");
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("resolves a dash-suffixed id to the meta format too", () => {
    for (const id of ["muse-spark-1.3-xhigh", "muse-spark-1.3-high", "meta/muse-spark-1.2(xhigh)", "muse-spark-9.0-high"]) {
      const caps = getCapabilitiesForModel("meta", id);
      expect(caps.reasoning).toBe(true);
      expect(caps.thinkingFormat).toBe("meta");
      expect(caps.thinkingCanDisable).toBe(false);
    }
  });

  it("does not leak the meta format into the opencode provider", () => {
    expect(getCapabilitiesForModel("opencode", "muse-spark-1.3-contributor-free").thinkingFormat).toBe("openai");
  });

  it("exposes minimal/low/medium/high/xhigh levels (no none, no max)", () => {
    for (const model of models) {
      expect(getThinkingLevels("meta", model)).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
    }
  });
});

describe("meta thinking mapping", () => {
  it("passes supported levels through", () => {
    for (const level of ["minimal", "low", "medium", "high", "xhigh"]) {
      const body = {};
      applyThinking(FORMATS.OPENAI, "muse-spark-1.3", body, "meta", { mode: "level", level });
      expect(body.reasoning_effort).toBe(level);
    }
  });

  it("clamps max to xhigh (Muse Spark has no max)", () => {
    const body = {};
    applyThinking(FORMATS.OPENAI, "muse-spark-1.3", body, "meta", { mode: "level", level: "max" });
    expect(body.reasoning_effort).toBe("xhigh");
  });

  it("omits reasoning_effort for a literal none level (upstream rejects none)", () => {
    const body = {};
    applyThinking(FORMATS.OPENAI, "muse-spark-1.3", body, "meta", { mode: "level", level: "none" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("clamps the none mode to minimal (cannot disable thinking)", () => {
    const body = {};
    applyThinking(FORMATS.OPENAI, "muse-spark-1.3", body, "meta", { mode: "none" });
    expect(body.reasoning_effort).toBe("minimal");
  });
});

describe("meta model-id reasoning suffix", () => {
  it("parses a dash suffix into base + level", () => {
    expect(parseMetaSuffix("muse-spark-1.3-xhigh")).toEqual({ base: "muse-spark-1.3", level: "xhigh" });
    expect(parseMetaSuffix("muse-spark-1.3-high")).toEqual({ base: "muse-spark-1.3", level: "high" });
    expect(parseMetaSuffix("muse-spark-1.3")).toEqual({ base: "muse-spark-1.3", level: null });
  });

  it("still accepts the parenthesized form as a fallback", () => {
    expect(parseMetaSuffix("muse-spark-1.3(xhigh)")).toEqual({ base: "muse-spark-1.3", level: "xhigh" });
  });

  it("routes Muse Spark to the Responses endpoint and non-Muse models to chat completions", () => {
    const ex = new MetaExecutor();
    expect(ex.buildUrl("muse-spark-1.3", true)).toBe("https://api.meta.ai/v1/responses");
    expect(ex.buildUrl("muse-spark-1.3-xhigh", true)).toBe("https://api.meta.ai/v1/responses");
    expect(ex.buildUrl("llama-4-maverick", true)).toBe("https://api.meta.ai/v1/chat/completions");
  });

  it("renders Responses reasoning+summary from the dash suffix", () => {
    const body = { model: "muse-spark-1.3-xhigh", messages: [{ role: "user", content: "hi" }], max_tokens: 4096 };
    const out = new MetaExecutor().transformRequest("muse-spark-1.3-xhigh", body, true, {});
    expect(out.model).toBe("muse-spark-1.3");
    expect(out.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(out.max_output_tokens).toBe(4096);
    expect(out.max_tokens).toBeUndefined();
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("clamps a (max) dash suffix to xhigh", () => {
    const body = { model: "muse-spark-1.3-max", messages: [] };
    const out = new MetaExecutor().transformRequest("muse-spark-1.3-max", body, true, {});
    expect(out.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(out.model).toBe("muse-spark-1.3");
  });

  it("moves a body-level reasoning_effort into Responses reasoning (summary auto)", () => {
    const body = { model: "muse-spark-1.3", reasoning_effort: "high", messages: [] };
    const out = new MetaExecutor().transformRequest("muse-spark-1.3", body, true, {});
    expect(out.model).toBe("muse-spark-1.3");
    expect(out.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("omits reasoning entirely for a none effort (upstream rejects none)", () => {
    const body = { model: "muse-spark-1.3", reasoning_effort: "none", messages: [] };
    const out = new MetaExecutor().transformRequest("muse-spark-1.3", body, true, {});
    expect(out.reasoning).toBeUndefined();
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("translates a Chat Completions request into a Responses request end-to-end", () => {
    const body = {
      model: "meta/muse-spark-1.3",
      messages: [{ role: "user", content: "Think, then answer: 2 + 2?" }],
      reasoning_effort: "high",
      max_tokens: 2048,
    };

    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "muse-spark-1.3",
      body,
      true,
      {},
      "meta",
    );
    const out = new MetaExecutor().transformRequest("muse-spark-1.3", translated, true, {});

    expect(out.model).toBe("muse-spark-1.3");
    expect(Array.isArray(out.input)).toBe(true);
    expect(out.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.max_output_tokens).toBe(2048);
    expect(out.max_tokens).toBeUndefined();
    expect(out.instructions).toBeDefined();
  });
});
