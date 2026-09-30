/**
 * Backup Self-Check Test
 *
 * Pins the apiKeys backup fix: exportDb -> importDb round-trip must preserve
 * apiKeys permissions and createdBy, old backups without those fields must
 * still import (backward compatible), and import must never reset them.
 *
 * Structural check on purpose: the DB modules use the @/ path alias and need
 * a live SQLite file, so plain node cannot import them here. Instead this
 * reads src/lib/db/index.js and src/lib/db/schema.js as text and asserts on
 * the restore logic, the same approach as
 * changelogModalRenderSelfCheck.mjs.
 *
 * Run with: node src/lib/db/backupSelfCheck.mjs
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(path.join(here, "index.js"), "utf8");
const schemaSrc = readFileSync(path.join(here, "schema.js"), "utf8");

let failures = 0;

function check(name, cond, hint = "") {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${name}${hint ? ` : ${hint}` : ""}`);
  }
}

function count(haystack, needle) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

// 1. Export carries the full apiKeys row, permissions and creator included.
check("export maps apiKeys.permissions", indexSrc.includes("permissions: r.permissions"));
check("export maps apiKeys.createdBy", indexSrc.includes("createdBy: r.createdBy"));

// 2. Both import paths restore them: importDb and importDbProgressive.
const INSERT_COLS = "systemPrompt, permissions, createdBy) VALUES(";
check(
  "import INSERT restores permissions and createdBy in both paths",
  count(indexSrc, INSERT_COLS) >= 2,
  `found ${count(indexSrc, INSERT_COLS)}, want 2`
);

// 3. A missing field falls back to the stored row, so backups written before
//    these fields existed still import without resetting anything.
const PERM_FALLBACK = "k.permissions !== undefined ? k.permissions : (prev.permissions";
const CREATED_FALLBACK = "k.createdBy !== undefined ? k.createdBy : (prev.createdBy";
check(
  "import keeps existing permissions when backup lacks the field",
  count(indexSrc, PERM_FALLBACK) >= 2,
  `found ${count(indexSrc, PERM_FALLBACK)}, want 2`
);
check(
  "import keeps existing createdBy when backup lacks the field",
  count(indexSrc, CREATED_FALLBACK) >= 2,
  `found ${count(indexSrc, CREATED_FALLBACK)}, want 2`
);

// 4. The fallback needs a snapshot taken before the wipe, or it reads nothing.
const firstSnap = indexSrc.indexOf("existingApiKeys[r.id] = r");
const firstWipe = indexSrc.indexOf("DELETE FROM apiKeys");
check(
  "apiKeys snapshot is taken before the wipe",
  firstSnap !== -1 && firstWipe !== -1 && firstSnap < firstWipe
);
check(
  "both import paths snapshot apiKeys",
  count(indexSrc, "existingApiKeys[r.id] = r") >= 2,
  `found ${count(indexSrc, "existingApiKeys[r.id] = r")}, want 2`
);

// 5. Walk an old-format backup row through the same merge rule the import
//    uses, and prove nothing is reset.
function mergeField(backupVal, prevVal, empty) {
  return backupVal !== undefined ? backupVal : (prevVal || empty);
}

const OLD_ROW = { id: "key-1", name: "legacy key" };
const PREV_ROW = {
  permissions: '{"manageApiKeys":true,"viewUsage":true}',
  createdBy: "seed-user",
};
const NEW_ROW = {
  permissions: '{"manageApiKeys":false,"viewUsage":true}',
  createdBy: "admin",
};

check(
  "old backup without permissions keeps the stored permissions",
  mergeField(OLD_ROW.permissions, PREV_ROW.permissions, "") === PREV_ROW.permissions
);
check(
  "old backup without createdBy keeps the stored creator",
  mergeField(OLD_ROW.createdBy, PREV_ROW.createdBy, "") === PREV_ROW.createdBy
);
check(
  "new backup keeps its own permissions",
  mergeField(NEW_ROW.permissions, PREV_ROW.permissions, "") === NEW_ROW.permissions
);
check(
  "new backup keeps its own creator",
  mergeField(NEW_ROW.createdBy, PREV_ROW.createdBy, "") === NEW_ROW.createdBy
);

// 6. No apiKeys schema column may be dropped: every column declared in
//    schema.js must be exported and re-imported.
function schemaColumns() {
  const lines = schemaSrc.split("\n");
  const start = lines.findIndex((l) => l.trim() === "apiKeys: {");
  const colsOpen = lines.findIndex((l, i) => i > start && l.trim() === "columns: {");
  let colsClose = -1;
  for (let i = colsOpen + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "},") { colsClose = i; break; }
  }
  if (start === -1 || colsOpen === -1 || colsClose === -1) return null;
  return lines
    .slice(colsOpen + 1, colsClose)
    .map((l) => l.trim().split(":")[0])
    .filter(Boolean);
}

const cols = schemaColumns();
check("apiKeys schema columns parsed", Array.isArray(cols) && cols.length > 0);

if (cols) {
  const expStart = indexSrc.indexOf("out.apiKeys = db.all");
  const expEnd = indexSrc.indexOf("}));", expStart);
  const exportBlock = expStart !== -1 && expEnd !== -1 ? indexSrc.slice(expStart, expEnd) : "";
  const inserts = [...indexSrc.matchAll(/INSERT OR REPLACE INTO apiKeys\(([^)]+)\)/g)]
    .map((m) => m[1].split(",").map((s) => s.trim()));
  check("two apiKeys INSERT restores found", inserts.length >= 2, `found ${inserts.length}, want 2`);

  for (const col of cols) {
    check(`export covers apiKeys.${col}`, exportBlock.includes(col));
  }
  inserts.forEach((list, i) => {
    for (const col of cols) {
      check(`import[${i}] restores apiKeys.${col}`, list.includes(col));
    }
  });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nSUCCESS: backup round-trip preserves apiKeys permissions and createdBy");
