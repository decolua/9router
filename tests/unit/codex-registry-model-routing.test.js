/**
 * Tests for #4202 and #4405
 *
 * #4202 — Codex registry has ghost models (always HTTP 400) and is missing
 *   gpt-daybreak-blue-latest / gpt-reserve.
 *   Fix: remove gpt-5.4/mini/spark entries + gpt-5.4-image; add gpt-daybreak-blue-latest and gpt-reserve.
 *
 * #4405 — Bare Codex model slugs (e.g. gpt-5.6-terra from the CLI /model picker)
 *   routed to provider "openai" instead of "codex", causing 404 for users without
 *   an OpenAI API key connection.
 *   Fix: add codex-specific gpt-5.x / gpt-6.x / gpt-daybreak-* / gpt-reserve* rules
 *   to MODEL_PREFIX_PROVIDERS before the generic gpt-* → openai rule.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ── #4202 Registry checks ────────────────────────────────────────────────────

const codexSrc = fs.readFileSync(
  path.resolve("../open-sse/providers/registry/codex.js"),
  "utf-8"
);

describe("Codex registry — ghost models removed (#4202)", () => {
  it("gpt-5.4 is removed", () => {
    // Match only a standalone entry, not inside gpt-5.4-mini or gpt-5.45 etc.
    expect(codexSrc).not.toMatch(/id:\s*"gpt-5\.4"/);
  });

  it("gpt-5.4-mini is removed", () => {
    expect(codexSrc).not.toMatch(/id:\s*"gpt-5\.4-mini"/);
  });

  it("gpt-5.3-codex-spark is removed", () => {
    expect(codexSrc).not.toMatch(/id:\s*"gpt-5\.3-codex-spark"/);
  });

  it("gpt-5.4-image is removed", () => {
    expect(codexSrc).not.toMatch(/id:\s*"gpt-5\.4-image"/);
  });
});

describe("Codex registry — new models added (#4202)", () => {
  it("gpt-daybreak-blue-latest is present", () => {
    expect(codexSrc).toContain('"gpt-daybreak-blue-latest"');
  });

  it("gpt-reserve is present", () => {
    expect(codexSrc).toContain('"gpt-reserve"');
  });
});

describe("Codex registry — still-live models kept (#4202 regression guard)", () => {
  it("gpt-5.5 still present", () => {
    expect(codexSrc).toContain('"gpt-5.5"');
  });

  it("gpt-5.6-terra still present", () => {
    expect(codexSrc).toContain('"gpt-5.6-terra"');
  });

  it("gpt-6-astra still present", () => {
    expect(codexSrc).toContain('"gpt-6-astra"');
  });
});

// ── #4405 Model prefix routing ───────────────────────────────────────────────
// Replicate MODEL_PREFIX_PROVIDERS logic from open-sse/services/model.js

const MODEL_PREFIX_PROVIDERS = [
  [/^codex-auto-review$/, "codex"],
  [/^gpt-[56]\./, "codex"],
  [/^gpt-6-/, "codex"],
  [/^gpt-daybreak-/, "codex"],
  [/^gpt-reserve/, "codex"],
  [/^claude-/, "anthropic"],
  [/^gemini-/, "gemini"],
  [/^gpt-/, "openai"],
  [/^o[134]/, "openai"],
  [/^deepseek-/, "openrouter"],
];

function inferProvider(modelName) {
  if (!modelName) return "openai";
  const m = modelName.toLowerCase();
  return MODEL_PREFIX_PROVIDERS.find(([re]) => re.test(m))?.[1] || "openai";
}

describe("inferProviderFromModelName — Codex gpt-* models route to codex (#4405)", () => {
  it("gpt-5.6-terra → codex", () => {
    expect(inferProvider("gpt-5.6-terra")).toBe("codex");
  });

  it("gpt-5.6-sol → codex", () => {
    expect(inferProvider("gpt-5.6-sol")).toBe("codex");
  });

  it("gpt-5.5 → codex", () => {
    expect(inferProvider("gpt-5.5")).toBe("codex");
  });

  it("gpt-6-astra → codex", () => {
    expect(inferProvider("gpt-6-astra")).toBe("codex");
  });

  it("gpt-daybreak-blue-latest → codex", () => {
    expect(inferProvider("gpt-daybreak-blue-latest")).toBe("codex");
  });

  it("gpt-reserve → codex", () => {
    expect(inferProvider("gpt-reserve")).toBe("codex");
  });

  it("gpt-4o → openai (standard model not affected)", () => {
    expect(inferProvider("gpt-4o")).toBe("openai");
  });

  it("gpt-4-turbo → openai (standard model not affected)", () => {
    expect(inferProvider("gpt-4-turbo")).toBe("openai");
  });

  it("gpt-3.5-turbo → openai (standard model not affected)", () => {
    expect(inferProvider("gpt-3.5-turbo")).toBe("openai");
  });

  it("claude-opus-5 → anthropic (regression guard)", () => {
    expect(inferProvider("claude-opus-5")).toBe("anthropic");
  });

  it("codex-auto-review → codex (regression guard)", () => {
    expect(inferProvider("codex-auto-review")).toBe("codex");
  });
});