import { describe, it, expect } from "vitest";
import { resolveComboSystemPrompt } from "@/sse/services/model.js";
import { DEFAULT_COMBO_IDENTITY_PROMPT } from "open-sse/config/appConstants.js";

describe("resolveComboSystemPrompt", () => {
  it("returns null when disabled", () => {
    expect(resolveComboSystemPrompt({ name: "my-combo", models: ["oc/x"] })).toBeNull();
    expect(resolveComboSystemPrompt({ name: "my-combo", models: ["oc/x"], systemPromptEnabled: false })).toBeNull();
  });

  it("returns null for media combos (kind set) even when enabled", () => {
    expect(resolveComboSystemPrompt({ name: "tts-combo", kind: "tts", models: ["oc/x"], systemPromptEnabled: true })).toBeNull();
  });

  it("returns null for missing combo", () => {
    expect(resolveComboSystemPrompt(null)).toBeNull();
  });

  it("uses the default template with {name} substituted when no custom text", () => {
    const out = resolveComboSystemPrompt({ name: "my-combo", models: ["oc/x"], systemPromptEnabled: true, systemPrompt: "" });
    expect(out).toBe(DEFAULT_COMBO_IDENTITY_PROMPT.replaceAll("{name}", "my-combo"));
    expect(out.startsWith("You are my-combo.")).toBe(true);
  });

  it("uses custom text when provided", () => {
    const out = resolveComboSystemPrompt({ name: "my-combo", models: ["oc/x"], systemPromptEnabled: true, systemPrompt: "Answer as {name}, the router." });
    expect(out).toBe("Answer as my-combo, the router.");
  });

  it("trims and collapses empty custom text to the default", () => {
    const out = resolveComboSystemPrompt({ name: "my-combo", models: ["oc/x"], systemPromptEnabled: true, systemPrompt: "   \n\t " });
    expect(out).toBe(DEFAULT_COMBO_IDENTITY_PROMPT.replaceAll("{name}", "my-combo"));
  });
});
