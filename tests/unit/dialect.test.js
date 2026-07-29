import { describe, it, expect } from "vitest";
import { quotePgSql, toPgParams } from "@/lib/db/dialect.js";

describe("quotePgSql", () => {
  it("quotes camelCase table names outside string literals", () => {
    const sql = "SELECT * FROM users WHERE orgId = ?";
    expect(quotePgSql(sql)).toBe('SELECT * FROM "users" WHERE "orgId" = ?');
  });

  it("does not quote known table names inside single-quoted string literals", () => {
    const sql =
      "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users'";
    expect(quotePgSql(sql)).toBe(sql);
  });

  it("preserves escaped single quotes inside string literals", () => {
    const sql = "SELECT * FROM kv WHERE value = 'it''s users'";
    expect(quotePgSql(sql)).toBe(`SELECT * FROM "kv" WHERE value = 'it''s users'`);
  });

  it("still quotes explicit double-quoted idents", () => {
    const sql = 'INSERT INTO users(id, "orgId", email) VALUES(?, ?, ?)';
    expect(quotePgSql(sql)).toBe('INSERT INTO "users"(id, "orgId", email) VALUES(?, ?, ?)');
  });
});

describe("toPgParams", () => {
  it("converts placeholders after quoting", () => {
    const { sql, params } = toPgParams("INSERT INTO users(orgId) VALUES(?)", ["org-1"]);
    expect(sql).toBe('INSERT INTO "users"("orgId") VALUES($1)');
    expect(params).toEqual(["org-1"]);
  });
});
