#!/usr/bin/env node
/**
 * Generate CycloneDX SBOM from installed npm dependencies.
 * Usage: node scripts/generate-sbom.mjs [--output sbom.cdx.json]
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputArg = process.argv.indexOf("--output");
const outputFile = outputArg >= 0 ? process.argv[outputArg + 1] : "sbom.cdx.json";

const install = spawnSync("npm", ["install", "--ignore-scripts"], { cwd: root, stdio: "inherit", shell: true });
if (install.status !== 0) process.exit(install.status ?? 1);

const sbom = spawnSync(
  "npx",
  ["--yes", "@cyclonedx/cyclonedx-npm@latest", "--output-file", outputFile, "--spec-version", "1.5"],
  { cwd: root, stdio: "inherit", shell: true }
);
process.exit(sbom.status ?? 0);
