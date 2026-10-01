// Guards the bulk-add API-key naming bug: auto-generated "Key N" names used to be
// derived from the paste-line index, blind to existing connection names. The
// backend upserts apikey connections by name (connectionsRepo), so a colliding
// generated name OVERWROTE an existing key instead of adding a new one.
// Fix: planBulkAdd gap-fills the smallest free "<base> <n>" against existing
// names (and earlier entries in the same batch) so a name is never reused.
import { describe, it, expect } from "vitest";
import { planBulkAdd } from "../../src/shared/utils/bulkAdd.js";

describe("planBulkAdd: auto-named gap-fill (the replace bug)", () => {
  it("uses Key 1..N by paste index when nothing exists", () => {
    const out = planBulkAdd(["sk-a", "sk-b", "sk-c"], []);
    expect(out.map(o => o.name)).toEqual(["Key 1", "Key 2", "Key 3"]);
    expect(out.every(o => o.skipped === false)).toBe(true);
  });

  it("gap-fills around existing names — never reuses an existing name", () => {
    // Key 3 and Key 5 already exist; user adds 4 keys.
    // Free slots: 1, 2, 4, 6 -> assign those, never 3 or 5.
    const out = planBulkAdd(["sk-a", "sk-b", "sk-c", "sk-d"], ["Key 3", "Key 5"]);
    expect(out.map(o => o.name)).toEqual(["Key 1", "Key 2", "Key 4", "Key 6"]);
  });

  it("continues past the highest existing index when low slots are taken", () => {
    const out = planBulkAdd(["sk-a", "sk-b"], ["Key 1", "Key 2"]);
    expect(out.map(o => o.name)).toEqual(["Key 3", "Key 4"]);
  });

  it("skips blank/whitespace-only lines but keeps indexing contiguous", () => {
    const out = planBulkAdd(["sk-a", "   ", "", "sk-b"], []);
    expect(out.map(o => o.name)).toEqual(["Key 1", "Key 2"]);
    expect(out.map(o => o.apiKey)).toEqual(["sk-a", "sk-b"]);
  });

  it("within-batch names are unique even for the same free slot", () => {
    const out = planBulkAdd(["sk-a", "sk-b", "sk-c"], ["Key 1"]);
    // Key 1 taken; batch gets 2, 3, 4 — no internal dup.
    const names = out.map(o => o.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(["Key 2", "Key 3", "Key 4"]);
  });
});

describe("planBulkAdd: custom name|apiKey", () => {
  it("uses the literal base name with a gap-filled index", () => {
    const out = planBulkAdd(["Prod|sk-1", "Prod|sk-2"], []);
    expect(out.map(o => o.name)).toEqual(["Prod 1", "Prod 2"]);
    expect(out.map(o => o.apiKey)).toEqual(["sk-1", "sk-2"]);
  });

  it("custom name avoids an existing same-base name", () => {
    // "Prod 1" exists -> first new "Prod|.." line becomes "Prod 2".
    const out = planBulkAdd(["Prod|sk-new"], ["Prod 1"]);
    expect(out[0].name).toBe("Prod 2");
  });

  it("apiKey containing pipes is preserved (parts after first rejoined)", () => {
    const out = planBulkAdd(["Prod|sk|with|pipes"], []);
    expect(out[0].apiKey).toBe("sk|with|pipes");
    expect(out[0].name).toBe("Prod 1");
  });
});

describe("planBulkAdd: cloudflare-ai (name|apiKey|accountId)", () => {
  it("parses 3-part lines into name + apiKey + accountId", () => {
    const out = planBulkAdd(
      ["main|sk-key1|acc123", "main|sk-key2|def789"],
      [],
      { isCloudflareAi: true }
    );
    expect(out.map(o => o.name)).toEqual(["main 1", "main 2"]);
    expect(out[0].apiKey).toBe("sk-key1");
    expect(out[0].providerSpecificData).toEqual({ accountId: "acc123" });
    expect(out[1].providerSpecificData).toEqual({ accountId: "def789" });
  });

  it("2-part cloudflare line is name|apiKey (no accountId)", () => {
    const out = planBulkAdd(["main|sk-key1"], [], { isCloudflareAi: true });
    expect(out[0].name).toBe("main 1");
    expect(out[0].apiKey).toBe("sk-key1");
    expect(out[0].providerSpecificData).toBeUndefined();
  });

  it("1-part cloudflare line is auto-named Key N", () => {
    const out = planBulkAdd(["sk-key1"], [], { isCloudflareAi: true });
    expect(out[0].name).toBe("Key 1");
    expect(out[0].apiKey).toBe("sk-key1");
  });
});

describe("planBulkAdd: robustness", () => {
  it("returns [] for no input", () => {
    expect(planBulkAdd([], [])).toEqual([]);
    expect(planBulkAdd(["", "  "], [])).toEqual([]);
  });

  it("trims names and apiKeys", () => {
    const out = planBulkAdd(["  Prod  |  sk-1  "], []);
    expect(out[0].name).toBe("Prod 1");
    expect(out[0].apiKey).toBe("sk-1");
  });

  it("falls back to base 'Key' when name part is empty", () => {
    const out = planBulkAdd(["|sk-1"], []);
    expect(out[0].name).toBe("Key 1");
    expect(out[0].apiKey).toBe("sk-1");
  });

  it("coerces non-array existingNames gracefully", () => {
    const out = planBulkAdd(["sk-a"], null);
    expect(out[0].name).toBe("Key 1");
  });
});
