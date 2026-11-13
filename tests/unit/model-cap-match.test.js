import { describe, expect, it } from "vitest";
import { modelSupportsCap } from "../../src/shared/utils/modelCapMatch.js";

// The capacity-adapter picker (ModelSelectModal, capFilter without kindFilter)
// admits a model when its chat caps declare the modality OR its registered
// model kind maps to it — groq/whisper-* carries kind "stt" and no chat entry,
// which is what left the Audio adapter picker empty for every provider (#4638).

describe("modelSupportsCap", () => {
  it("accepts a typed registry model through its kind (stt → audioInput)", () => {
    expect(modelSupportsCap("audioInput", null, "stt")).toBe(true);
    expect(modelSupportsCap("audioInput", { audioInput: false }, "stt")).toBe(true);
  });

  it("accepts a multimodal chat model through its capabilities", () => {
    expect(modelSupportsCap("audioInput", { audioInput: true }, "llm")).toBe(true);
    expect(modelSupportsCap("vision", { vision: true }, null)).toBe(true);
  });

  it("rejects kinds that map to a different modality", () => {
    // tts is audio OUTPUT, not input
    expect(modelSupportsCap("audioInput", null, "tts")).toBe(false);
    // image models produce images, they do not consume vision
    expect(modelSupportsCap("vision", null, "image")).toBe(false);
  });

  it("keeps imageToText models eligible for the Vision adapter", () => {
    expect(modelSupportsCap("vision", null, "imageToText")).toBe(true);
  });

  it("rejects an untyped model without supporting capabilities", () => {
    expect(modelSupportsCap("audioInput", null, null)).toBe(false);
    expect(modelSupportsCap("audioInput", {}, "llm")).toBe(false);
    expect(modelSupportsCap("audioInput", { vision: true }, "llm")).toBe(false);
  });

  it("has nothing to say without a filter", () => {
    expect(modelSupportsCap(null, null, null)).toBe(true);
    expect(modelSupportsCap(undefined, {}, "llm")).toBe(true);
  });
});
