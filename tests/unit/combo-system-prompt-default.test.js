// Default identity prompt fallback chain + composed-needle determinism.
// resolveDefaultIdentitySystemPrompt is a pure resolver (no IO).
import { describe, it, expect } from "vitest";
import { resolveDefaultIdentitySystemPrompt, resolveComboSystemPrompt } from "@/sse/services/model.js";
import { DEFAULT_COMBO_IDENTITY_PROMPT } from "open-sse/config/appConstants.js";

describe("resolveDefaultIdentitySystemPrompt — fallback chain", () => {
  it("falls back to the constant when settings is missing/empty/unset", () => {
    expect(resolveDefaultIdentitySystemPrompt()).toBe(DEFAULT_COMBO_IDENTITY_PROMPT);
    expect(resolveDefaultIdentitySystemPrompt(null)).toBe(DEFAULT_COMBO_IDENTITY_PROMPT);
    expect(resolveDefaultIdentitySystemPrompt({})).toBe(DEFAULT_COMBO_IDENTITY_PROMPT);
    expect(resolveDefaultIdentitySystemPrompt({ defaultIdentitySystemPrompt: "" })).toBe(DEFAULT_COMBO_IDENTITY_PROMPT);
    expect(resolveDefaultIdentitySystemPrompt({ defaultIdentitySystemPrompt: "   \n " })).toBe(DEFAULT_COMBO_IDENTITY_PROMPT);
  });

  it("returns a configured non-empty template (un-substituted)", () => {
    const t = "You are {name}, the router.";
    expect(resolveDefaultIdentitySystemPrompt({ defaultIdentitySystemPrompt: `  ${t}  ` })).toBe(t);
  });
});

describe("composed identity prompt — deterministic single needle", () => {
  it("override + explicit custom → exact custom (no default appended)", () => {
    const combo = { name: "n", systemPromptEnabled: true, systemPrompt: "C", systemPromptMode: "override" };
    expect(resolveComboSystemPrompt(combo, "D")).toBe("C");
  });

  it("append + custom + default → stable composed string (same input → same out)", () => {
    const combo = { name: "n", systemPromptEnabled: true, systemPrompt: "C1\nC2", systemPromptMode: "append" };
    const def = "D1\nD2";
    const a = resolveComboSystemPrompt(combo, def);
    const b = resolveComboSystemPrompt(combo, def);
    expect(a).toBe(b);
    // single "\n\n"-joined segment: custom block, blank line, default block
    expect(a).toBe("C1\nC2\n\nD1\nD2");
  });

  it("append + empty custom → default as the whole needle (no leading/trailing gap)", () => {
    const combo = { name: "n", systemPromptEnabled: true, systemPrompt: "", systemPromptMode: "append" };
    expect(resolveComboSystemPrompt(combo, "D")).toBe("D");
  });
});