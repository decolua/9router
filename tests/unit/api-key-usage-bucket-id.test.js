import { describe, it, expect } from "vitest";
import { apiKeyBucketId, maskApiKey, deletedKeyLabel } from "@/lib/db/repos/apiKeyUsageRepo.js";

/**
 * The bucket id is what the chart colours by and what the table's re-keyed
 * response is keyed on. If the two derived it differently they would drift, so
 * there is one function and both call it.
 */
describe("apiKeyBucketId", () => {
  const map = { "sk-9router-abcdefgh-xyz": { name: "hermes", id: "key-1" } };

  it("uses the key's id when the key still exists", () => {
    expect(apiKeyBucketId("sk-9router-abcdefgh-xyz", map)).toBe("key-1");
  });

  it("falls back to a hash of the raw key for a key that was deleted", () => {
    // deleteApiKey hard-deletes the row, so a past request's key has no record
    // to join against. Not maskApiKey: every 9Router key on an install shares
    // the same sk-${machineId}-... prefix, so the masked form is identical for
    // every key on that machine — see maskApiKey's docblock. sha256(rawKey)
    // first 8 hex chars instead: distinct per key, and must never be the raw
    // key itself.
    const id = apiKeyBucketId("sk-9router-deleted-999", map);
    expect(id).toBe("a618fc43");
    expect(id).not.toContain("deleted-999");
  });

  it("gives two different deleted keys two different bucket ids", () => {
    // The bug this fixes: two deleted keys on the same install share every
    // character up to the machineId-sized prefix, so maskApiKey's first-8
    // prefix is identical for both (confirmed below; only its 4-char display
    // tail differs) and a prefix-keyed bucket would collapse them into one
    // table row / one chart series. The hash must actually distinguish them.
    const idA = apiKeyBucketId("sk-9router-deleted-999", map);
    const idB = apiKeyBucketId("sk-9router-deleted-888", map);

    expect(maskApiKey("sk-9router-deleted-999").slice(0, 11)).toBe(maskApiKey("sk-9router-deleted-888").slice(0, 11));
    expect(idA).not.toBe(idB);
    expect(idA).toBe("a618fc43");
    expect(idB).toBe("067de39d");
  });

  it("buckets keyless traffic under one well-known id", () => {
    expect(apiKeyBucketId(null, map)).toBe("local-no-key");
    expect(apiKeyBucketId("", map)).toBe("local-no-key");
    expect(apiKeyBucketId(undefined, {})).toBe("local-no-key");
  });

  it("masks short keys without revealing them whole", () => {
    expect(maskApiKey("abc")).toBe("a***");
    expect(maskApiKey("")).toBeNull();
    expect(maskApiKey(null)).toBeNull();
  });
});

/**
 * deletedKeyLabel is the table's keyName fallback (usageRepo.js) for a
 * deleted key. getApiKeyUsageSeries's chart-legend `keys` map builds the same
 * `(deleted) ${id}` string itself, from an id that already IS this hash
 * (apiKeyBucketId's own deleted-key fallback) — it doesn't call deletedKeyLabel
 * because by that point it only has the id, not the raw key. These tests
 * confirm the two independently-built strings actually match, not just that
 * they're built from the same formula in principle.
 */
describe("deletedKeyLabel", () => {
  const map = { "sk-9router-abcdefgh-xyz": { name: "hermes", id: "key-1" } };

  it("reads identically to the chart legend's own (deleted) label for the same key", () => {
    const rawKey = "sk-9router-zzzzzzzz-gone";
    // Exactly what getApiKeyUsageSeries's `keys` map builds: `(deleted) ${id}`
    // where id = apiKeyBucketId(rawKey, apiKeyMap).
    const chartLegendLabel = `(deleted) ${apiKeyBucketId(rawKey, map)}`;
    const tableKeyName = deletedKeyLabel(rawKey);

    expect(tableKeyName).toBe(chartLegendLabel);
    expect(tableKeyName).toBe("(deleted) 251371a1");
  });

  it("gives two different deleted keys two different labels", () => {
    const labelA = deletedKeyLabel("sk-9router-deleted-999");
    const labelB = deletedKeyLabel("sk-9router-deleted-888");

    expect(labelA).not.toBe(labelB);
    expect(labelA).toBe("(deleted) a618fc43");
    expect(labelB).toBe("(deleted) 067de39d");
  });

  it("returns null for a non-string key, leaving the no-key label to the caller", () => {
    expect(deletedKeyLabel(null)).toBeNull();
    expect(deletedKeyLabel(undefined)).toBeNull();
  });
});
