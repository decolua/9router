import { describe, it, expect } from "vitest";

// Sync test: localDb shim must re-export every export from db/index.js.
// Catches the historical regression where new functions added to db/index.js
// weren't mirrored in localDb.js, causing "Attempted import error" → 404s.

async function getExportKeys(mod) {
  const ns = await import(mod);
  return Object.keys(ns).sort();
}

describe("localDb shim export sync", () => {
  it("@/lib/localDb re-exports every export from @/lib/db/index.js", async () => {
    const dbKeys = await getExportKeys("../../src/lib/db/index.js");
    const shimKeys = await getExportKeys("../../src/lib/localDb.js");
    const missing = dbKeys.filter((k) => !shimKeys.includes(k));
    expect(missing, `shim is missing exports: ${missing.join(", ")}`).toEqual([]);
  });

  it("shim does not export names absent from db/index.js (no phantom exports)", async () => {
    const dbKeys = await getExportKeys("../../src/lib/db/index.js");
    const shimKeys = await getExportKeys("../../src/lib/localDb.js");
    const phantom = shimKeys.filter((k) => !dbKeys.includes(k));
    expect(phantom).toEqual([]);
  });
});
