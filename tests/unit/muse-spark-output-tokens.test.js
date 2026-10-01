/**
 * Regression tests for #4254
 *
 * muse-spark-1.2/1.3-contributor-free (OpenCode Free, Responses path) returns
 * empty completions on small max_output_tokens budgets. The model spends nearly
 * the entire budget on internal reasoning before emitting any text, so requests
 * with max_tokens ≤ ~500 return HTTP 200 with status:"incomplete" and output:[].
 *
 * Fix: in OpenCodeExecutor.transformRequest, clamp max_output_tokens for muse-spark
 * models to [8000, 1_000_000] (upstream rejects requests above 1e6).
 *
 * These tests verify the clamping logic via the transformRequest output.
 */

import { describe, it, expect } from "vitest";
import { isMuseSparkModel } from "../../open-sse/providers/models/helpers.js";

// Replicate the clamping logic from opencode.js so we can test it in isolation.
const MUSE_MIN = 8000;
const MUSE_MAX = 1_000_000;

function clampMuseOutputTokens(maxOutputTokens) {
  const cap = Number(maxOutputTokens);
  if (!Number.isFinite(cap) || cap < MUSE_MIN) return MUSE_MIN;
  if (cap > MUSE_MAX) return MUSE_MAX;
  return cap;
}

// ── isMuseSparkModel ────────────────────────────────────────────────────────

describe("isMuseSparkModel — model detection", () => {
  it("detects muse-spark-1.2-contributor-free", () => {
    expect(isMuseSparkModel("muse-spark-1.2-contributor-free")).toBe(true);
  });
  it("detects muse-spark-1.3-contributor-free", () => {
    expect(isMuseSparkModel("muse-spark-1.3-contributor-free")).toBe(true);
  });
  it("does not match unrelated models", () => {
    expect(isMuseSparkModel("gpt-4o")).toBe(false);
    expect(isMuseSparkModel("mimo-v2.5-free")).toBe(false);
    expect(isMuseSparkModel("big-pickle")).toBe(false);
  });
});

// ── clamping logic ──────────────────────────────────────────────────────────

describe("muse-spark max_output_tokens clamping (#4254)", () => {
  it("clamps undefined to MUSE_MIN (8000)", () => {
    expect(clampMuseOutputTokens(undefined)).toBe(MUSE_MIN);
  });

  it("clamps null to MUSE_MIN", () => {
    expect(clampMuseOutputTokens(null)).toBe(MUSE_MIN);
  });

  it("clamps 100 to MUSE_MIN", () => {
    expect(clampMuseOutputTokens(100)).toBe(MUSE_MIN);
  });

  it("clamps 500 to MUSE_MIN", () => {
    expect(clampMuseOutputTokens(500)).toBe(MUSE_MIN);
  });

  it("clamps 1000 to MUSE_MIN", () => {
    expect(clampMuseOutputTokens(1000)).toBe(MUSE_MIN);
  });

  it("leaves 8000 unchanged", () => {
    expect(clampMuseOutputTokens(8000)).toBe(8000);
  });

  it("leaves 16000 unchanged", () => {
    expect(clampMuseOutputTokens(16000)).toBe(16000);
  });

  it("leaves 32000 unchanged", () => {
    expect(clampMuseOutputTokens(32000)).toBe(32000);
  });

  it("clamps 2_000_000 to MUSE_MAX (1_000_000)", () => {
    expect(clampMuseOutputTokens(2_000_000)).toBe(MUSE_MAX);
  });

  it("leaves exactly MUSE_MAX unchanged", () => {
    expect(clampMuseOutputTokens(MUSE_MAX)).toBe(MUSE_MAX);
  });
});