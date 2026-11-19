/**
 * Script: read providersDisplay.js + providers.js, inject display+category+uiAlias+extra into each registry file.
 * Run: node scripts/injectDisplayToRegistry.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REGISTRY_DIR = path.join(ROOT, "open-sse/providers/registry");

// ── 1. Build DISPLAY map from providersDisplay.js (parse manually to avoid importing) ──
// Read the file, eval in a simple sandbox
const displaySrc = fs.readFileSync(path.join(ROOT, "src/shared/constants/providersDisplay.js"), "utf8");
const RISK_NOTICE = "⚠️ Risk Notice: This provider uses a subscription/OAuth session not officially licensed for proxy/router use. Account may be restricted or banned. Use at your own risk.";
// strip export keywords + inject RISK_NOTICE as param so no redeclaration
const displayBody = displaySrc
  .replace(/^export const /gm, "const ")
  .replace(/^export function /gm, "function ")
  .replace(/^const RISK_NOTICE\s*=.*$/m, ""); // remove redeclaration
// eslint-disable-next-line no-new-func
const getDisplay = new Function("RISK_NOTICE", `${displayBody}; return PROVIDER_DISPLAY;`);
const DISPLAY = getDisplay(RISK_NOTICE);

// ── 2. Build CATEGORY + EXTRA map from providers.js ──
// Map: providerId → { category, uiAlias, extra fields }
const CATEGORY_MAP = {};

// Read providers.js source to extract each line manually
const provSrc = fs.readFileSync(path.join(ROOT, "src/shared/constants/providers.js"), "utf8");

// Detect category blocks
const CATEGORIES = {
  free: /export const FREE_PROVIDERS\s*=\s*\{([\s\S]*?)\n\};/,
  freeTier: /export const FREE_TIER_PROVIDERS\s*=\s*\{([\s\S]*?)\n\};/,
  oauth: /export const OAUTH_PROVIDERS\s*=\s*\{([\s\S]*?)\n\};/,
  apikey: /export const APIKEY_PROVIDERS\s*=\s*\{([\s\S]*?)\n\};/,
  webCookie: /export const WEB_COOKIE_PROVIDERS\s*=\s*\{([\s\S]*?)\n\};/,
};

// Extract provider ids + uiAlias + extra fields per category
// Parse lines like: "  openai: { ...D("openai"), id: "openai", alias: "openai", ... }"
const ENTRY_RE = /^\s{2}["']?([\w-]+)["']?\s*:\s*\{[^}]*?id:\s*["']([\w-]+)["'][^}]*?alias:\s*["']([\w-]+)["']([\s\S]*?)(?=\n\s{2}["']?[\w-]|\n\};)/gm;

// Extra fields to take from providers.js (skip display, id, alias — they come from another source)
const EXTRA_FIELDS = [
  "thinkingConfig",
  "regions",
  "defaultRegion",
  "hasProviderSpecificData",
  "authType",
  "authHint",
  "passthroughModels",
  "noAuth",
  "hiddenKinds",
  "hasOAuth",
  "authModes",
];

// THINKING_CONFIG values to inline
const THINKING_CONFIG = {
  extended: { options: ["auto", "on", "off"], defaultMode: "auto", defaultBudgetTokens: 10000 },
  effort: { options: ["auto", "none", "low", "medium", "high"], defaultMode: "auto" },
};

// Parse each category block manually
for (const [cat, re] of Object.entries(CATEGORIES)) {
  const match = provSrc.match(re);
  if (!match) continue;
  const block = match[1];

  // Find all entry lines (non-comment)
  const lines = block.split("\n").filter(l => l.trim() && !l.trim().startsWith("//"));
  for (const line of lines) {
    // Extract id from id: "xxx"
    const idM = line.match(/\bid:\s*["']([\w-]+)["']/);
    // Extract uiAlias from alias: "xxx"
    const aliasM = line.match(/\balias:\s*["']([\w-]+)["']/);
    if (!idM) continue;
    const id = idM[1];
    const uiAlias = aliasM ? aliasM[1] : id;

    const extra = {};

    // thinkingConfig
    if (line.includes("THINKING_CONFIG.effort")) extra.thinkingConfig = THINKING_CONFIG.effort;
    else if (line.includes("THINKING_CONFIG.extended")) extra.thinkingConfig = THINKING_CONFIG.extended;

    // hasProviderSpecificData
    if (line.includes("hasProviderSpecificData: true")) extra.hasProviderSpecificData = true;

    // hasOAuth
    if (line.includes("hasOAuth: true")) extra.hasOAuth = true;

    // authModes
    const authModesM = line.match(/authModes:\s*(\[[^\]]+\])/);
    if (authModesM) {
      try { extra.authModes = JSON.parse(authModesM[1].replace(/'/g, '"')); } catch {}
    }

    // authType (webCookie)
    const authTypeM = line.match(/authType:\s*["']([\w-]+)["']/);
    if (authTypeM) extra.authType = authTypeM[1];

    // authHint
    const authHintM = line.match(/authHint:\s*["']([^"']+)["']/);
    if (authHintM) extra.authHint = authHintM[1];

    // noAuth
    if (line.includes("noAuth: true")) extra.noAuth = true;

    // passthroughModels
    if (line.includes("passthroughModels: true")) extra.passthroughModels = true;

    // hiddenKinds
    const hiddenKindsM = line.match(/hiddenKinds:\s*(\[[^\]]+\])/);
    if (hiddenKindsM) {
      try { extra.hiddenKinds = JSON.parse(hiddenKindsM[1].replace(/'/g, '"')); } catch {}
    }

    // regions (xiaomi-tokenplan)
    const regionsM = line.match(/regions:\s*(\[[\s\S]*?\])/);
    if (regionsM) {
      try { extra.regions = JSON.parse(regionsM[1].replace(/'/g, '"')); } catch {}
    }
    const defRegionM = line.match(/defaultRegion:\s*["']([\w-]+)["']/);
    if (defRegionM) extra.defaultRegion = defRegionM[1];

    CATEGORY_MAP[id] = { category: cat, uiAlias, extra };
  }
}

// ── 3. Inject into each registry file ──
const registryFiles = fs.readdirSync(REGISTRY_DIR)
  .filter(f => f.endsWith(".js") && f !== "index.js")
  .map(f => f.replace(".js", ""));

let injected = 0;
let skipped = 0;
const results = [];

for (const id of registryFiles) {
  const filePath = path.join(REGISTRY_DIR, `${id}.js`);
  let src = fs.readFileSync(filePath, "utf8");

  // Skip if a display field already exists
  if (src.includes("display:")) {
    skipped++;
    results.push(`⏭️  ${id} (already has display)`);
    continue;
  }

  const display = DISPLAY[id];
  const catInfo = CATEGORY_MAP[id];

  if (!display && !catInfo) {
    skipped++;
    results.push(`⚠️  ${id} (no display + no category data)`);
    continue;
  }

  // Build display block
  let displayBlock = "";
  if (display) {
    const d = { ...display };
    // Replace the RISK_NOTICE string with the const reference when serializing
    const RISK = RISK_NOTICE;
    const displayJson = JSON.stringify(d, null, 4)
      .replace(new RegExp(JSON.stringify(RISK).slice(1, -1), "g"), "RISK_NOTICE");

    displayBlock = `  display: ${displayJson.replace(/^/gm, "  ").trimStart()},\n`;
  }

  // Build category line
  const categoryLine = catInfo ? `  category: "${catInfo.category}",\n` : "";

  // Build uiAlias line (only when it differs from the routing alias)
  let uiAliasLine = "";
  if (catInfo && catInfo.uiAlias && catInfo.uiAlias !== id) {
    uiAliasLine = `  uiAlias: "${catInfo.uiAlias}",\n`;
  }

  // Build extra fields
  let extraBlock = "";
  if (catInfo && Object.keys(catInfo.extra).length > 0) {
    for (const [k, v] of Object.entries(catInfo.extra)) {
      extraBlock += `  ${k}: ${JSON.stringify(v)},\n`;
    }
  }

  // Inject AFTER the "alias:" line or at the end of the object (before the closing "};")
  const insertBlock = displayBlock + categoryLine + uiAliasLine + extraBlock;

  if (!insertBlock.trim()) {
    skipped++;
    results.push(`⏭️  ${id} (nothing to inject)`);
    continue;
  }

  // Find the position after the "alias:" field to inject
  const aliasLineRe = /^(\s+"?alias"?\s*:\s*["'][^"']+["'],?\n)/m;
  if (aliasLineRe.test(src)) {
    src = src.replace(aliasLineRe, `$1${insertBlock}`);
  } else {
    // Fallback: inject before the closing "};"
    src = src.replace(/^(\}\s*;\s*)$/m, `${insertBlock}$1`);
  }

  // Add the RISK_NOTICE import if needed
  if (insertBlock.includes("RISK_NOTICE") && !src.includes("RISK_NOTICE")) {
    const riskLine = `const RISK_NOTICE = ${JSON.stringify(RISK_NOTICE)};\n\n`;
    src = riskLine + src;
  }

  fs.writeFileSync(filePath, src);
  injected++;
  results.push(`✅ ${id}`);
}

console.log(`\n📦 Injecting display+category into registry files:`);
for (const r of results) console.log(` ${r}`);
console.log(`\n✅ Injected: ${injected}  |  ⏭️ Skipped: ${skipped}`);
