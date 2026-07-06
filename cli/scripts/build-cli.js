#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const cliDir = path.resolve(__dirname, "..");
const appDir = path.resolve(cliDir, "..");
const rootDir = path.resolve(appDir, "..");
const cliAppDir = path.join(cliDir, "app");
const buildHomeDir = path.join(cliDir, ".build-home");

// Exclude patterns for files/folders we don't want to copy
const EXCLUDE_PATTERNS = [
  "@img",           // Sharp image processing (not needed with unoptimized images)
  "sharp",          // Sharp core lib (not needed with unoptimized images)
  "detect-libc",    // Sharp dependency
  ".env",           // Environment files
  ".env.local",
  ".env.*.local",
  "*.log",          // Log files
  "tmp",            // Temp files
  ".DS_Store",      // macOS files
];

function shouldExclude(name) {
  return EXCLUDE_PATTERNS.some(pattern => {
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      return regex.test(name);
    }
    return name === pattern;
  });
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`Warning: Source ${src} does not exist`);
    return;
  }
  
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldExclude(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip broken symlinks (common in workspace setups)
    try {
      fs.accessSync(srcPath);
    } catch {
      continue;
    }

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      // Resolve and copy target (avoid linking outside bundle)
      try {
        const real = fs.realpathSync(srcPath);
        if (fs.statSync(real).isDirectory()) {
          copyRecursive(real, destPath);
        } else {
          fs.copyFileSync(real, destPath);
        }
      } catch {}
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch {}
    }
  }
}

console.log("📦 Building 9Router CLI package with Next.js...\n");

// === Aggressive clean for reliable standalone builds ===
// Always build into normal .next (Best Fix: custom distDir + workspace tracing
// produces empty/incomplete standalone output in Next.js 16 + Bun/monorepo).
// Clean .next + other artifacts for a pristine build.
console.log("🧹 Cleaning previous build artifacts (aggressive clean for CLI build)...");
const dirsToClean = [
  buildHomeDir,
  cliAppDir,
  path.join(appDir, ".next"),           // Normal .next — guarantees clean standalone
];
for (const dir of dirsToClean) {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`   ✓ Removed ${path.relative(process.cwd(), dir)}`);
    } catch (e) {
      console.warn(`   ⚠️  Failed to remove ${dir}: ${e.message}`);
    }
  }
}
console.log("✅ Cleaned previous build artifacts\n");

fs.mkdirSync(buildHomeDir, { recursive: true });
fs.mkdirSync(path.join(buildHomeDir, "AppData", "Roaming"), { recursive: true });
fs.mkdirSync(path.join(buildHomeDir, "AppData", "Local"), { recursive: true });

// Step 0: Sync version from app/cli/package.json to app/package.json
console.log("0️⃣  Syncing version to app/package.json...");
const cliPkg = JSON.parse(fs.readFileSync(path.join(cliDir, "package.json"), "utf8"));
const appPkgPath = path.join(appDir, "package.json");
const appPkg = JSON.parse(fs.readFileSync(appPkgPath, "utf8"));
if (appPkg.version !== cliPkg.version) {
  appPkg.version = cliPkg.version;
  fs.writeFileSync(appPkgPath, JSON.stringify(appPkg, null, 2) + "\n");
  console.log(`✅ Version synced: ${cliPkg.version}\n`);
} else {
  console.log(`✅ Version already synced: ${cliPkg.version}\n`);
}

// Step 1: Build app with Next.js (workspace tracing root → traced node_modules in standalone).
console.log("1️⃣  Building Next.js app...");
try {
  execSync("npm run build", {
    stdio: "inherit",
    cwd: appDir,
    env: {
      ...process.env,
      HOME: buildHomeDir,
      USERPROFILE: buildHomeDir,
      APPDATA: path.join(buildHomeDir, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(buildHomeDir, "AppData", "Local"),
      NEXT_TRACING_ROOT_MODE: "workspace",
    }
  });
  console.log("✅ Next.js build completed\n");
} catch (error) {
  console.error("❌ Next.js build failed");
  process.exit(1);
}

// Step 2: Copy Next.js standalone build to cli/app
// (Best Fix: normal .next/standalone + robust detection for workspace tracing layout)
console.log("2️⃣  Copying Next.js standalone build to app/cli/app...");

const standaloneRoot = path.join(appDir, ".next", "standalone");

/**
 * Robust finder for the directory containing server.js inside the standalone output.
 * When NEXT_TRACING_ROOT_MODE=workspace is used, Next.js nests the output under
 * the relative project folder (e.g. .next/standalone/9router/server.js).
 */
function findStandaloneServerRoot(root) {
  // 1. Direct hit (classic layout)
  if (fs.existsSync(path.join(root, "server.js"))) {
    return root;
  }

  // 2. Common with workspace tracingRoot: project name subfolder
  //    e.g. standalone/9router/server.js or standalone/<basename>/server.js
  if (fs.existsSync(root)) {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(root, entry.name);
      if (fs.existsSync(path.join(candidate, "server.js"))) {
        return candidate;
      }
      // Sometimes another level (e.g. 9router/app)
      const nestedApp = path.join(candidate, "app");
      if (fs.existsSync(path.join(nestedApp, "server.js"))) {
        return nestedApp;
      }
    }
  }

  // 3. Legacy nested-app layout
  const legacyApp = path.join(root, "app");
  if (fs.existsSync(path.join(legacyApp, "server.js"))) {
    return legacyApp;
  }

  return null;
}

const standaloneApp = findStandaloneServerRoot(standaloneRoot);

if (!standaloneApp) {
  console.error("\n❌ Next.js standalone build not found (server.js missing inside standalone tree).");
  console.error("Looked under: " + standaloneRoot);

  // Rich diagnostics — this is the key information when workspace tracing is active
  console.error("\n📁 Contents of .next/standalone:");
  try {
    const st = fs.readdirSync(standaloneRoot);
    console.error("  " + JSON.stringify(st, null, 2));
  } catch (e) {
    console.error("  (could not read standalone dir: " + e.message + ")");
  }

  console.error("\n🔍 Searching for any server.js under .next/standalone:");
  try {
    const { execSync } = require("child_process");
    const found = execSync(`find "${standaloneRoot}" -name server.js 2>/dev/null | head -10`, { encoding: "utf8" }).trim();
    console.error(found ? found : "  (no server.js found anywhere under standalone)");
  } catch {
    console.error("  (find command failed)");
  }

  console.error("\n📁 Top-level .next contents (for context):");
  console.error("  " + JSON.stringify(
    fs.existsSync(path.join(appDir, ".next")) ? fs.readdirSync(path.join(appDir, ".next")) : [],
    null, 2
  ));

  console.error("\n💡 Likely cause:");
  console.error("   Workspace tracing (NEXT_TRACING_ROOT_MODE=workspace) causes Next.js to nest");
  console.error("   the standalone output under a project subfolder (e.g. standalone/9router/).");
  console.error("   The finder above should have caught it — if you still see this, the build");
  console.error("   may have produced an incomplete standalone tree.");

  console.error("\n💡 Possible fixes:");
  console.error("   • rm -rf .next cli/app && bun run cli:build   (clean + retry)");
  console.error("   • Check the diagnostics above for the real location of server.js");

  process.exit(1);
}

console.log(`   → Found standalone server root: ${path.relative(appDir, standaloneApp)}`);
copyRecursive(standaloneApp, cliAppDir);

// Copy traced node_modules if they live at the standalone root level (older layout)
const standaloneNodeModules = path.join(standaloneRoot, "node_modules");
if (standaloneApp !== standaloneRoot && fs.existsSync(standaloneNodeModules)) {
  copyRecursive(standaloneNodeModules, path.join(cliAppDir, "node_modules"));
}
console.log("✅ Copied standalone build\n");

// Step 3a: Copy custom server (injects real socket IP, strips spoofable XFF).
const customServerSrc = path.join(appDir, "custom-server.js");
if (fs.existsSync(customServerSrc)) {
  fs.copyFileSync(customServerSrc, path.join(cliAppDir, "custom-server.js"));
  console.log("✅ Copied custom-server.js\n");
} else {
  console.warn("⚠️  custom-server.js not found — server will run without real-IP injection\n");
}

// Step 3b: Ensure sql.js (pure JS fallback) bundled in app/cli/app/node_modules.
// Strip better-sqlite3 (native) — it lives in ~/.9router/runtime to avoid
// Windows EBUSY during global CLI updates. node:sqlite (Node ≥22.5) is also
// available as a no-install middle tier.
console.log("3️⃣ b Configuring SQLite drivers...");
function ensureModuleInBundle(pkg) {
  const dest = path.join(cliAppDir, "node_modules", pkg);
  if (fs.existsSync(dest)) {
    console.log(`✅ ${pkg} already bundled`);
    return;
  }
  const candidates = [
    path.join(appDir, "node_modules", pkg),
    path.join(rootDir, "node_modules", pkg),
  ];
  const src = candidates.find((p) => fs.existsSync(p));
  if (!src) {
    console.warn(`⚠️  ${pkg} not found locally — bundle will rely on node:sqlite or runtime install`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyRecursive(src, dest);
  console.log(`✅ Bundled ${pkg}`);
}
ensureModuleInBundle("sql.js");
const betterDir = path.join(cliAppDir, "node_modules", "better-sqlite3");
if (fs.existsSync(betterDir)) {
  fs.rmSync(betterDir, { recursive: true, force: true });
  console.log("✅ Stripped better-sqlite3 (lives in ~/.9router/runtime)");
}
console.log("");

// Step 4: Copy static files
// (into .next/static relative to the standalone server.js inside cli/app)
console.log("4️⃣  Copying static files...");
const staticSrc = path.join(appDir, ".next", "static");
const staticDest = path.join(cliAppDir, ".next", "static");
if (fs.existsSync(staticSrc)) {
  copyRecursive(staticSrc, staticDest);
  console.log("✅ Copied static files\n");
} else {
  console.log("⏭️  No static files found\n");
}

// Step 5: Copy public folder if exists
console.log("5️⃣  Copying public folder...");
const publicSrc = path.join(appDir, "public");
const publicDest = path.join(cliAppDir, "public");
if (fs.existsSync(publicSrc)) {
  copyRecursive(publicSrc, publicDest);
  console.log("✅ Copied public folder\n");
} else {
  console.log("⏭️  No public folder found\n");
}

// Step 6: Copy vendor-chunks (required for production)
// (into .next/server/vendor-chunks relative to the standalone server.js)
console.log("6️⃣  Copying vendor-chunks...");
const vendorChunksSrc = path.join(appDir, ".next", "server", "vendor-chunks");
const vendorChunksDest = path.join(cliAppDir, ".next", "server", "vendor-chunks");
if (fs.existsSync(vendorChunksSrc)) {
  copyRecursive(vendorChunksSrc, vendorChunksDest);
  console.log("✅ Copied vendor-chunks\n");
} else {
  console.log("⏭️  No vendor-chunks found\n");
}

// Step 7: Copy MITM server files (not bundled by Next.js standalone)
console.log("7️⃣  Copying MITM server files...");
const mitmSrc = path.join(appDir, "src", "mitm");
const mitmDest = path.join(cliAppDir, "src", "mitm");
if (fs.existsSync(mitmSrc)) {
  copyRecursive(mitmSrc, mitmDest);
  console.log("✅ Copied MITM files\n");
} else {
  console.log("⏭️  No MITM files found\n");
}

// Step 7b: Copy standalone updater (headless Node process for install progress)
console.log("7️⃣ b Copying updater files...");
const updaterSrc = path.join(appDir, "src", "lib", "updater");
const updaterDest = path.join(cliAppDir, "src", "lib", "updater");
if (fs.existsSync(updaterSrc)) {
  copyRecursive(updaterSrc, updaterDest);
  console.log("✅ Copied updater files\n");
} else {
  console.log("⏭️  No updater files found\n");
}

// Step 7c: Copy crashLogger for the outer CLI manager process (cli/cli.js)
// This file lives in the main src/ but the thin CLI wrapper needs it too.
// We place it under cli/src/lib/ so that after packing, require("./src/lib/crashLogger.js")
// works both from source (after build) and in the published npm package.
console.log("7️⃣ c Copying crash logger for CLI wrapper...");
const crashLoggerSrc = path.join(appDir, "src", "lib", "crashLogger.js");
const crashLoggerDestDir = path.join(cliDir, "src", "lib");
const crashLoggerDest = path.join(crashLoggerDestDir, "crashLogger.js");
try {
  if (fs.existsSync(crashLoggerSrc)) {
    fs.mkdirSync(crashLoggerDestDir, { recursive: true });
    fs.copyFileSync(crashLoggerSrc, crashLoggerDest);
    console.log("✅ Copied crashLogger.js to cli/src/lib/\n");
  } else {
    console.log("⏭️  No crashLogger.js found in main src/\n");
  }
} catch (e) {
  console.warn("⚠️  Failed to copy crashLogger:", e.message);
}

// Step 8: Build MITM server (config driven - see app/cli/scripts/buildMitm.js)
console.log("8️⃣  Building MITM server...");
try {
  execSync("node scripts/buildMitm.js", { stdio: "inherit", cwd: cliDir });
  console.log("✅ MITM server build completed\n");
} catch (error) {
  console.error("❌ MITM build failed");
  process.exit(1);
}

console.log("✨ CLI package build completed!");
console.log(`📁 Output: ${cliAppDir}`);

try {
  const { execSync: exec } = require("child_process");
  const size = exec(`du -sh "${cliAppDir}"`, { encoding: "utf8" }).trim();
  console.log(`📊 Package size: ${size.split("\t")[0]}`);
} catch (e) {
  // Silent fail on size check
}
