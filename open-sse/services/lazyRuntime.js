// Lazy loader for heavy optional runtime deps (playwright-core, wreq-js).
//
// They are devDependencies only, so end-user installs stay small. On first
// use the package is downloaded into <DATA_DIR>/runtime (same pattern as
// cli/hooks/sqliteRuntime.js) and imported from there. Resolution order:
// app node_modules (dev / traced standalone) → runtime dir → npm install.
//
// Never throws at import time of THIS module — failures surface from
// loadRuntimeDep() with a manual-install hint.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getWritableDataDir } from "../utils/writableDataDir.js";

// Keep in sync with package.json devDependencies.
const LAZY_DEP_VERSIONS = {
  "playwright-core": "^1.62.1",
  "wreq-js": "^3.2.0",
};

function getRuntimeDir() {
  return path.join(getWritableDataDir(), "runtime");
}

function isModuleMissing(error) {
  const code = String(error?.code || "");
  return code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";
}

function getNativeRequire(dir) {
  let cr;
  try {
    if (typeof process !== "undefined" && typeof process.getBuiltinModule === "function") {
      cr = process.getBuiltinModule("node:module")?.createRequire;
    }
  } catch {}
  if (!cr) {
    try {
      cr = eval("require")("node:module")?.createRequire;
    } catch {}
  }
  return cr ? cr(path.join(dir, "package.json")) : null;
}

function resolvePackagePath(pkg, dir) {
  const req = getNativeRequire(dir);
  if (req) {
    try {
      return req.resolve(pkg);
    } catch {}
  }
  const pkgDir = path.join(dir, "node_modules", pkg);
  const pjPath = path.join(pkgDir, "package.json");
  if (fs.existsSync(pjPath)) {
    try {
      const pj = JSON.parse(fs.readFileSync(pjPath, "utf-8"));
      const entry = (typeof pj.exports === "string" ? pj.exports : null)
        || pj.exports?.["."]?.import
        || pj.exports?.["."]?.default
        || pj.exports?.default
        || pj.main
        || "index.js";
      return path.resolve(pkgDir, entry);
    } catch {}
  }
  return null;
}

async function dynamicImport(specifier) {
  // Use new Function to bypass webpack static import interception
  const importer = new Function("u", "return import(u)");
  return importer(specifier);
}

function npmInstall(pkg, version) {
  const cwd = getRuntimeDir();
  fs.mkdirSync(cwd, { recursive: true });
  const pj = path.join(cwd, "package.json");
  if (!fs.existsSync(pj)) {
    try {
      fs.writeFileSync(pj, JSON.stringify({ name: "9router-runtime", private: true }, null, 2));
    } catch {}
  }
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = ["install", "--no-audit", "--no-fund", "--prefer-online", `${pkg}@${version}`];
  return new Promise((resolve) => {
    const child = spawn(npm, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => resolve({ ok: false, stderr: String(error.message || error) }));
    child.on("close", (status) => resolve({ ok: status === 0, stderr }));
  });
}

const inflight = new Map();

async function load(pkg) {
  // 1) Resolvable from the app install (dev machine / traced standalone).
  try {
    return await dynamicImport(pkg);
  } catch (error) {
    if (!isModuleMissing(error)) throw error;
  }
  // 2) Already present in the runtime dir from a previous install.
  const runtimeDir = getRuntimeDir();
  const existingPath = resolvePackagePath(pkg, runtimeDir);
  if (existingPath) {
    try {
      return await dynamicImport(pathToFileURL(existingPath).href);
    } catch (error) {
      if (!isModuleMissing(error)) throw error;
    }
  }
  // 3) Download on demand, then import from the runtime dir.
  const version = LAZY_DEP_VERSIONS[pkg] || "latest";
  const res = await npmInstall(pkg, version);
  if (!res.ok) {
    const reason = (res.stderr.match(/npm ERR! ?(.+)/) || [])[1] || res.stderr.split("\n").filter(Boolean).pop() || "unknown npm error";
    throw new Error(
      `${pkg} is missing and the on-demand install failed (${String(reason).slice(0, 160)}) — ` +
      `install it manually: cd "${runtimeDir}" && npm install ${pkg}@${version}`
    );
  }
  const installedPath = resolvePackagePath(pkg, runtimeDir);
  if (installedPath) {
    return dynamicImport(pathToFileURL(installedPath).href);
  }
  throw new Error(`${pkg} was installed in ${runtimeDir} but its entry point could not be resolved`);
}

export function loadRuntimeDep(pkg) {
  if (!inflight.has(pkg)) {
    inflight.set(pkg, load(pkg).finally(() => inflight.delete(pkg)));
  }
  return inflight.get(pkg);
}
