import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveBandToCombo } from "../../src/sse/services/model.js";

describe("resolveBandToCombo", () => {
  const originalEnv = process.env;

  // Mock combo checker that returns models for standard combos
  const mockComboExists = async (name) => {
    const realCombos = ["Sleipnir", "Valkyrie", "Fenrir", "Odin"];
    if (realCombos.includes(name)) {
      return ["model1", "model2"];
    }
    return null;
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("case a: claude-haiku-4-5 resolves to the haiku band combo (Sleipnir default)", async () => {
    const result = await resolveBandToCombo("claude-haiku-4-5", mockComboExists);
    expect(result).toBe("Sleipnir");
  });

  it("case b: claude-opus-4-1-20250805 resolves to the opus band combo (Fenrir default)", async () => {
    const result = await resolveBandToCombo("claude-opus-4-1-20250805", mockComboExists);
    expect(result).toBe("Fenrir");
  });

  it("case e: claude-fable-5 resolves to the fable band combo (Odin default)", async () => {
    const result = await resolveBandToCombo("claude-fable-5", mockComboExists);
    expect(result).toBe("Odin");
  });

  it("case c: env override wins over the default combo when the override target exists", async () => {
    // Default for sonnet is Valkyrie; override points it at Fenrir instead.
    // Fenrir exists in the mock, so the override must be what gets returned —
    // getting "Valkyrie" back would mean the override was silently ignored.
    process.env.NINER_BAND_SONNET = "Fenrir";

    const result = await resolveBandToCombo("sonnet", mockComboExists);
    expect(result).toBe("Fenrir");
  });

  it("case d: when mapped combo does NOT exist, return original string unchanged (safety property)", async () => {
    process.env.NINER_BAND_HAIKU = "NonExistentCombo";

    const result = await resolveBandToCombo("haiku", mockComboExists);
    // Since NonExistentCombo doesn't exist, should return original
    expect(result).toBe("haiku");
  });

  it("bare haiku resolves case-insensitively to Sleipnir", async () => {
    const result = await resolveBandToCombo("haiku", mockComboExists);
    expect(result).toBe("Sleipnir");
  });

  it("bare sonnet maps to Valkyrie by default", async () => {
    const result = await resolveBandToCombo("sonnet", mockComboExists);
    expect(result).toBe("Valkyrie");
  });

  it("bare fable maps to Odin by default", async () => {
    const result = await resolveBandToCombo("fable", mockComboExists);
    expect(result).toBe("Odin");
  });

  it("provider/model format is returned unchanged", async () => {
    const result = await resolveBandToCombo("openai/gpt-4", mockComboExists);
    expect(result).toBe("openai/gpt-4");
  });

  it("unknown model strings are returned unchanged", async () => {
    const result = await resolveBandToCombo("some-random-model", mockComboExists);
    expect(result).toBe("some-random-model");
  });

  it("empty string is returned unchanged", async () => {
    const result = await resolveBandToCombo("", mockComboExists);
    expect(result).toBe("");
  });

  it("null input is returned unchanged", async () => {
    const result = await resolveBandToCombo(null, mockComboExists);
    expect(result).toBe(null);
  });
});
