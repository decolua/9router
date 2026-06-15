#!/usr/bin/env node
/**
 * Generate OSS license register for enterprise security reviews.
 * Output: docs/security/oss-license-register.generated.json
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "docs", "security");
const outFile = path.join(outDir, "oss-license-register.generated.json");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const APPROVED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Unlicense"]);
const REVIEW_REQUIRED = new Set(["LGPL-2.0", "LGPL-2.1", "LGPL-3.0", "MPL-2.0"]);
const NOT_ALLOWED = new Set(["GPL-2.0", "GPL-3.0", "AGPL-3.0", "SSPL-1.0"]);

function classify(license) {
  const normalized = String(license || "UNKNOWN").trim();
  if (APPROVED.has(normalized)) return "approved";
  if (REVIEW_REQUIRED.has(normalized)) return "review_required";
  if (NOT_ALLOWED.has(normalized)) return "not_allowed";
  return "review_required";
}

spawnSync("npm", ["install", "--ignore-scripts"], { cwd: root, stdio: "pipe", shell: true });

const ls = spawnSync("npm", ["ls", "--all", "--json", "--omit=dev"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});

let tree = {};
try {
  tree = JSON.parse(ls.stdout || "{}");
} catch {
  tree = {};
}

const components = [];
const seen = new Set();

function walk(node, depth = 0) {
  if (!node || depth > 50) return;
  const name = node.name;
  const version = node.version;
  if (name && version) {
    const key = `${name}@${version}`;
    if (!seen.has(key)) {
      seen.add(key);
      const license = node.license || (Array.isArray(node.licenses) ? node.licenses[0]?.type : null) || "UNKNOWN";
      components.push({
        component: name,
        version,
        license,
        classification: classify(license),
      });
    }
  }
  for (const dep of Object.values(node.dependencies || {})) walk(dep, depth + 1);
}

components.unshift({
  component: pkg.name,
  version: pkg.version,
  license: "MIT",
  classification: "approved",
});

walk(tree);

components.sort((a, b) => a.component.localeCompare(b.component));

const register = {
  generatedAt: new Date().toISOString(),
  application: { name: pkg.name, version: pkg.version, license: "MIT" },
  approvedLicenses: [...APPROVED],
  reviewRequiredLicenses: [...REVIEW_REQUIRED],
  notAllowedLicenses: [...NOT_ALLOWED],
  components,
  summary: {
    total: components.length,
    approved: components.filter((c) => c.classification === "approved").length,
    reviewRequired: components.filter((c) => c.classification === "review_required").length,
    notAllowed: components.filter((c) => c.classification === "not_allowed").length,
  },
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(register, null, 2));
console.log(`Wrote ${outFile} (${register.summary.total} components)`);

if (register.summary.notAllowed > 0) {
  console.error("ERROR: disallowed licenses detected");
  process.exit(1);
}
