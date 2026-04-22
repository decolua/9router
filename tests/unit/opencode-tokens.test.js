import { describe, expect, it } from "vitest";

import {
  createSyncToken,
  normalizeSyncTokenPatch,
  touchSyncTokenRecord,
  toPublicTokenRecord,
  verifySyncToken,
} from "../../src/lib/opencodeSync/tokens.js";

describe("opencode sync token helpers", () => {
  it("stores only a hash and verifies the raw token", () => {
    const { token, record } = createSyncToken({
      name: "Laptop",
      mode: "device",
      metadata: { deviceName: "MacBook Pro", retries: 3, nested: { ignored: true } },
    });

    expect(token).toMatch(/^ocs_/);
    expect(record.tokenHash).toBeTypeOf("string");
    expect(record.tokenHash).not.toBe(token);
    expect(record).not.toHaveProperty("token");
    expect(verifySyncToken(token, record)).toBe(true);
    expect(verifySyncToken(`${token}-wrong`, record)).toBe(false);
    expect(toPublicTokenRecord(record)).toEqual({
      id: record.id,
      name: "Laptop",
      metadata: { deviceName: "MacBook Pro", retries: 3 },
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastUsedAt: null,
    });
    expect(toPublicTokenRecord(record)).not.toHaveProperty("mode");
  });

  it("does not leak unapproved fields in public records", () => {
    const publicRecord = toPublicTokenRecord({
      id: "token-1",
      name: "Laptop",
      metadata: { deviceName: "MacBook" },
      tokenHash: "a".repeat(64),
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
      internalAuditNote: "do-not-expose",
    });

    expect(publicRecord).toEqual({
      id: "token-1",
      name: "Laptop",
      metadata: { deviceName: "MacBook" },
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
      lastUsedAt: null,
    });
    expect(publicRecord).not.toHaveProperty("mode");
  });

  it("updates token bookkeeping timestamps when touched", () => {
    const usedAt = "2026-04-21T10:00:00.000Z";
    const { record } = createSyncToken({ name: "Laptop", mode: "device" });

    expect(touchSyncTokenRecord(record, usedAt)).toMatchObject({
      id: record.id,
      lastUsedAt: usedAt,
      updatedAt: usedAt,
    });
  });

  it("normalizes sync-token patch payloads", () => {
    expect(
      normalizeSyncTokenPatch({
        name: "  Laptop Pro  ",
        metadata: { platform: "macOS", retries: 2, nested: { ignored: true } },
      })
    ).toEqual({
      name: "Laptop Pro",
      metadata: { platform: "macOS", retries: 2 },
    });

    expect(normalizeSyncTokenPatch({ mode: "shared" })).toEqual({});
    expect(() => normalizeSyncTokenPatch({ name: "   " })).toThrow(/token name is required/i);
    expect(() => normalizeSyncTokenPatch({ metadata: "bad" })).toThrow(/invalid token metadata/i);
  });
});
