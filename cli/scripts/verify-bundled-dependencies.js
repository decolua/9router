#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(packageRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const bundledDependencies = packageJson.bundleDependencies;
const runtimeDependencies = Object.keys(packageJson.dependencies || {});

if (!Array.isArray(bundledDependencies) || bundledDependencies.length === 0) {
  console.error("bundleDependencies must list the runtime dependencies shipped in the npm tarball.");
  process.exit(1);
}

const unbundled = runtimeDependencies.filter(
  (dependency) => !bundledDependencies.includes(dependency)
);
if (unbundled.length > 0) {
  console.error(
    `Cannot pack 9router: runtime dependencies are not bundled: ${unbundled.join(", ")}.`
  );
  process.exit(1);
}

const missing = bundledDependencies.filter((dependency) => {
  const manifest = path.join(packageRoot, "node_modules", dependency, "package.json");
  return !fs.existsSync(manifest);
});

if (missing.length > 0) {
  console.error(
    `Cannot pack 9router: bundled runtime dependencies are missing: ${missing.join(", ")}. ` +
      "Run npm install in cli/ before packing or publishing."
  );
  process.exit(1);
}

console.error(`Verified bundled runtime dependencies: ${bundledDependencies.join(", ")}`);
