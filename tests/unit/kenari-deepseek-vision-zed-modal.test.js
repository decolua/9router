/**
 * Tests for two independent frontend/capabilities fixes:
 *
 * #4293 — deepseek-v4-1-flash (hyphen) has vision=false
 *   Kenari exposes the model under the ID "deepseek-v4-1-flash" (dash instead
 *   of dot).  The capabilities table only had "deepseek-v4.1-flash" (dot), so
 *   the hyphenated variant fell through to the generic *deepseek* pattern which
 *   has vision:false.  Fix: add "deepseek-v4-1-flash" as an alias with the same
 *   vision:true entry.
 *
 * #4244 — Zed missing from SelectModelModal LIVE_CATALOG_PROVIDERS
 *   The hardcoded list ["cursor","cline","clinepass"] omitted "zed", so the
 *   Zed provider card was never fetched and never shown in the Combo picker.
 *   Fix: add "zed" to the list (and wire up the corresponding state/hook/ternary).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// ── #4293 deepseek-v4-1-flash vision capability ───────────────────────────

describe("deepseek-v4-1-flash capabilities (#4293)", () => {
  it("reports vision:true for the hyphenated deepseek-v4-1-flash id (Kenari variant)", () => {
    // Any provider that uses the hyphenated id should get vision:true
    const caps = getCapabilitiesForModel("kenari", "deepseek-v4-1-flash");
    expect(caps.vision).toBe(true);
  });

  it("still reports vision:true for the dotted deepseek-v4.1-flash id", () => {
    const caps = getCapabilitiesForModel("ollama", "deepseek-v4.1-flash");
    expect(caps.vision).toBe(true);
  });

  it("still reports reasoning:true for deepseek-v4-1-flash", () => {
    const caps = getCapabilitiesForModel("kenari", "deepseek-v4-1-flash");
    expect(caps.reasoning).toBe(true);
  });

  it("reports the correct contextWindow (1M) for deepseek-v4-1-flash", () => {
    const caps = getCapabilitiesForModel("kenari", "deepseek-v4-1-flash");
    expect(caps.contextWindow).toBe(1000000);
  });
});

// ── #4244 LIVE_CATALOG_PROVIDERS includes zed ────────────────────────────
// ModelSelectModal.js is JSX so we cannot import it in Vitest without a
// JSX transform.  Read the source text and verify the constant definition
// directly — this is reliable and does not require a full React setup.

import fs from "fs";
import { LIVE_CATALOG_PROVIDERS } from "@/shared/utils/selectableModels.js";

// #4244 added zed to the picker's live-catalog list. That list now lives in
// selectableModels so the Combo picker, the CLI-tool cards and
// /api/providers/[id]/models share one definition; this guards the same intent
// without pinning it to a string inside ModelSelectModal.
describe("LIVE_CATALOG_PROVIDERS includes zed (#4244)", () => {
  let src;
  beforeAll(() => {
    const fileUrl = new URL("../../src/shared/components/ModelSelectModal.js", import.meta.url);
    src = fs.readFileSync(fileUrl, "utf-8");
  });

  it("includes zed in LIVE_CATALOG_PROVIDERS", () => {
    expect(LIVE_CATALOG_PROVIDERS).toContain("zed");
  });

  it("still includes cursor, cline, clinepass", () => {
    expect(LIVE_CATALOG_PROVIDERS).toEqual(
      expect.arrayContaining(["cursor", "cline", "clinepass"])
    );
  });

  it("the picker imports the shared list instead of declaring its own", () => {
    expect(src).toContain('LIVE_CATALOG_PROVIDERS');
    expect(src).not.toMatch(/const LIVE_CATALOG_PROVIDERS\s*=\s*\[/);
  });

  it("zedModels hook call is present in the file", () => {
    expect(src).toContain("zedModels");
    expect(src).toContain("zedConnectionIds");
  });
});