/**
 * Tests for the model metadata resolver.
 *
 * Bead: 9r-ocmr.e2.02
 * PRD:  REQ-006, REQ-008, VAL-006, VAL-008
 *
 * Validates that resolveModelMetadata() applies manual overrides with
 * correct precedence and gracefully falls back on DB errors.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the KV store ──────────────────────────────────────────────
// We intercept getModelOverride to control what the DB returns.

vi.mock("../../src/lib/db/repos/modelOverridesRepo.js", () => ({
  getModelOverride: vi.fn().mockResolvedValue(null),
  getModelOverrides: vi.fn().mockResolvedValue({}),
  setModelOverride: vi.fn().mockResolvedValue(undefined),
  deleteModelOverride: vi.fn().mockResolvedValue(undefined),
}));

import { getModelOverride } from "../../src/lib/db/repos/modelOverridesRepo.js";
import { resolveModelMetadata } from "../../src/sse/services/modelMetadataResolver.js";

describe("resolveModelMetadata (9r-ocmr.e2.02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no override in DB
    getModelOverride.mockResolvedValue(null);
  });

  // ── Known model returns hardcoded caps when no override ───────────

  it("returns hardcoded caps for known model when no override exists", async () => {
    const caps = await resolveModelMetadata(null, "claude-opus-4.6");

    expect(caps.reasoning).toBe(true);
    expect(caps.contextWindow).toBe(1_000_000);
    expect(caps.maxOutput).toBe(128_000);
    expect(caps.vision).toBe(true);
    expect(getModelOverride).toHaveBeenCalledWith(null, "claude-opus-4.6");
  });

  // ── Unknown model returns safe defaults ───────────────────────────

  it("returns safe defaults for unknown model when no override exists", async () => {
    const caps = await resolveModelMetadata(null, "unknown-xyz-model");

    expect(caps.contextWindow).toBe(200_000);
    expect(caps.maxOutput).toBe(64_000);
    expect(caps.reasoning).toBe(false);
    expect(caps.tools).toBe(true);
  });

  // ── Manual override wins over hardcoded (REQ-008) ────────────────

  it("manual override wins over hardcoded caps", async () => {
    getModelOverride.mockResolvedValue({
      contextWindow: 500_000,
      maxOutput: 32_000,
    });

    const caps = await resolveModelMetadata(null, "claude-opus-4.6");

    // Override fields replace base
    expect(caps.contextWindow).toBe(500_000);
    expect(caps.maxOutput).toBe(32_000);
    // Non-overridden fields remain from base
    expect(caps.reasoning).toBe(true);
    expect(caps.vision).toBe(true);
    expect(caps.thinkingFormat).toBe("claude-adaptive");
  });

  // ── Partial override merges correctly ─────────────────────────────

  it("partial override merges with base — override fields win, rest from base", async () => {
    getModelOverride.mockResolvedValue({ contextWindow: 999 });

    const caps = await resolveModelMetadata(null, "claude-opus-4.6");

    expect(caps.contextWindow).toBe(999);       // overridden
    expect(caps.maxOutput).toBe(128_000);        // from base
    expect(caps.reasoning).toBe(true);           // from base
    expect(caps.tools).toBe(true);               // from base
    expect(caps.thinkingFormat).toBe("claude-adaptive"); // from base
  });

  // ── Override can add new fields ───────────────────────────────────

  it("override can add fields not present in base", async () => {
    getModelOverride.mockResolvedValue({ reasoning: false, customField: "test" });

    const caps = await resolveModelMetadata(null, "claude-opus-4.6");

    expect(caps.reasoning).toBe(false);  // overridden from true to false
    expect(caps.customField).toBe("test"); // new field
  });

  // ── DB error gracefully falls back to hardcoded ───────────────────

  it("gracefully falls back to hardcoded caps when DB errors", async () => {
    getModelOverride.mockRejectedValue(new Error("DB unavailable"));

    const caps = await resolveModelMetadata(null, "claude-opus-4.6");

    // Should still return valid caps (from hardcoded)
    expect(caps.contextWindow).toBe(1_000_000);
    expect(caps.reasoning).toBe(true);
    expect(caps.vision).toBe(true);
  });

  // ── DB returns null (no override) ─────────────────────────────────

  it("returns base caps when DB returns null override", async () => {
    getModelOverride.mockResolvedValue(null);

    const caps = await resolveModelMetadata("openai", "gpt-5");

    expect(caps.contextWindow).toBe(400_000);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
  });

  // ── Provider argument forwarded to DB ─────────────────────────────

  it("forwards provider alias to DB lookup", async () => {
    getModelOverride.mockResolvedValue(null);

    await resolveModelMetadata("anthropic", "claude-opus-4.6");

    expect(getModelOverride).toHaveBeenCalledWith("anthropic", "claude-opus-4.6");
  });

  // ── Non-reasoning model override can enable reasoning ─────────────

  it("override can enable reasoning on a non-reasoning model", async () => {
    getModelOverride.mockResolvedValue({ reasoning: true, thinkingFormat: "openai" });

    const caps = await resolveModelMetadata(null, "gpt-4o");

    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
    // Base vision stays
    expect(caps.vision).toBe(true);
  });

  // ── Unknown model with override returns override + defaults ───────

  it("unknown model with override returns override fields plus safe defaults", async () => {
    getModelOverride.mockResolvedValue({ contextWindow: 100_000 });

    const caps = await resolveModelMetadata(null, "custom-unknown-model");

    expect(caps.contextWindow).toBe(100_000);  // override
    expect(caps.maxOutput).toBe(64_000);        // default
    expect(caps.reasoning).toBe(false);         // default
    expect(caps.tools).toBe(true);              // default
  });
});
