/**
 * Tests for #4410 — Kiro registry missing claude-opus-5.5 models.
 *
 * Kiro added Claude Opus 5.5 as an experimental preview on 2026-09-22.
 * The model was missing from open-sse/providers/registry/kiro.js and
 * open-sse/providers/capabilities.js.
 *
 * Fix:
 * - Add claude-opus-5.5 / -thinking / -agentic / -thinking-agentic to kiro.js
 * - Add capability entries (vision, reasoning, search, 1M context, adaptive thinking)
 */

import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import fs from "fs";
import path from "path";

const kiroSrc = fs.readFileSync(
  new URL("../../open-sse/providers/registry/kiro.js", import.meta.url),
  "utf-8"
);

describe("Kiro registry — claude-opus-5.5 (#4410)", () => {
  it("includes claude-opus-5.5 in kiro registry", () => {
    expect(kiroSrc).toContain('"claude-opus-5.5"');
  });

  it("includes claude-opus-5.5-thinking in kiro registry", () => {
    expect(kiroSrc).toContain('"claude-opus-5.5-thinking"');
  });

  it("includes claude-opus-5.5-agentic in kiro registry", () => {
    expect(kiroSrc).toContain('"claude-opus-5.5-agentic"');
  });

  it("includes claude-opus-5.5-thinking-agentic in kiro registry", () => {
    expect(kiroSrc).toContain('"claude-opus-5.5-thinking-agentic"');
  });

  it("claude-opus-5 still present (regression guard)", () => {
    expect(kiroSrc).toContain('"claude-opus-5"');
  });
});

describe("capabilities — claude-opus-5.5 (#4410)", () => {
  it("claude-opus-5.5 has vision:true", () => {
    const caps = getCapabilitiesForModel("kiro", "claude-opus-5.5");
    expect(caps.vision).toBe(true);
  });

  it("claude-opus-5.5 has reasoning:true", () => {
    const caps = getCapabilitiesForModel("kiro", "claude-opus-5.5");
    expect(caps.reasoning).toBe(true);
  });

  it("claude-opus-5.5 has contextWindow 1M", () => {
    const caps = getCapabilitiesForModel("kiro", "claude-opus-5.5");
    expect(caps.contextWindow).toBe(1000000);
  });

  it("claude-opus-5.5 has maxOutput 128000", () => {
    const caps = getCapabilitiesForModel("kiro", "claude-opus-5.5");
    expect(caps.maxOutput).toBe(128000);
  });

  it("claude-opus-5.5-thinking has same capabilities", () => {
    const caps = getCapabilitiesForModel("kiro", "claude-opus-5.5-thinking");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.contextWindow).toBe(1000000);
  });

  it("claude-opus-5 still has 1M context (regression guard)", () => {
    const caps = getCapabilitiesForModel("kiro", "claude-opus-5");
    expect(caps.contextWindow).toBe(1000000);
  });
});