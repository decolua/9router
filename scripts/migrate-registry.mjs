/**
 * migrate-registry.mjs
 * Migrates all registry files to Model-A schema:
 *   - models[] = ALL models (chat + media), field `kind` (default "llm")
 *   - media wrapper removed → fields promoted top-level
 *   - *Config.models removed (data merged into models[])
 *   - format: terse, consistent indent
 *
 * Run: node --experimental-vm-modules migrate-registry.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = __dirname; // script lives in registry/
const DRY = process.argv.includes("--dry");

// *Config.models field → kind value
const CFG_KIND = {
  ttsConfig:          "tts",
  sttConfig:          "stt",
  embeddingConfig:    "embedding",
  imageConfig:        "image",
  imageToTextConfig:  "imageToText",
  videoConfig:        "video",
  musicConfig:        "music",
};

// Fields in *Config that are NOT models (keep on config)
const MODEL_ONLY_KEY = "models";

// Top-level registry fields that are NOT media-config (don't flatten these from media)
// serviceKinds + *Config + searchViaChat + mediaConfig + passthroughModels are media fields
// Everything else is already top-level
const MEDIA_WHITELIST = new Set([
  "serviceKinds",
  "ttsConfig", "sttConfig", "embeddingConfig",
  "imageConfig", "imageToTextConfig", "videoConfig", "musicConfig",
  "searchViaChat", "searchConfig", "fetchConfig",
  "modelsFetcher", "hasProviderSpecificData", "passthroughModels",
  "mediaPriority", "hiddenKinds",
]);

function migrateEntry(entry, filename) {
  const out = {};

  // 1. Top-level identity/transport fields (preserve order)
  const TRANSPORT_KEYS = ["id", "alias", "aliases", "uiAlias", "display", "category",
    "authType", "authHint", "authModes", "hasOAuth", "noAuth",
    "hasProviderSpecificData", "thinkingConfig", "hiddenKinds",
    "regions", "defaultRegion", "passthroughModels", "transport"];
  for (const k of TRANSPORT_KEYS) {
    if (entry[k] !== undefined) out[k] = entry[k];
  }

  // 2. Collect existing models[] (convert type→kind, skip if kind already set)
  const existingModels = (entry.models || []).map(m => {
    const { type, ...rest } = m;
    const kind = m.kind ?? (type && type !== "llm" ? type : undefined);
    return kind ? { ...rest, kind } : rest;
  });
  const existingIds = new Set(existingModels.map(m => m.id));

  // 3. Extract models from *Config.models (merge into models[])
  const mediaModels = [];
  const media = entry.media || {};
  for (const [cfgKey, kind] of Object.entries(CFG_KIND)) {
    const cfg = media[cfgKey];
    if (!cfg?.models) continue;
    for (const m of cfg.models) {
      // Check if same id+kind combo already exists to avoid true duplicates
      const dup = existingModels.find(x => x.id === m.id && (x.kind ?? "llm") === kind);
      if (dup) continue;
      const { ...mClean } = m;
      mediaModels.push({ ...mClean, kind });
    }
  }

  // 4. Merge models (existing first, then media additions)
  const allModels = [...existingModels, ...mediaModels];
  // Only include models key if non-empty or explicitly defined
  if (allModels.length > 0 || entry.models !== undefined) {
    out.models = allModels;
  }

  // 5. Flatten media fields (without .models sub-arrays)
  for (const [k, v] of Object.entries(media)) {
    if (!MEDIA_WHITELIST.has(k)) continue;
    if (CFG_KIND[k]) {
      // Strip .models from config, keep rest
      const { models: _m, ...cfgRest } = (v || {});
      if (Object.keys(cfgRest).length > 0) out[k] = cfgRest;
    } else {
      out[k] = v;
    }
  }

  // 6. Other top-level fields not in TRANSPORT_KEYS and not media (e.g. features, oauth, usage in transport)
  const SKIP = new Set([...TRANSPORT_KEYS, "models", "media", ...Object.keys(CFG_KIND),
    "serviceKinds", "searchViaChat", "searchConfig", "fetchConfig",
    "modelsFetcher", "passthroughModels", "mediaPriority"]);
  for (const [k, v] of Object.entries(entry)) {
    if (!SKIP.has(k)) out[k] = v;
  }

  return out;
}

// Format a registry entry as clean JS (no JSON.stringify — write proper ES module)
function formatValue(v, indent = 0) {
  const pad = "  ".repeat(indent);
  const pad1 = "  ".repeat(indent + 1);

  if (v === null || v === undefined) return String(v);
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);

  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    // Model arrays: 1 model per line (compact inline object)
    const items = v.map(item => {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        return `${pad1}${formatInlineObject(item)}`;
      }
      return `${pad1}${formatValue(item, indent + 1)}`;
    });
    return `[\n${items.join(",\n")},\n${pad}]`;
  }

  if (typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 0) return "{}";
    const lines = keys.map(k => {
      const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
      return `${pad1}${key}: ${formatValue(v[k], indent + 1)}`;
    });
    return `{\n${lines.join(",\n")},\n${pad}}`;
  }

  return JSON.stringify(v);
}

// Inline compact object: { id: "x", name: "y", kind: "tts", dimensions: 1536 }
function formatInlineObject(obj) {
  const parts = Object.entries(obj).map(([k, v]) => {
    const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
    return `${key}: ${JSON.stringify(v)}`;
  });
  return `{ ${parts.join(", ")} }`;
}

// Config objects (ttsConfig etc) — inline single line if short, else multi-line
function formatConfig(cfg) {
  const line = `{ ${Object.entries(cfg).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join(", ")} }`;
  if (line.length <= 120) return line;
  const pad1 = "  ".repeat(2);
  const lines = Object.entries(cfg).map(([k,v]) => `${pad1}${k}: ${JSON.stringify(v)}`);
  return `{\n${lines.join(",\n")},\n  }`;
}

// Top-level registry entry formatter
function formatEntry(entry, imports = "") {
  const lines = [];
  if (imports) lines.push(imports, "");
  lines.push("export default {");

  const TOP_ORDER = [
    "id", "alias", "aliases", "uiAlias", "display", "category",
    "authType", "authHint", "authModes", "hasOAuth", "noAuth",
    "hasProviderSpecificData", "thinkingConfig", "hiddenKinds",
    "regions", "defaultRegion", "transport",
    "models",
    // media fields
    "serviceKinds",
    "ttsConfig", "sttConfig", "embeddingConfig",
    "imageConfig", "imageToTextConfig", "videoConfig", "musicConfig",
    "searchViaChat", "searchConfig", "fetchConfig", "modelsFetcher",
    "passthroughModels", "mediaPriority",
    // other
    "oauth", "features",
  ];

  const emitted = new Set();

  function emitKey(k) {
    if (!(k in entry) || emitted.has(k)) return;
    emitted.add(k);
    const v = entry[k];
    const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);

    // Config objects (xConfig) — special inline format
    if (CFG_KIND[k] || k === "searchViaChat" || k === "searchConfig" || k === "fetchConfig" || k === "modelsFetcher") {
      lines.push(`  ${key}: ${formatConfig(v)},`);
      return;
    }

    // models[] — terse per-line
    if (k === "models" && Array.isArray(v)) {
      if (v.length === 0) { lines.push(`  models: [],`); return; }
      lines.push(`  models: [`);
      for (const m of v) lines.push(`    ${formatInlineObject(m)},`);
      lines.push(`  ],`);
      return;
    }

    // serviceKinds — inline array
    if (k === "serviceKinds") {
      lines.push(`  serviceKinds: ${JSON.stringify(v)},`);
      return;
    }

    // display — multi-line
    if (k === "display") {
      lines.push(`  display: ${formatValue(v, 1)},`);
      return;
    }

    // transport — multi-line
    if (k === "transport") {
      lines.push(`  transport: ${formatValue(v, 1)},`);
      return;
    }

    // Everything else
    lines.push(`  ${key}: ${formatValue(v, 1)},`);
  }

  for (const k of TOP_ORDER) emitKey(k);
  // Emit any remaining keys not in TOP_ORDER
  for (const k of Object.keys(entry)) emitKey(k);

  lines.push("};");
  return lines.join("\n") + "\n";
}

// --- Main ---
const files = readdirSync(REGISTRY_DIR).filter(f => f.endsWith(".js") && f !== "index.js");
let count = 0;

for (const file of files) {
  const path = join(REGISTRY_DIR, file);
  const src = readFileSync(path, "utf8");

  // Extract import lines (for files that import shared constants)
  const importLines = src.split("\n").filter(l => l.startsWith("import "));
  const importSrc = importLines.join("\n");

  // Dynamic import to get entry
  let entry;
  try {
    const mod = await import(`${join(REGISTRY_DIR, file)}?t=${Date.now()}`);
    entry = mod.default;
  } catch (e) {
    console.error(`SKIP ${file}: ${e.message}`);
    continue;
  }

  const migrated = migrateEntry(entry, file);
  const output = formatEntry(migrated, importSrc);

  if (DRY) {
    console.log(`\n=== ${file} ===\n${output}`);
  } else {
    writeFileSync(path, output, "utf8");
    count++;
  }
}

console.log(DRY ? `[DRY] Would migrate ${files.length} files` : `✅ Migrated ${count} files`);
