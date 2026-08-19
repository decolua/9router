"use strict";

const fs = require("node:fs");
const path = require("node:path");

function pnpmPackageRoot(packageName, version, storeDirs) {
  const prefix = `${packageName.replaceAll("/", "+")}@${version}`;
  for (const storeDir of storeDirs) {
    if (!fs.existsSync(storeDir)) continue;
    const entry = fs.readdirSync(storeDir)
      .find((name) => name === prefix || name.startsWith(`${prefix}_`));
    if (!entry) continue;
    const candidate = path.join(storeDir, entry, "node_modules", packageName);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return null;
}

function resolvePackage(packageName, searchPaths, storeDirs) {
  const manifestPath = require.resolve(`${packageName}/package.json`, {
    paths: searchPaths,
  });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const installedRoot = path.dirname(manifestPath);
  const sourceRoot = pnpmPackageRoot(packageName, manifest.version, storeDirs)
    || installedRoot;
  return { manifest, sourceRoot };
}

function copyRuntimePackages(packageNames, destinationNodeModules, options = {}) {
  const searchPaths = options.searchPaths || [process.cwd()];
  const storeDirs = options.storeDirs || [];
  const copiedVersions = new Map();

  function copyPackage(packageName, dependencySearchPaths) {
    const { manifest, sourceRoot } = resolvePackage(
      packageName,
      dependencySearchPaths,
      storeDirs
    );
    const copiedVersion = copiedVersions.get(packageName);
    if (copiedVersion) {
      if (copiedVersion !== manifest.version) {
        throw new Error(
          `Cannot flatten ${packageName}@${manifest.version}; ${copiedVersion} is already bundled`
        );
      }
      return;
    }
    copiedVersions.set(packageName, manifest.version);

    const destination = path.join(destinationNodeModules, packageName);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(sourceRoot, destination, { recursive: true, dereference: true });
    options.onCopy?.(packageName, manifest.version);

    for (const dependency of Object.keys(manifest.dependencies || {})) {
      copyPackage(dependency, [sourceRoot, ...searchPaths]);
    }
  }

  for (const packageName of packageNames) {
    copyPackage(packageName, searchPaths);
  }
  return copiedVersions;
}

module.exports = { copyRuntimePackages };
