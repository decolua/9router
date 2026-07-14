import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

// config.js is the CJS MITM bundle module (dependency-isolated for the runtime copy).
const require = createRequire(import.meta.url);
const { MODEL_NO_MAP } = require("../../src/mitm/config.js");
const { applyRequestOverrides } = require("../../src/mitm/handlers/antigravity.js");

// All assertions below are grounded in a live MITM dump capture of Antigravity's
// streamGenerateContent requests (see AI_JOURNAL): the agent loop sends
// `gemini-3.5-flash-low`, tab-autocomplete sends `tab_jump_flash_lite_preview` /
// `tab_flash_lite_preview`.
describe("Antigravity MITM model handling", () => {
  const ag = MITM_TOOLS.antigravity;

  it("flags the out-of-box agent/Default model mandatory", () => {
    expect(ag.defaultModels.find((m) => m.id === "gemini-3.5-flash-low")?.mandatory).toBe(true);
  });

  it("leaves models not proven auto-sent optional", () => {
    for (const id of ["gemini-3-flash-agent", "gemini-3.1-pro-low", "claude-sonnet-4-6", "gpt-oss-120b-medium"]) {
      expect(ag.defaultModels.find((m) => m.id === id)?.mandatory).toBeFalsy();
    }
  });

  // Tab-autocomplete is latency-critical inline completion — it must passthrough natively,
  // never get re-routed onto a chat-model mapping by the broad `flash` pattern.
  it.each(["tab_jump_flash_lite_preview", "tab_flash_lite_preview"])(
    "excludes tab-autocomplete model '%s' from re-routing",
    (id) => {
      expect((MODEL_NO_MAP.antigravity || []).some((re) => re.test(id))).toBe(true);
    }
  );

  it("does not exclude real agent models from re-routing", () => {
    for (const id of ["gemini-3.5-flash-low", "gemini-3-flash-agent", "claude-sonnet-4-6"]) {
      expect((MODEL_NO_MAP.antigravity || []).some((re) => re.test(id))).toBe(false);
    }
  });
});


describe("Antigravity MITM request overrides", () => {
  it("overrides model and conflicting native thinking intent immutably", () => {
    const body = {
      model: "gemini-3-flash-agent",
      thinkingConfig: { thinkingBudget: 512 },
      generationConfig: {
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 1024 },
      },
      request: {
        generationConfig: {
          temperature: 0.2,
          thinkingConfig: { thinkingBudget: 8192 },
        },
      },
    };
    const original = structuredClone(body);

    expect(applyRequestOverrides(body, { model: "cx/gpt-5.6-sol", reasoningEffort: "high" })).toEqual({
      model: "cx/gpt-5.6-sol",
      reasoning_effort: "high",
      generationConfig: { maxOutputTokens: 2048 },
      request: { generationConfig: { temperature: 0.2 } },
    });
    expect(body).toEqual(original);
  });

  it("preserves native reasoning intent when effort is Default", () => {
    const body = {
      model: "gemini-3-flash-agent",
      request: { generationConfig: { thinkingConfig: { thinkingBudget: 8192 } } },
    };
    const original = structuredClone(body);

    expect(applyRequestOverrides(body, { model: "cx/gpt-5.6-sol" })).toEqual({
      model: "cx/gpt-5.6-sol",
      request: { generationConfig: { thinkingConfig: { thinkingBudget: 8192 } } },
    });
    expect(body).toEqual(original);
  });

  it("can override reasoning without changing the source model", () => {
    const body = { model: "gemini-3-flash-agent", request: {} };
    expect(applyRequestOverrides(body, { reasoningEffort: "none" })).toEqual({
      model: "gemini-3-flash-agent",
      request: {},
      reasoning_effort: "none",
    });
  });

  it.each(["none", "minimal", "low", "medium", "high", "xhigh", "max"])(
    "passes explicit reasoning effort %s through as reasoning_effort",
    (effort) => {
      expect(applyRequestOverrides({ model: "src" }, { reasoningEffort: effort })).toEqual({
        model: "src",
        reasoning_effort: effort,
      });
    }
  );

  it("leaves the body unchanged for empty overrides", () => {
    const body = { model: "src", thinkingConfig: { thinkingBudget: 1 } };
    expect(applyRequestOverrides(body, {})).toEqual(body);
  });
});
