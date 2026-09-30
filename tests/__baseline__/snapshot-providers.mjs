// Snapshot current PROVIDERS output to JSON (run on OLD code before refactor).
// Usage: node tests/__baseline__/snapshot-providers.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PROVIDERS } from "../../open-sse/config/providers.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "providers-baseline.json");
writeFileSync(out, JSON.stringify(PROVIDERS, null, 2));
console.log(`Snapshot ${Object.keys(PROVIDERS).length} providers → ${out}`);
