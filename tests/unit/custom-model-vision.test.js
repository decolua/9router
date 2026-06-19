// Unit tests for A6: custom-model vision override + modality stripping + M3 vision.
import { describe, it, expect, beforeEach } from "vitest";
import {
  getCapabilitiesForModel,
  setCustomModelCapabilities,
} from "../../open-sse/providers/capabilities.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("A6: custom-model vision override + M3 (#1904)", () => {
  beforeEach(() => {
    setCustomModelCapabilities([]);
  });

  it("getCapabilitiesForModel returns vision:true after override set", () => {
    setCustomModelCapabilities([{ providerAlias: "x", id: "qwen-custom", vision: true }]);
    const caps = getCapabilitiesForModel("x", "qwen-custom");
    expect(caps.vision).toBe(true);
    const bare = getCapabilitiesForModel("", "qwen-custom");
    expect(bare.vision).toBe(true);
  });

  it("override clears on reset (no leak across tests)", () => {
    setCustomModelCapabilities([]);
    const caps = getCapabilitiesForModel("x", "qwen-custom");
    expect(caps.vision).toBeFalsy();
  });

  it("stripUnsupportedModalities keeps image when caps.vision true", () => {
    const body = {
      messages: [
        { role: "user", content: [
          { type: "text", text: "what is this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
        ] },
      ],
    };
    const stripped = stripUnsupportedModalities(body, FORMATS.OPENAI, { vision: true });
    const img = body.messages[0].content.find((c) => c.type === "image_url");
    expect(img).toBeTruthy();
    // returns true if stripped, false otherwise
    expect(stripped).toBe(false);
  });

  it("stripUnsupportedModalities strips image when caps.vision false", () => {
    const body = {
      messages: [
        { role: "user", content: [
          { type: "text", text: "what is this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
        ] },
      ],
    };
    const stripped = stripUnsupportedModalities(body, FORMATS.OPENAI, { vision: false });
    const img = body.messages[0].content.find((c) => c.type === "image_url");
    expect(img).toBeFalsy();
    expect(stripped).toBe(true);
  });

  it("*minimax-m3* pattern yields vision:true (#1863)", () => {
    const caps = getCapabilitiesForModel("minimax", "minimax-m3");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
  });
});
