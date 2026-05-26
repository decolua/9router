#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const cliDir = path.resolve(__dirname, "..");
const appDir = path.resolve(cliDir, "..");
const tmpDir = path.join(appDir, ".pack-tmp");

const cliPkg = JSON.parse(fs.readFileSync(path.join(cliDir, "package.json"), "utf8"));
const version = cliPkg.version;
const baseTgz = path.join(appDir, `9router-${version}.tgz`);

if (!fs.existsSync(baseTgz)) {
  console.error(`❌ Base package not found: ${baseTgz}`);
  console.error("Run 'npm run pack:cli' first to generate the base package.");
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function addNativeModules(stagingDir, platform) {
  const nodeModulesDir = path.join(stagingDir, "package", "app", "node_modules");
  fs.mkdirSync(nodeModulesDir, { recursive: true });

  // Add better-sqlite3
  const bsSrc = path.join(appDir, "node_modules", "better-sqlite3");
  const bsDest = path.join(nodeModulesDir, "better-sqlite3");
  if (fs.existsSync(bsSrc)) {
    copyRecursive(bsSrc, bsDest);
    // For windows, strip the .node binary (will be installed at runtime)
    if (platform === "windows") {
      const nodeFile = path.join(bsDest, "build", "Release", "better_sqlite3.node");
      if (fs.existsSync(nodeFile)) fs.unlinkSync(nodeFile);
      const buildDir = path.join(bsDest, "build");
      if (fs.existsSync(buildDir)) fs.rmSync(buildDir, { recursive: true, force: true });
    }
    console.log(`  ✅ Added better-sqlite3 (${platform})`);
  } else {
    console.warn(`  ⚠️  better-sqlite3 not found in ${appDir}/node_modules`);
  }

  // Add sharp + platform-specific native bindings
  if (platform === "linux-x64") {
    for (const mod of ["sharp", "@img/colour", "@img/sharp-linux-x64", "@img/sharp-libvips-linux-x64"]) {
      const src = path.join(appDir, "node_modules", mod);
      const dest = path.join(nodeModulesDir, mod);
      if (fs.existsSync(src)) {
        copyRecursive(src, dest);
        console.log(`  ✅ Added ${mod}`);
      }
    }
  }
  // Windows: sharp not included (will be installed at runtime if needed)
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.name === ".git" || entry.name === "test" || entry.name === "tests") continue;
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      try { fs.copyFileSync(srcPath, destPath); } catch {}
    }
  }
}

// Clean up
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

// Step 1: Extract base tgz
console.log(`📦 Building platform packages for v${version}...\n`);
console.log("1️⃣  Extracting base package...");
run(`tar xzf "${baseTgz}" -C "${tmpDir}"`);

// Step 2: Build linux-x64 package
console.log("\n2️⃣  Building linux-x64 package...");
const linuxStaging = path.join(tmpDir, "linux-x64");
fs.mkdirSync(linuxStaging, { recursive: true });
run(`cp -r "${tmpDir}/package" "${linuxStaging}/package"`);
addNativeModules(linuxStaging, "linux-x64");

const linuxTgz = path.join(appDir, `9router-${version}-linux-x64.tgz`);
run(`tar czf "${linuxTgz}" -C "${linuxStaging}" package`);
console.log(`  ✅ Created: ${linuxTgz}`);

// Step 3: Build windows package
console.log("\n3️⃣  Building windows package...");
const winStaging = path.join(tmpDir, "windows");
fs.mkdirSync(winStaging, { recursive: true });
run(`cp -r "${tmpDir}/package" "${winStaging}/package"`);
addNativeModules(winStaging, "windows");

const winTgz = path.join(appDir, `9router-${version}-windows.tgz`);
run(`tar czf "${winTgz}" -C "${winStaging}" package`);
console.log(`  ✅ Created: ${winTgz}`);

// Step 4: Build app package (full project)
console.log("\n4️⃣  Building app package...");
const appTgz = path.join(appDir, `9router-app-${version}.tgz`);
run(`npm pack --pack-destination "${appDir}"`, { cwd: appDir });
// npm pack generates 9router-app-{version}.tgz, rename if needed
const npmAppTgz = path.join(appDir, `9router-app-${version}.tgz`);
if (fs.existsSync(npmAppTgz) && npmAppTgz !== appTgz) {
  fs.renameSync(npmAppTgz, appTgz);
}
console.log(`  ✅ Created: ${appTgz}`);

// Clean up
console.log("\n🧹 Cleaning up...");
fs.rmSync(tmpDir, { recursive: true, force: true });

// Summary
console.log("\n✨ All packages built:");
for (const f of [linuxTgz, winTgz, appTgz]) {
  if (fs.existsSync(f)) {
    const size = (fs.statSync(f).size / 1024 / 1024).toFixed(1);
    console.log(`  ${path.basename(f)} (${size} MB)`);
  }
}
