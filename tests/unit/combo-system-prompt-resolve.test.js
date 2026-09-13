import { describe, it, expect } from "vitest";
import { resolveComboSystemPrompt, resolveDefaultIdentitySystemPrompt } from "@/sse/services/model.js";
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

  it("override mode (default/explicit) uses custom text when provided", () => {
    const combo = { name: "my-combo", models: ["oc/x"], systemPromptEnabled: true, systemPrompt: "Answer as {name}, the router.", systemPromptMode: "override" };
    expect(resolveComboSystemPrompt(combo)).toBe("Answer as my-combo, the router.");
  });

  it("append mode composes custom before the default, {name} substituted in both", () => {
    const combo = { name: "my-combo", models: ["oc/x"], systemPromptEnabled: true, systemPrompt: "Extra persona {name}.", systemPromptMode: "append" };
    const def = "Default {name} identity.";
    const out = resolveComboSystemPrompt(combo, def);
    expect(out).toBe("Extra persona my-combo.\n\nDefault my-combo identity.");
  });

  it("append mode with empty custom collapses to the default only", () => {
    const combo = { name: "my-combo", models: ["oc/x"], systemPromptEnabled: true, systemPrompt: "   ", systemPromptMode: "append" };
    const def = "Default {name} identity.";
    expect(resolveComboSystemPrompt(combo, def)).toBe("Default my-combo identity.");
  });

  it("append mode still returns null for media combos and when disabled", () => {
    const media = { name: "tts-combo", kind: "tts", models: ["oc/x"], systemPromptEnabled: true, systemPromptMode: "append" };
    const off = { name: "my-combo", models: ["oc/x"], systemPromptEnabled: false, systemPromptMode: "append" };
    expect(resolveComboSystemPrompt(media)).toBeNull();
    expect(resolveComboSystemPrompt(off)).toBeNull();
  });

  it("append mode with a configured defaultPrompt but absent/empty falls back to the constant", () => {
    const combo = { name: "my-combo", models: ["oc/x"], systemPromptEnabled: true, systemPrompt: "Custom {name}.", systemPromptMode: "append" };
    const expectedDefault = DEFAULT_COMBO_IDENTITY_PROMPT.replaceAll("{name}", "my-combo");
    const out = resolveComboSystemPrompt(combo, "   ");
    expect(out).toBe(`Custom my-combo.\n\n${expectedDefault}`);
  });

  it("remains usable with a single arg (backward compatibility) and uses the built-in constant", () => {
    const combo = { name: "my-combo", models: ["oc/x"], systemPromptEnabled: true, systemPrompt: "" };
    expect(resolveComboSystemPrompt(combo)).toBe(DEFAULT_COMBO_IDENTITY_PROMPT.replaceAll("{name}", "my-combo"));
  });
});

describe("resolveDefaultIdentitySystemPrompt", () => {
  it("falls back to the built-in constant when unset/empty/whitespace", () => {
    for (const settings of [undefined, {}, { defaultIdentitySystemPrompt: "" }, { defaultIdentitySystemPrompt: "   " }]) {
      expect(resolveDefaultIdentitySystemPrompt(settings)).toBe(DEFAULT_COMBO_IDENTITY_PROMPT);
    }
  });

  it("returns the configured template un-substituted", () => {
    expect(resolveDefaultIdentitySystemPrompt({ defaultIdentitySystemPrompt: "You are {name}, the router." }))
      .toBe("You are {name}, the router.");
  });
});
