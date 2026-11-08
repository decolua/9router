import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Point DATA_DIR at a scratch dir before the store module resolves it.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "9r-probe-store-"));
vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: TMP_DIR }));

const { readProbes, saveProbeResults, clearProbeResults, PROBE_FILE } = await import(
  "../../src/lib/probe/store.js"
);

const result = (model, over = {}) => ({
  model,
  ok: true,
  status: 200,
  latencyMs: 120,
  error: null,
  failureKind: null,
  capabilities: { chat: true, vision: false, tools: false },
  detail: { chat: "ok" },
  probedAt: "2026-08-13T00:00:00.000Z",
  ...over,
});

describe("probe store", () => {
  beforeEach(() => {
    try {
      fs.unlinkSync(PROBE_FILE);
    } catch {}
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("reads as empty when nothing has been probed", () => {
    expect(readProbes()).toEqual({ version: 1, results: {}, updatedAt: null });
  });

  it("reads as empty rather than throwing on a corrupt file", () => {
    fs.mkdirSync(path.dirname(PROBE_FILE), { recursive: true });
    fs.writeFileSync(PROBE_FILE, "{ not json", "utf8");
    expect(readProbes().results).toEqual({});
  });

  it("persists a probe result", () => {
    saveProbeResults([result("openai/gpt-4o")]);
    const { results } = readProbes();
    expect(results["openai/gpt-4o"].ok).toBe(true);
    expect(results["openai/gpt-4o"].capabilities).toEqual({
      chat: true,
      vision: false,
      tools: false,
      audioInput: false,
    });
  });

  it("merges batches instead of replacing, so probing one provider keeps another's data", () => {
    saveProbeResults([result("openai/gpt-4o"), result("groq/llama-3")]);
    saveProbeResults([result("anthropic/claude-sonnet-5")]);

    const { results } = readProbes();
    expect(Object.keys(results).sort()).toEqual([
      "anthropic/claude-sonnet-5",
      "groq/llama-3",
      "openai/gpt-4o",
    ]);
  });

  it("overwrites a re-probed model with the newer outcome", () => {
    saveProbeResults([result("openai/gpt-4o", { ok: true })]);
    saveProbeResults([
      result("openai/gpt-4o", { ok: false, failureKind: "rate_limited", error: "429" }),
    ]);

    const entry = readProbes().results["openai/gpt-4o"];
    expect(entry.ok).toBe(false);
    expect(entry.failureKind).toBe("rate_limited");
  });

  it("normalises missing capability fields to false", () => {
    saveProbeResults([{ model: "x/y", ok: true }]);
    expect(readProbes().results["x/y"].capabilities).toEqual({
      chat: false,
      vision: false,
      tools: false,
      audioInput: false,
    });
  });

  it("persists a measured audio-input capability", () => {
    saveProbeResults([
      result("openai/gpt-4o-audio", { capabilities: { chat: true, audioInput: true } }),
    ]);
    expect(readProbes().results["openai/gpt-4o-audio"].capabilities.audioInput).toBe(true);
  });

  it("ignores entries without a model id", () => {
    saveProbeResults([{ ok: true }, result("real/model")]);
    expect(Object.keys(readProbes().results)).toEqual(["real/model"]);
  });

  it("is a no-op for an empty batch", () => {
    saveProbeResults([result("keep/me")]);
    saveProbeResults([]);
    expect(Object.keys(readProbes().results)).toEqual(["keep/me"]);
  });

  it("clears only the named models", () => {
    saveProbeResults([result("a/one"), result("b/two"), result("c/three")]);
    clearProbeResults(["b/two"]);

    expect(Object.keys(readProbes().results).sort()).toEqual(["a/one", "c/three"]);
  });

  it("clears everything when no models are named", () => {
    saveProbeResults([result("a/one"), result("b/two")]);
    clearProbeResults();
    expect(readProbes().results).toEqual({});
  });
});
