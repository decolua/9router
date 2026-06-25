#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, "docs/custom-features.manifest.json");

const results = [];

function record(status, scope, message) {
  results.push({ status, scope, message });
}

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function checkFile(relativePath, scope) {
  const fullPath = path.join(repoRoot, relativePath);
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    record("FAIL", scope, `missing file: ${relativePath}`);
    return false;
  }
  record("PASS", scope, `file exists: ${relativePath}`);
  return true;
}

function checkDirectory(relativePath, scope) {
  const fullPath = path.join(repoRoot, relativePath);
  if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) {
    record("FAIL", scope, `missing directory: ${relativePath}`);
    return false;
  }
  record("PASS", scope, `directory exists: ${relativePath}`);
  return true;
}

function checkPattern(entry, scope, severity = "FAIL") {
  if (!checkFile(entry.file, scope)) return false;
  const content = readText(entry.file);
  const regexp = new RegExp(entry.pattern, "m");
  if (!regexp.test(content)) {
    record(severity, scope, `pattern not found in ${entry.file}: ${entry.pattern}`);
    return false;
  }
  record("PASS", scope, `pattern found in ${entry.file}: ${entry.pattern}`);
  return true;
}

function runCommand(command, args, scope) {
  const child = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (child.status !== 0) {
    const output = `${child.stdout || ""}${child.stderr || ""}`.trim();
    record("FAIL", scope, `${command} ${args.join(" ")} failed${output ? `: ${output}` : ""}`);
    return false;
  }

  record("PASS", scope, `${command} ${args.join(" ")} passed`);
  return true;
}

function checkConflictMarkers() {
  const targets = ["src", "open-sse", "cli", "docs", ".github", "scripts"];
  const child = spawnSync("git", ["ls-files", "--", ...targets], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (child.status !== 0) {
    record("FAIL", "conflict-markers", `git ls-files failed: ${(child.stderr || child.stdout).trim()}`);
    return false;
  }

  const matches = [];
  for (const file of child.stdout.split("\n").filter(Boolean)) {
    const fullPath = path.join(repoRoot, file);
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) continue;
    const lines = readFileSync(fullPath, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (/^(<<<<<<<|=======|>>>>>>>)($|[ <=>])/.test(line)) {
        matches.push(`${file}:${index + 1}:${line}`);
      }
    });
  }

  if (matches.length > 0) {
    record("FAIL", "conflict-markers", `conflict markers found:\n${matches.join("\n")}`);
    return false;
  }

  record("PASS", "conflict-markers", "no conflict markers found");
  return true;
}

function checkGitignore() {
  const child = spawnSync("git", ["check-ignore", "-q", "docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (child.status === 0) {
    const status = spawnSync("git", ["ls-files", "--error-unmatch", "docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (status.status !== 0) {
      record("FAIL", "gitignore", "docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md is ignored and not tracked");
      return false;
    }
  }

  record("PASS", "gitignore", "custom checklist remains trackable");
  return true;
}

if (!existsSync(manifestPath)) {
  console.error(`FAIL manifest missing: ${manifestPath}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  console.error(`FAIL invalid manifest JSON: ${error.message}`);
  process.exit(1);
}

record("PASS", "manifest", `loaded ${manifest.features?.length || 0} custom feature definitions`);
checkConflictMarkers();
checkGitignore();

for (const feature of manifest.features || []) {
  const scope = feature.id;

  for (const file of feature.requiredFiles || []) {
    checkFile(file, scope);
  }

  for (const directory of feature.requiredDirectories || []) {
    checkDirectory(directory, scope);
  }

  for (const pattern of feature.requiredPatterns || []) {
    checkPattern(pattern, scope, "FAIL");
  }

  for (const pattern of feature.warningPatterns || []) {
    checkPattern(pattern, scope, "WARN");
  }

  for (const invariant of feature.invariants || []) {
    checkPattern(invariant, `${scope}:invariant`, invariant.severity || "FAIL");
  }

  for (const file of feature.syntaxCheck || []) {
    if (checkFile(file, scope)) {
      runCommand("node", ["--check", file], scope);
    }
  }
}

const counts = results.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, {});

for (const item of results) {
  console.log(`${item.status.padEnd(4)} [${item.scope}] ${item.message}`);
}

console.log("\nSummary:");
console.log(`PASS: ${counts.PASS || 0}`);
console.log(`WARN: ${counts.WARN || 0}`);
console.log(`FAIL: ${counts.FAIL || 0}`);

if (counts.WARN) {
  console.log("\nWarnings indicate documented custom behavior may be incomplete or partially implemented. Review before pushing after upstream rebase.");
}

process.exit(counts.FAIL ? 1 : 0);
