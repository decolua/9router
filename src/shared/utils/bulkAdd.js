// Bulk-add API-key planner.
//
// Background: the backend upserts apikey connections BY NAME
// (src/lib/db/repos/connectionsRepo.js ~L144: existing = all.find(c =>
// c.authType === "apikey" && c.name === data.name)). A colliding name
// overwrites an existing key instead of inserting a new one. Bulk-add used to
// derive "<base> <lineIndex>" from the paste position, blind to existing
// names, so re-adding keys often silently replaced earlier ones.
//
// This planner gap-fills the smallest free "<base> <n>" against both existing
// connection names and names already assigned earlier in the same batch, so a
// generated name is never reused and the backend always inserts.
//
// ponytail: only numeric-suffix collision is handled. A user who manually
// types an exact existing non-numbered custom name (no index) will still hit
// the backend upsert — but bulk auto-naming always appends " <n>", so this
// path is unreachable from the bulk modal. Upgrade path: a backend
// "skip-if-exists" flag on POST /api/providers if single-add ever needs it.

/**
 * Splits raw bulk input into individual line tokens.
 * Handles newlines as well as comma-separated keys when no pipes are present.
 * @param {string} rawText
 * @returns {string[]}
 */
export function splitBulkLines(rawText) {
  if (!rawText || typeof rawText !== "string") return [];
  const lines = rawText.split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.includes(",") && !trimmed.includes("|")) {
      const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
      result.push(...parts);
    } else {
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * Parse one pipe-separated bulk line into { baseName, apiKey, providerSpecificData? }.
 * @param {string} line
 * @param {{isCloudflareAi?: boolean, defaultBaseName?: string}} [opts]
 * @returns {{baseName: string, apiKey: string, providerSpecificData?: object}|null}
 */
function parseLine(line, opts = {}) {
  const { isCloudflareAi = false, defaultBaseName = "Key" } = opts;
  const fallbackBase = defaultBaseName?.trim() || "Key";
  if (!isCloudflareAi && /^LLM\|/i.test(line.trim())) {
    return { baseName: 'LLM', apiKey: line.trim() };
  }
  const parts = line.split("|");

  if (isCloudflareAi && parts.length >= 3) {
    // name|apiKey|accountId  (apiKey may itself contain pipes)
    const baseName = parts[0].trim();
    const apiKey = parts.slice(1, -1).join("|").trim();
    const accountId = parts[parts.length - 1].trim();
    return {
      baseName: baseName || fallbackBase,
      apiKey,
      providerSpecificData: { accountId },
    };
  }

  if (parts.length >= 2) {
    // name|apiKey  (apiKey may itself contain pipes)
    const baseName = parts[0].trim();
    const apiKey = parts.slice(1).join("|").trim();
    return { baseName: baseName || fallbackBase, apiKey };
  }

  // apiKey only — auto-named "<fallbackBase> N"
  const apiKey = parts[0].trim();
  return { baseName: fallbackBase, apiKey };
}

/**
 * Plan a bulk add: parse lines, assign collision-free "<base> <n>" names.
 *
 * @param {string[]} lines raw paste lines
 * @param {string[]|null|undefined} existingNames connection names already saved
 * @param {{isCloudflareAi?: boolean, defaultBaseName?: string, defaultModel?: string}} [opts]
 * @returns {{name: string, apiKey: string, skipped: boolean, defaultModel?: string, providerSpecificData?: object}[]}
 */
export function planBulkAdd(lines, existingNames, opts = {}) {
  const { isCloudflareAi = false, defaultBaseName = "Key", defaultModel } = opts;

  const safeExisting = Array.isArray(existingNames) ? existingNames : [];
  const used = new Set(safeExisting.map((n) => (typeof n === "string" ? n.toLowerCase() : "")));

  const out = [];
  for (const raw of lines) {
    const line = typeof raw === "string" ? raw.trim() : "";
    if (!line) continue;

    const parsed = parseLine(line, { isCloudflareAi, defaultBaseName });
    if (!parsed || !parsed.apiKey) continue;

    const base = parsed.baseName;

    // Gap-fill from 1: smallest free "<base> <n>" not in `used`.
    // O(batch * existing) — fine for bulk add (tens to low hundreds of keys).
    let idx = 1;
    let name;
    for (;;) {
      name = `${base} ${idx}`;
      if (!used.has(name.toLowerCase())) break;
      idx += 1;
    }
    used.add(name.toLowerCase());

    const entry = { name, apiKey: parsed.apiKey, skipped: false };
    if (defaultModel && typeof defaultModel === "string" && defaultModel.trim()) {
      entry.defaultModel = defaultModel.trim();
    }
    if (parsed.providerSpecificData) entry.providerSpecificData = parsed.providerSpecificData;
    out.push(entry);
  }
  return out;
}
