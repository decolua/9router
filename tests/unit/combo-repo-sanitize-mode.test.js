// sanitizeComboSystemPromptFields — identity-prompt field sanitizer (pure).
// Verifies: systemPromptMode coercion, merge semantics, and null-safety.
import { describe, it, expect } from "vitest";
import { sanitizeComboSystemPromptFields } from "@/lib/localDb";

describe("sanitizeComboSystemPromptFields — systemPromptMode", () => {
  it("accepts 'append' and 'override' verbatim", () => {
    expect(sanitizeComboSystemPromptFields({ systemPromptMode: "append" })).toEqual({ systemPromptMode: "append" });
    expect(sanitizeComboSystemPromptFields({ systemPromptMode: "override" })).toEqual({ systemPromptMode: "override" });
  });

  it("coerces invalid/empty/non-string mode to 'override' (present = explicit)", () => {
    for (const bad of ["bogus", "", 42, null, undefined, []]) {
      expect(sanitizeComboSystemPromptFields({ systemPromptMode: bad })).toEqual({ systemPromptMode: "override" });
    }
  });

  it("omits the field when absent (merge semantics preserve stored value)", () => {
    expect(sanitizeComboSystemPromptFields({ systemPrompt: "custom" })).toEqual({ systemPrompt: "custom" });
    expect(sanitizeComboSystemPromptFields({ name: "combo" })).toEqual({});
  });

  it("handles non-object/null input without throwing", () => {
    expect(sanitizeComboSystemPromptFields(null)).toEqual({});
    expect(sanitizeComboSystemPromptFields(undefined)).toEqual({});
    expect(sanitizeComboSystemPromptFields("x")).toEqual({});
    expect(sanitizeComboSystemPromptFields(42)).toEqual({});
  });

  it("passes through sibling prompt fields alongside mode", () => {
    const out = sanitizeComboSystemPromptFields({ systemPromptEnabled: true, systemPrompt: "X", systemPromptMode: "append" });
    expect(out).toEqual({ systemPromptEnabled: true, systemPrompt: "X", systemPromptMode: "append" });
  });
});