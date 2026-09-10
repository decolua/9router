// Ox Alpha capability + effort handling — registry-independent unit tests.
// Only exercises capabilities.js / thinkingLevels.js / thinkingUnified.js /
// modality.js real functions; does NOT depend on provider registry entries
// (models are registered by separate PRs #3447 / #3451).
import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const FREE_ID = "x-preview-f-free";
const GO_ID = "ox-alpha-free";
const OX_PAIRS = [
  ["opencode", FREE_ID],
  ["oc", FREE_ID],
  ["opencode-go", GO_ID],
  ["ocg", GO_ID],
];

describe("Ox Alpha capability entries (provider-scoped)", () => {
  it.each(OX_PAIRS)("caps %s/%s report image+reasoning low/high/max", (provider, model) => {
    const caps = getCapabilitiesForModel(provider, model);
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai-low-high-max");
    expect(caps.thinkingCanDisable).toBe(false);
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(131072);
    expect(caps.videoInput).toBe(false);
  });

  it("bare ids without a provider keep default (no vision)", () => {
    expect(getCapabilitiesForModel(null, FREE_ID).vision).toBe(false);
    expect(getCapabilitiesForModel(null, GO_ID).vision).toBe(false);
    expect(getCapabilitiesForModel(undefined, FREE_ID).thinkingFormat === "openai-low-high-max").toBe(false);
  });

  it("mismatched providers do not pick up Ox Alpha format", () => {
    expect(getCapabilitiesForModel("nvidia", FREE_ID).vision).toBe(false);
    expect(getCapabilitiesForModel("nvidia", GO_ID).vision).toBe(false);
    expect(getCapabilitiesForModel("openai", FREE_ID).thinkingFormat).not.toBe("openai-low-high-max");
    expect(getCapabilitiesForModel("kiro", GO_ID).thinkingFormat).not.toBe("openai-low-high-max");
  });

  it("suffix '(max)' resolves to identical caps for all 4 pairs", () => {
    for (const [provider, model] of OX_PAIRS) {
      expect(getCapabilitiesForModel(provider, `${model}(max)`)).toEqual(getCapabilitiesForModel(provider, model));
    }
  });

  it("numeric suffix '(8192)' resolves to identical caps", () => {
    expect(getCapabilitiesForModel("ocg", `${GO_ID}(8192)`)).toEqual(getCapabilitiesForModel("ocg", GO_ID));
  });

  it("generic claude-sonnet-4.6(max) equals its base caps (existing behavior kept)", () => {
    expect(getCapabilitiesForModel(null, "claude-sonnet-4.6(max)")).toEqual(getCapabilitiesForModel(null, "claude-sonnet-4.6"));
  });
});

describe("Ox Alpha thinking levels", () => {
  it.each(OX_PAIRS)("levels %s/%s are exactly low/high/max", (provider, model) => {
    expect(getThinkingLevels(provider, model)).toEqual(["low", "high", "max"]);
  });
});

describe("Ox Alpha effort mapping (openai-low-high-max)", () => {
  const apply = (body, provider, model) => {
    const b = JSON.parse(JSON.stringify(body));
    applyThinking(FORMATS.OPENAI, model, b, provider);
    return b;
  };

  it.each([
    ["low", "low"],
    ["minimal", "low"],
    ["none", "low"],
  ])("maps %s -> low (cannot disable, clamped)", (input, expected) => {
    expect(apply({ reasoning_effort: input }, "opencode", FREE_ID).reasoning_effort).toBe(expected);
  });

  it.each([
    ["medium", "high"],
    ["high", "high"],
  ])("maps %s -> high", (input, expected) => {
    expect(apply({ reasoning_effort: input }, "oc", FREE_ID).reasoning_effort).toBe(expected);
  });

  it.each([
    ["xhigh", "max"],
    ["max", "max"],
    ["ultra", "max"],
  ])("maps %s -> max", (input, expected) => {
    expect(apply({ reasoning_effort: input }, "opencode-go", GO_ID).reasoning_effort).toBe(expected);
  });

  it("auto omits reasoning_effort (upstream default applies)", () => {
    expect(apply({ reasoning_effort: "auto" }, "ocg", GO_ID).reasoning_effort).toBeUndefined();
  });

  it("unknown level omits reasoning_effort", () => {
    expect(apply({ reasoning_effort: "banana" }, "opencode", FREE_ID).reasoning_effort).toBeUndefined();
  });

  it("suffix (8192) -> high via budgetToLevel", () => {
    expect(apply({}, "oc", `${FREE_ID}(8192)`).reasoning_effort).toBe("high");
  });

  it("generic gpt-5 max remains xhigh (existing openai clamp unchanged)", () => {
    expect(apply({ reasoning_effort: "max" }, "openai", "gpt-5").reasoning_effort).toBe("xhigh");
  });
});

describe("Ox Alpha suffixed lookup keeps OpenAI image_url", () => {
  it("suffixed ocg caps preserve image_url through stripUnsupportedModalities", () => {
    const body = {
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "what is in this picture?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
        ],
      }],
    };
    const caps = getCapabilitiesForModel("ocg", `${GO_ID}(max)`);
    expect(caps.vision).toBe(true);
    expect(caps.videoInput).toBe(false);
    stripUnsupportedModalities(body, FORMATS.OPENAI, caps);
    expect(body.messages[0].content.some((b) => b.type === "image_url")).toBe(true);
    expect(body.messages[0].content.some((b) => /image omitted/.test(b.text || ""))).toBe(false);
  });
});
