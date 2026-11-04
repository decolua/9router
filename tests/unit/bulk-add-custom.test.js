import { describe, it, expect } from "vitest";
import { planBulkAdd, splitBulkLines } from "../../src/shared/utils/bulkAdd.js";

describe("splitBulkLines", () => {
  it("splits text by newlines and ignores empty lines", () => {
    const text = "sk-key1\n\nsk-key2\r\nsk-key3\n";
    expect(splitBulkLines(text)).toEqual(["sk-key1", "sk-key2", "sk-key3"]);
  });

  it("splits comma-separated keys on a single line when no pipes are present", () => {
    const text = "sk-key1, sk-key2, sk-key3";
    expect(splitBulkLines(text)).toEqual(["sk-key1", "sk-key2", "sk-key3"]);
  });

  it("preserves pipe-separated lines even if combined with newlines", () => {
    const text = "prod|sk-key1\nbackup|sk-key2";
    expect(splitBulkLines(text)).toEqual(["prod|sk-key1", "backup|sk-key2"]);
  });

  it("returns empty array for empty or whitespace-only input", () => {
    expect(splitBulkLines("")).toEqual([]);
    expect(splitBulkLines("   \n   \r\n  ")).toEqual([]);
    expect(splitBulkLines(null)).toEqual([]);
  });
});

describe("planBulkAdd: custom provider support", () => {
  it("uses defaultBaseName when provided instead of 'Key'", () => {
    const out = planBulkAdd(["sk-key1", "sk-key2"], [], { defaultBaseName: "lyb" });
    expect(out.map((o) => o.name)).toEqual(["lyb 1", "lyb 2"]);
    expect(out.map((o) => o.apiKey)).toEqual(["sk-key1", "sk-key2"]);
  });

  it("gap-fills defaultBaseName against existing names", () => {
    const out = planBulkAdd(["sk-key1", "sk-key2"], ["lyb 1"], { defaultBaseName: "lyb" });
    expect(out.map((o) => o.name)).toEqual(["lyb 2", "lyb 3"]);
  });

  it("attaches defaultModel to each planned entry if provided", () => {
    const out = planBulkAdd(["sk-key1", "sk-key2"], [], {
      defaultBaseName: "lyb",
      defaultModel: "gpt-4o-mini",
    });
    expect(out[0].defaultModel).toBe("gpt-4o-mini");
    expect(out[1].defaultModel).toBe("gpt-4o-mini");
  });

  it("respects custom explicit name even with defaultBaseName set", () => {
    const out = planBulkAdd(["Backup|sk-backup", "sk-auto"], [], {
      defaultBaseName: "lyb",
    });
    expect(out[0].name).toBe("Backup 1");
    expect(out[1].name).toBe("lyb 1");
  });
});
