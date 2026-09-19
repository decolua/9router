#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const cliDir = path.resolve(__dirname, "..");
const appDir = path.resolve(cliDir, "..");
const rootDir = path.resolve(appDir, "..");
const cliAppDir = process.env.NINEROUTER_CLI_APP_DIR || path.join(cliDir, "app");
const buildHomeDir = path.join(cliDir, ".build-home");
const buildDistDirName = ".next-cli-build";
const buildDistDir = path.join(appDir, buildDistDirName);

// Exclude patterns for files/folders we don't want to copy. Matched against the
// entry NAME at any depth, so a state dir anywhere in the traced tree is gone.
// The runtime-state entries below are the reason this list is not just about
// size: `npm run cli:pack` redirects HOME to cli/.build-home (step 1), the Next
// build then opens its SQLite DB under it, and tracing copied the whole thing —
// jwt-secret, machine-id, live data.sqlite + WAL — into the published tarball
// (audited: T1.6 C1, seen in both 9router-0.5.75.tgz and 9router-0.5.75-enhanced.1.tgz).
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
  // --- machine state: must never reach the artifact -------------------------
  ".build-home",         // HOME/USERPROFILE redirect used by `npm run build`
  ".9router",            // app data dir (jwt-secret, machine-id, db/, backups/)
  "jwt-secret",          // session-signing key material
  "machine-id",          // machine identity (node-machine-id's dir is "node-machine-id")
  "data.sqlite",
  "*.sqlite",            // SQLite databases
  "*.sqlite-wal",        // ...and their live sidecars
  "*.sqlite-shm",
  "*.sqlite-journal",
  "9router-package-root", // launcher install pointer
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  ".git",              // repo metadata: leaks build paths, nothing needs it at runtime
];

// Paths that must not exist in the staged tree even *after* every copy step,
// matched against the POSIX-style path relative to the staged root. This is the
// release gate: an EXCLUDE entry that regresses, a new HOME redirect, or a
// source tree that already carries state all end up here, and the pack stops.
//
// Deliberately broad ("liste defensivamente"): a false positive is a loud,
// reviewable failure with an escape hatch (NINEROUTER_PACK_AUDIT_ALLOW), while a
// false negative is a published secret.
const PACK_SECRET_PATTERNS = [
  { re: /(^|\/)\.build-home(\/|$)/i, why: "build-time HOME redirect — runtime state lives under it" },
  { re: /(^|\/)\.9router(\/|$)/i, why: "9Router app data dir (jwt-secret, machine-id, SQLite, migration backups)" },
  { re: /(^|\/)9router-package-root$/, why: "launcher install pointer" },
  { re: /(^|\/)jwt-secret(\/|$)/, why: "session-signing secret" },
  { re: /(^|\/)machine-id(\/|$)/, why: "machine identity material" },
  { re: /\.sqlite(-wal|-shm|-journal)?$/i, why: "SQLite database or live sidecar" },
  { re: /(^|\/)backups(\/|$)/i, why: "backup tree (schema-migration snapshots live here)" },
  { re: /(^|\/)schema-\d+-to-\d+/i, why: "DB migration backup directory" },
  { re: /\.sql\.bak$/i, why: "database backup" },
  { re: /(^|\/)\.env(\..*)?$/, why: "environment file" },
  { re: /(^|\/)\.(npmrc|netrc|gitconfig|aws|docker|azure|gnupg|ssh)(\/|$)/i, why: "credential dotfile" },
  { re: /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/, why: "private key" },
  { re: /^\.git(\/|$)/, why: "a whole repo checkout staged as the artifact" },
  { re: /\.(key|pem|p12|pfx|bak)$/i, why: "key or backup file" },
];

// The runtime files sql.js loads by path. `main` is dist/sql-wasm.js, which
// fetches dist/sql-wasm.wasm at require time; dist/sql-asm.js is the pure-JS
// fallback for hosts without WebAssembly. Next's tracing only follows the JS
// import, so the .wasm never came along (T1.6 M3) and the shipped artifact had
// a sql.js that always threw.
const SQLJS_BUNDLE_FILES = [
  "package.json",
  "dist/sql-wasm.js",
  "dist/sql-wasm.wasm",
  "dist/sql-asm.js",
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

function toRelativePosix(rootDir, target) {
  const rel = path.relative(rootDir, target);
  return rel.split(path.sep).join("/");
}

/** Returns the reason a staged path is secret-shaped, or null when it is fine. */
function matchPackSecretPath(relPath, { allow = [] } = {}) {
  const normalized = String(relPath).split(path.sep).join("/");
  if (allow.some((entry) => entry && normalized.includes(entry))) return null;
  for (const { re, why } of PACK_SECRET_PATTERNS) {
    if (re.test(normalized)) return why;
  }
  return null;
}

/**
 * Walk a staged tree and list every secret-shaped path, relative to `rootDir`.
 * An offending directory is reported once and not descended into.
 */
function findPackSecretPaths(rootDir, { allow = [] } = {}) {
  const found = [];
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = path.join(rootDir, rel);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch (error) {
      found.push({ rel: rel || ".", why: `unreadable directory (${error.message})` });
      continue;
    }
    for (const entry of entries) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      const why = matchPackSecretPath(entryRel, { allow });
      if (why) {
        found.push({ rel: entryRel, why });
        continue;
      }
      // Symlinks are never followed here: the copy step resolves them.
      if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push(entryRel);
    }
  }
  return found.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Hard gate: refuse to ship a staged tree that carries machine state. */
function assertNoPackSecrets(rootDir, { allow = [], label = "staged CLI tree" } = {}) {
  const found = findPackSecretPaths(rootDir, { allow });
  if (found.length === 0) return { clean: true, found };
  const shown = found.slice(0, 25);
  const lines = shown.map((entry) => `  ${entry.rel}  ← ${entry.why}`);
  if (found.length > shown.length) lines.push(`  … and ${found.length - shown.length} more`);
  throw new Error(
    `PACK ABORT — ${found.length} state/secret path(s) found in the ${label} (${rootDir}):\n` +
      lines.join("\n") +
      "\nThe tarball would publish this machine's jwt-secret / machine-id / SQLite state." +
      "\nFix the copy step that let it in (EXCLUDE_PATTERNS / PACK_SECRET_PATTERNS), or waive a" +
      "\nreviewed false positive with NINEROUTER_PACK_AUDIT_ALLOW=\"substring,substring\".",
  );
}

/**
 * Copy individual runtime files a traced module needs but Next's output tracing
 * does not follow (binaries, wasm). Never trusts "the directory exists": the
 * directory was exactly the thing that lied about sql.js.
 */
function syncBundleModuleFiles({ cliAppDir, candidates = [], pkg, files = [] }) {
  const dest = path.join(cliAppDir, "node_modules", pkg);
  const destPresent = fs.existsSync(path.join(dest, "package.json"));
  const sourceRoots = candidates.filter((root) => fs.existsSync(path.join(root, pkg, "package.json")));
  if (!destPresent && sourceRoots.length === 0) {
    return { copied: [], missing: [], skipped: true };
  }

  const copied = [];
  const missing = [];
  for (const rel of files) {
    const destFile = path.join(dest, rel);
    if (fs.existsSync(destFile)) continue;
    const srcFile = sourceRoots
      .map((root) => path.join(root, pkg, rel))
      .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!srcFile) {
      missing.push(rel);
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.copyFileSync(srcFile, destFile);
      copied.push(rel);
    } catch (error) {
      missing.push(rel);
      console.warn(`⚠️  ${pkg}/${rel}: copy failed (${error.message})`);
    }
  }
  return { copied, missing, skipped: false };
}

/**
 * Stamp the artifact's own version into the staged package.json. The app's
 * package.json in the working tree is never written: root (`9router-app`) and
 * `cli/` (`9router`) are versioned independently, and rewriting the root during
 * a pack regressed the app's version in git (T1.6 H2).
 */
function stageCliVersion({ cliAppDir, version }) {
  const pkgPath = path.join(cliAppDir, "package.json");
  if (!version) return { changed: false, missing: false, skipped: "no version" };
  if (!fs.existsSync(pkgPath)) return { changed: false, missing: true, path: pkgPath };
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch (error) {
    return { changed: false, invalid: true, error: error.message, path: pkgPath };
  }
  const before = pkg.version;
  if (before === version) return { changed: false, before, after: version, path: pkgPath };
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return { changed: true, before, after: version, path: pkgPath };
}

function copyRecursive(src, dest, opts = {}) {
  const problems = opts.problems || [];
  const allow = opts.allow || [];
  // Staged root the path-shaped secret rule is measured against. Recursion
  // threads it down so nested copies still see paths relative to the artifact.
  const stagedRoot = opts.stagedRoot || dest;

  if (!fs.existsSync(src)) {
    console.warn(`Warning: Source ${src} does not exist`);
    return { copied: 0, excluded: 0, problems };
  }

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  let copied = 0;
  let excluded = 0;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldExclude(entry.name)) {
      excluded += 1;
      continue;
    }
    // Name rules miss shapes that only read as machine state in context
    // (`db/.env.production`, a stray `backups/`), so match the staged path too.
    const destPath = path.join(dest, entry.name);
    const stagedRel = toRelativePosix(stagedRoot, destPath);
    if (matchPackSecretPath(stagedRel, { allow })) {
      excluded += 1;
      // Loud on purpose: this firing outside the known state dirs is either a
      // new leak shape or a false positive eating a real bundle file.
      console.warn(`   🚫 dropped by the staged-path secret rule: ${stagedRel}`);
      continue;
    }

    const srcPath = path.join(src, entry.name);

    // Skip broken symlinks (common in workspace setups)
    try {
      fs.accessSync(srcPath);
    } catch {
      continue;
    }

    if (entry.isDirectory()) {
      const nested = copyRecursive(srcPath, destPath, { problems, allow, stagedRoot });
      copied += nested.copied;
      excluded += nested.excluded;
    } else if (entry.isSymbolicLink()) {
      // Resolve and copy target (avoid linking outside bundle)
      try {
        const real = fs.realpathSync(srcPath);
        if (fs.statSync(real).isDirectory()) {
          const nested = copyRecursive(real, destPath, { problems, allow, stagedRoot });
          copied += nested.copied;
          excluded += nested.excluded;
        } else {
          fs.copyFileSync(real, destPath);
          copied += 1;
        }
      } catch (error) {
        // Reported, never swallowed: a half-copied bundle used to be invisible.
        problems.push({ path: srcPath, error: `symlink ${error.message}` });
      }
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
        copied += 1;
      } catch (error) {
        problems.push({ path: srcPath, error: error.message });
      }
    }
  }
  return { copied, excluded, problems };
}


function resolveStandaloneBuild(appDir, buildDistDir) {
  const legacyStandaloneRoot = path.join(appDir, ".next", "standalone");
  const resolvedStandaloneRoot = path.join(buildDistDir, "standalone");
  let standaloneRoot = fs.existsSync(resolvedStandaloneRoot)
    ? resolvedStandaloneRoot
    : legacyStandaloneRoot;

  // Next.js 16 nests standalone output under the project name when
  // NEXT_TRACING_ROOT_MODE=workspace, e.g. standalone/9router/server.js.
  const pkgName = path.basename(appDir);
  const nestedRoot = path.join(standaloneRoot, pkgName);
  if (fs.existsSync(path.join(nestedRoot, "server.js")) && !fs.existsSync(path.join(standaloneRoot, "server.js"))) {
    console.log(`ℹ️  Detected nested standalone output: ${pkgName}/`);
    standaloneRoot = nestedRoot;
  }

  const standaloneApp = fs.existsSync(path.join(standaloneRoot, "server.js"))
    ? standaloneRoot
    : path.join(standaloneRoot, "app");
  if (!fs.existsSync(standaloneApp)) {
    throw new Error(
      "Next.js standalone build not found under .next/standalone; " +
      "expected either .next/standalone/server.js or .next/standalone/app/",
    );
  }

  return { standaloneApp, standaloneRoot };
}

function copyStandaloneBuild(appDir, buildDistDir, cliAppDir, opts = {}) {
  const { standaloneApp, standaloneRoot } = resolveStandaloneBuild(appDir, buildDistDir);
  const stats = copyRecursive(standaloneApp, cliAppDir, { ...opts, stagedRoot: cliAppDir });

  // Older nested-app layout stores traced node_modules at standalone root.
  const standaloneNodeModules = path.join(standaloneRoot, "node_modules");
  if (standaloneApp !== standaloneRoot && fs.existsSync(standaloneNodeModules)) {
    const nested = copyRecursive(standaloneNodeModules, path.join(cliAppDir, "node_modules"), {
      ...opts,
      stagedRoot: cliAppDir,
    });
    stats.copied += nested.copied;
    stats.excluded += nested.excluded;
  }
  return stats;
}

function mergeServerArtifacts(buildDistDir, cliAppDir, opts = {}) {
  const serverSrc = path.join(buildDistDir, "server");
  const serverDest = path.join(cliAppDir, buildDistDirName, "server");
  if (!fs.existsSync(serverSrc)) {
    throw new Error(`Complete Next.js server build not found: ${serverSrc}`);
  }
  return copyRecursive(serverSrc, serverDest, { ...opts, stagedRoot: cliAppDir });
}

function assertRequiredApiArtifacts(cliAppDir) {
  const requiredArtifacts = [
    "app/api/v1/chat/completions/route.js",
    "app/api/v1/messages/route.js",
  ];
  const serverDir = path.join(cliAppDir, buildDistDirName, "server");
  const missingArtifacts = requiredArtifacts
    .map((artifact) => path.join(serverDir, artifact))
    .filter((artifact) => !fs.existsSync(artifact));

  if (missingArtifacts.length > 0) {
    throw new Error(
      `Required CLI API route artifact${missingArtifacts.length === 1 ? " is" : "s are"} missing:\n` +
      missingArtifacts.join("\n"),
    );
  }
}

function buildCliPackage() {
  console.log("📦 Building 9Router CLI package with Next.js...\n");

  fs.mkdirSync(buildHomeDir, { recursive: true });
  fs.mkdirSync(path.join(buildHomeDir, "AppData", "Roaming"), { recursive: true });
  fs.mkdirSync(path.join(buildHomeDir, "AppData", "Local"), { recursive: true });

  // Step 0: read the artifact's version. It belongs to cli/package.json — the
  // root package.json is `9router-app`, versioned independently (CLAUDE.md),
  // and rewriting it mid-pack used to silently regress the app's version in the
  // working tree (T1.6 H2). The stamp lands on the staged copy in step 3c.
  console.log("0️⃣  Reading package version (cli/package.json)...");
  const cliPkg = JSON.parse(fs.readFileSync(path.join(cliDir, "package.json"), "utf8"));
  const appPkgPath = path.join(appDir, "package.json");
  const appPkg = JSON.parse(fs.readFileSync(appPkgPath, "utf8"));
  const copyProblems = [];
  const auditAllow = (process.env.NINEROUTER_PACK_AUDIT_ALLOW || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const copyOpts = { problems: copyProblems, allow: auditAllow, stagedRoot: cliAppDir };
  console.log(`   CLI artifact: ${cliPkg.name}@${cliPkg.version}`);
  if (appPkg.version !== cliPkg.version) {
    console.log(
      `   ℹ️  app/package.json stays at ${appPkg.version} (independent versioning; not rewritten by the pack)`,
    );
  }
  console.log("");

  // Step 1: Build app with Next.js (workspace tracing root → traced node_modules in standalone).
  // NOTE: HOME/USERPROFILE/APPDATA are redirected so a runtime state dir cannot
  // be created under the developer's real ~/.9router. Anything it does create
  // (cli/.build-home/**) is excluded from the copy and then refused by the
  // step-9 audit — never shipped.
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
        NEXT_DIST_DIR: buildDistDirName,
        NEXT_TRACING_ROOT_MODE: "workspace",
      }
    });
    console.log("✅ Next.js build completed\n");
  } catch (error) {
    console.error("❌ Next.js build failed");
    process.exit(1);
  }

  // Step 2: Clean old app/cli/app if exists
  console.log("2️⃣  Cleaning old app/cli/app...");
  if (fs.existsSync(cliAppDir)) {
    fs.rmSync(cliAppDir, { recursive: true, force: true });
  }
  console.log("✅ Cleaned\n");

  // Step 3: Copy Next.js standalone build to app/cli/app.
  // Newer Next.js standalone output writes server.js/package.json plus .next/, src/, and
  // node_modules/ directly under .next/standalone. Older builds may still use a nested app/.
  console.log("3️⃣  Copying Next.js standalone build to app/cli/app...");
  let standaloneCopy;
  try {
    standaloneCopy = copyStandaloneBuild(appDir, buildDistDir, cliAppDir, copyOpts);
  } catch (error) {
    console.error("❌ Next.js standalone build not found under .next/standalone");
    console.error("Expected either .next/standalone/server.js or .next/standalone/app/");
    process.exit(1);
  }
  console.log(`✅ Copied standalone build (${standaloneCopy.copied} files, ${standaloneCopy.excluded} excluded)\n`);

  // Step 3c: stamp the CLI version into the *staged* package.json. The app's
  // package.json in the working tree is left alone (T1.6 H2). The dashboard's
  // /api/version reads this file through a build-time JSON import, so the value
  // baked into the server chunks still comes from app/package.json — the note
  // in scripts/cutover-guard.mjs flags the split instead of papering over it.
  const stagedVersion = stageCliVersion({ cliAppDir, version: cliPkg.version });
  if (stagedVersion.changed) {
    console.log(`✅ Staged version ${stagedVersion.before} -> ${stagedVersion.after} (cli/app/package.json)\n`);
  } else if (stagedVersion.missing) {
    console.warn(`⚠️  No staged package.json at ${cliAppDir}; version not stamped\n`);
  } else {
    console.log(`✅ Staged version already ${cliPkg.version}\n`);
  }

  // Step 3a: Copy custom server (injects real socket IP, strips spoofable XFF).
  const customServerSrc = path.join(appDir, "custom-server.js");
  if (fs.existsSync(customServerSrc)) {
    fs.copyFileSync(customServerSrc, path.join(cliAppDir, "custom-server.js"));
    console.log("✅ Copied custom-server.js\n");
  } else {
    console.error("❌ custom-server.js not found — without it no request can be proven local,");
    console.error("   so the packaged CLI would demand an API key for its own dashboard and /v1.");
    process.exit(1);
  }

  // Step 3b: Ensure sql.js (pure JS fallback) bundled in app/cli/app/node_modules.
  // Strip better-sqlite3 (native) — it lives in ~/.9router/runtime to avoid
  // Windows EBUSY during global CLI updates. node:sqlite (Node ≥22.5) is also
  // available as a no-install middle tier.
  console.log("3️⃣ b Configuring SQLite drivers...");
  const moduleRoots = [path.join(appDir, "node_modules"), path.join(rootDir, "node_modules")];

  function ensureModuleInBundle(pkg, requiredFiles = []) {
    const dest = path.join(cliAppDir, "node_modules", pkg);
    if (fs.existsSync(path.join(dest, "package.json"))) {
      console.log(`✅ ${pkg} already bundled`);
    } else {
      const src = moduleRoots.find((root) => fs.existsSync(path.join(root, pkg, "package.json")));
      if (!src) {
        console.warn(`⚠️  ${pkg} not found locally — bundle will rely on node:sqlite or runtime install`);
      } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        copyRecursive(src, dest, copyOpts);
        console.log(`✅ Bundled ${pkg}`);
      }
    }

    // The directory existing never meant the module was complete: tracing had
    // already created app/node_modules/sql.js/{package.json,dist/sql-wasm.js},
    // so the old early return shipped sql.js without dist/sql-wasm.wasm and the
    // pure-JS driver threw at every start (T1.6 M3). Reconcile file by file.
    if (requiredFiles.length === 0) return { missing: [] };
    const sync = syncBundleModuleFiles({
      cliAppDir,
      candidates: moduleRoots,
      pkg,
      files: requiredFiles,
    });
    for (const rel of sync.copied) console.log(`✅ ${pkg}: added ${rel}`);
    return sync;
  }

  const sqlJsSync = ensureModuleInBundle("sql.js", SQLJS_BUNDLE_FILES);
  if (sqlJsSync.missing.length > 0) {
    console.error(`❌ sql.js would ship incomplete: ${sqlJsSync.missing.join(", ")} is in neither`);
    console.error(`   ${path.join(appDir, "node_modules", "sql.js")} nor the workspace root copy.`);
    console.error("   Run `npm install` at the app root (sql.js ships its wasm there) and repack.");
    console.error("   A half sql.js is worse than none: src/lib/db/driver.js throws on it.");
    process.exit(1);
  }
  // `open` is external (see serverExternalPackages in next.config.mjs), so it must exist in
  // the bundle's node_modules or every importer throws MODULE_NOT_FOUND at runtime. Output
  // tracing normally copies it; this is the same belt-and-braces guard used for sql.js.
  ensureModuleInBundle("open");
  const betterDir = path.join(cliAppDir, "node_modules", "better-sqlite3");
  if (fs.existsSync(betterDir)) {
    fs.rmSync(betterDir, { recursive: true, force: true });
    console.log("✅ Stripped better-sqlite3 (lives in ~/.9router/runtime)");
  }
  console.log("");

  // Step 4: Copy static files
  console.log("4️⃣  Copying static files...");
  const staticSrc = path.join(appDir, ".next", "static");
  const staticSrcResolved = path.join(buildDistDir, "static");
  const staticDest = path.join(cliAppDir, buildDistDirName, "static");
  if (fs.existsSync(staticSrcResolved) || fs.existsSync(staticSrc)) {
    copyRecursive(fs.existsSync(staticSrcResolved) ? staticSrcResolved : staticSrc, staticDest, copyOpts);
    console.log("✅ Copied static files\n");
  } else {
    console.log("⏭️  No static files found\n");
  }

  // Step 5: Copy public folder if exists
  console.log("5️⃣  Copying public folder...");
  const publicSrc = path.join(appDir, "public");
  const publicDest = path.join(cliAppDir, "public");
  if (fs.existsSync(publicSrc)) {
    copyRecursive(publicSrc, publicDest, copyOpts);
    console.log("✅ Copied public folder\n");
  } else {
    console.log("⏭️  No public folder found\n");
  }

  // Step 6: Copy vendor-chunks (required for production)
  console.log("6️⃣  Copying vendor-chunks...");
  const vendorChunksSrc = path.join(appDir, ".next", "server", "vendor-chunks");
  const vendorChunksSrcResolved = path.join(buildDistDir, "server", "vendor-chunks");
  const vendorChunksDest = path.join(cliAppDir, buildDistDirName, "server", "vendor-chunks");
  if (fs.existsSync(vendorChunksSrcResolved) || fs.existsSync(vendorChunksSrc)) {
    copyRecursive(fs.existsSync(vendorChunksSrcResolved) ? vendorChunksSrcResolved : vendorChunksSrc, vendorChunksDest, copyOpts);
    console.log("✅ Copied vendor-chunks\n");
  } else {
    console.log("⏭️  No vendor-chunks found\n");
  }

  // Step 6b: Merge the complete generated server tree. Next.js standalone output
  // is trace-pruned and can omit route modules or chunks loaded dynamically.
  console.log("6️⃣ b Copying complete server artifacts...");
  mergeServerArtifacts(buildDistDir, cliAppDir, copyOpts);
  assertRequiredApiArtifacts(cliAppDir);
  console.log("✅ Copied complete server artifacts\n");

  // Step 7: Copy MITM server files (not bundled by Next.js standalone)
  console.log("7️⃣  Copying MITM server files...");
  const mitmSrc = path.join(appDir, "src", "mitm");
  const mitmDest = path.join(cliAppDir, "src", "mitm");
  if (fs.existsSync(mitmSrc)) {
    copyRecursive(mitmSrc, mitmDest, copyOpts);
    console.log("✅ Copied MITM files\n");
  } else {
    console.log("⏭️  No MITM files found\n");
  }

  // Step 7b: Copy standalone updater (headless Node process for install progress)
  console.log("7️⃣ b Copying updater files...");
  const updaterSrc = path.join(appDir, "src", "lib", "updater");
  const updaterDest = path.join(cliAppDir, "src", "lib", "updater");
  if (fs.existsSync(updaterSrc)) {
    copyRecursive(updaterSrc, updaterDest, copyOpts);
    console.log("✅ Copied updater files\n");
  } else {
    console.log("⏭️  No updater files found\n");
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

  // Step 9: integrity gates. A pack that had to skip files is not a complete
  // bundle, and a bundle carrying machine state is not shippable at any price.
  console.log("9️⃣  Verifying package integrity...");
  if (copyProblems.length > 0) {
    console.error(`❌ ${copyProblems.length} file(s) could not be copied into the bundle:`);
    for (const problem of copyProblems.slice(0, 20)) {
      console.error(`   ${problem.path}: ${problem.error}`);
    }
    if (copyProblems.length > 20) console.error(`   … and ${copyProblems.length - 20} more`);
    console.error("A half-copied bundle turns a clean install into a mystery crash; aborting.");
    process.exit(1);
  }
  try {
    assertNoPackSecrets(cliAppDir, { allow: auditAllow, label: "staged CLI tree" });
  } catch (error) {
    console.error(`\n❌ ${error.message}`);
    process.exit(1);
  }
  console.log(
    "✅ Secret audit clean: no .build-home / .9router / jwt-secret / machine-id / *.sqlite in the staged tree\n",
  );

  console.log("✨ CLI package build completed!");
  console.log(`📁 Output: ${cliAppDir}`);

  try {
    const { execSync: exec } = require("child_process");
    const size = exec(`du -sh "${cliAppDir}"`, { encoding: "utf8" }).trim();
    console.log(`📊 Package size: ${size.split("\t")[0]}`);
  } catch (e) {
    // Silent fail on size check
  }
}

module.exports = {
  assertRequiredApiArtifacts,
  copyStandaloneBuild,
  mergeServerArtifacts,
  // Packaging integrity surface (F20): copy-time excludes, the staged-tree
  // secret audit, per-file module binary sync, and the staged version stamp.
  EXCLUDE_PATTERNS,
  PACK_SECRET_PATTERNS,
  SQLJS_BUNDLE_FILES,
  shouldExclude,
  matchPackSecretPath,
  findPackSecretPaths,
  assertNoPackSecrets,
  syncBundleModuleFiles,
  stageCliVersion,
  copyRecursive,
};

if (require.main === module) {
  buildCliPackage();
}
