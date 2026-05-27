import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

function readRepoFile(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), "utf8");
}

describe("CLI maintenance safeguards", () => {
  it("resets dashboard password through API, offline SQLite, then legacy db.json", () => {
    const source = readRepoFile("cli", "src", "cli", "menus", "settings.js");

    expect(source).toContain("Fixes #1482");
    expect(source).toContain('api.updateSettings({ password: null, authMode: "password" })');
    expect(source).toContain("const sqliteResult = resetPasswordInSqlite();");
    expect(source).toContain("const dbPath = getLegacyDbPath();");

    const apiReset = source.indexOf('api.updateSettings({ password: null, authMode: "password" })');
    const sqliteFallback = source.indexOf("const sqliteResult = resetPasswordInSqlite();");
    const legacyFallback = source.indexOf("const dbPath = getLegacyDbPath();");
    expect(apiReset).toBeLessThan(sqliteFallback);
    expect(sqliteFallback).toBeLessThan(legacyFallback);
  });

  it("supports cross-platform offline SQLite password recovery when the server is not running", () => {
    const source = readRepoFile("cli", "src", "cli", "menus", "settings.js");

    expect(source).toContain('path.join(getDataDir(), "db", "data.sqlite")');
    expect(source).toContain("SELECT data FROM settings WHERE id = 1");
    expect(source).toContain("delete settings.password");
    expect(source).toContain('settings.authMode = "password"');
    expect(source).toContain('require("node:sqlite").DatabaseSync');
    expect(source).toContain("better-sqlite3 or node:sqlite");
  });
});
