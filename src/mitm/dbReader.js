// CJS reader for MITM standalone process. Reads mitmAlias from JSON cache
// at $DATA_DIR/mitm/aliases.json (synced by app from SQLite on startup + writes).
// JSON-only: no SQLite native binding required in MITM bundle.
const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./paths");
const { normalizeAliasMappings } = require("./aliasConfig");

const CACHE_FILE = path.join(DATA_DIR, "mitm", "aliases.json");

function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch { return null; }
}

function getMitmAlias(toolName) {
  const all = readCache();
  if (!all?.[toolName]) return null;
  return normalizeAliasMappings(all[toolName]);
}

module.exports = { getMitmAlias };
