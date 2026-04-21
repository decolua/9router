import { describe, expect, it } from "vitest";

import { createSyncToken, toPublicTokenRecord, verifySyncToken } from "../../src/lib/opencodeSync/tokens.js";

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
      mode: "device",
      metadata: { deviceName: "MacBook Pro", retries: 3 },
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  });

  it("does not leak unapproved fields in public records", () => {
    const publicRecord = toPublicTokenRecord({
      id: "token-1",
      name: "Laptop",
      mode: "device",
      metadata: { deviceName: "MacBook" },
      tokenHash: "a".repeat(64),
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
      internalAuditNote: "do-not-expose",
    });

    expect(publicRecord).toEqual({
      id: "token-1",
      name: "Laptop",
      mode: "device",
      metadata: { deviceName: "MacBook" },
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
    });
  });
});
