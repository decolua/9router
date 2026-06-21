/**
 * generate-registry-index.mjs
 * Regenerates open-sse/providers/registry/index.js by scanning all *.js
 * files in the registry directory (excluding index.js and REGISTRY_TEMPLATE.js).
 *
 * Run: node scripts/generate-registry-index.mjs
 *
 * This script is the canonical generator for the auto-generated static import list.
 * AGENTS.md mandates regeneration via script — never hand-edit the output.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const REGISTRY_DIR = join(ROOT, "open-sse/providers/registry");
const OUTPUT = join(REGISTRY_DIR, "index.js");

// Collect all provider files (sorted alphabetically), excluding index.js and the template
const EXCLUDED = new Set(["index.js", "REGISTRY_TEMPLATE.js"]);
const files = readdirSync(REGISTRY_DIR)
  .filter(f => f.endsWith(".js") && !EXCLUDED.has(f))
  .sort();

// Build import lines
const importLines = files.map((file, i) => {
  const name = file.replace(".js", "");
  return `import p${i} from "./${name}.js";`;
});

// Build export array
const exportItems = files.map((_, i) => `  p${i},`);

const output = [
  "// Auto-generated: static imports of all registry entries",
  ...importLines,
  "",
  "export default [",
  ...exportItems,
  "];",
  "",
].join("\n");

writeFileSync(OUTPUT, output, "utf8");
console.log(`✅ Generated registry/index.js with ${files.length} providers`);
console.log("   Providers:", files.map(f => f.replace(".js", "")).join(", "));
