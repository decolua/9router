import { describe, expect, it } from "vitest";
import { TABLES, SCHEMA_VERSION } from "../../src/lib/db/schema.js";

describe("usageHistory request attribution columns", () => {
  const cols = TABLES.usageHistory.columns;

  it("declares comboName, chainDepth and sessionId", () => {
    expect(cols.comboName).toBe("TEXT");
    expect(cols.chainDepth).toBe("INTEGER DEFAULT 0");
    expect(cols.sessionId).toBe("TEXT");
  });

  it("keeps chainDepth non-null for existing rows via its DEFAULT", () => {
    // migrate.js adds missing columns with ALTER TABLE ... ADD COLUMN <def>,
    // so the DEFAULT here is what back-fills rows written before this change.
    expect(cols.chainDepth).toMatch(/DEFAULT 0/);
  });

  it("leaves comboName and sessionId nullable", () => {
    // Direct (non-combo) requests legitimately have no combo, and sessionId is
    // only present when the client sends one — NOT NULL would reject both.
    expect(cols.comboName).not.toMatch(/NOT NULL/);
    expect(cols.sessionId).not.toMatch(/NOT NULL/);
  });

  it("indexes the two columns that get filtered on", () => {
    const idx = TABLES.usageHistory.indexes.join(" ");
    expect(idx).toContain("usageHistory(comboName)");
    expect(idx).toContain("usageHistory(sessionId)");
  });

  it("bumps SCHEMA_VERSION so the pre-change backup runs", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("preserves the pre-existing usageHistory columns", () => {
    for (const c of ["timestamp", "provider", "model", "connectionId", "apiKey", "endpoint", "promptTokens", "completionTokens", "cost", "status", "tokens", "meta"]) {
      expect(cols[c]).toBeDefined();
    }
  });
});
