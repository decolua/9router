#!/usr/bin/env node

// Rebuilds tray_darwin_arm64, the native Apple Silicon menubar binary that
// hooks/trayRuntime.js overlays on top of systray2's x86_64-only build.
//
// Must run on macOS: getlantern/systray is cgo against AppKit, so the arm64
// slice needs a real macOS SDK. Requires Go on PATH (`mise use -g go@latest`).
//
// Output is NOT reproducible across Go versions even with -s -w, so after a
// rebuild you must re-upload the asset and update ARM64_TRAY_SHA256 in
// hooks/trayRuntime.js — this script prints both and fails if they diverge.

const { execFileSync, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const UPSTREAM_REPO = "https://github.com/felixhao28/systray-portable.git";
// master as of 2021-09-15, the commit systray2@2.1.4's own binary was built from.
const UPSTREAM_COMMIT = "6eddc917bf39fcc0d95b57a0741d0c065fbd1e23";

const outDir = path.join(__dirname, "..", ".tray-build");
const outFile = path.join(outDir, "tray_darwin_arm64");
const trayRuntimePath = path.join(__dirname, "..", "hooks", "trayRuntime.js");

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) fail(`${cmd} ${args.join(" ")} exited with ${res.status}`);
}

if (process.platform !== "darwin") fail("must be run on macOS (cgo needs the AppKit SDK)");

const go = spawnSync("go", ["version"], { encoding: "utf8" });
if (go.status !== 0) {
  fail("Go toolchain not found on PATH. Install it with: mise use -g go@latest");
}
console.log(`Go: ${go.stdout.trim()}`);

const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "systray-portable-"));
// fail() exits through process.exit(), which does not unwind the stack, so a
// try/finally here would leak the clone on every failed build. An exit handler
// covers normal completion, fail(), and uncaught exceptions alike.
process.on("exit", () => {
  try { fs.rmSync(srcDir, { recursive: true, force: true }); } catch {}
});

console.log(`\nCloning ${UPSTREAM_REPO} @ ${UPSTREAM_COMMIT.slice(0, 7)}`);
run("git", ["clone", "--quiet", UPSTREAM_REPO, srcDir]);
run("git", ["-C", srcDir, "checkout", "--quiet", UPSTREAM_COMMIT]);

const head = execFileSync("git", ["-C", srcDir, "log", "-1", "--format=%H %ad %s", "--date=short"], {
  encoding: "utf8"
}).trim();
console.log(`HEAD: ${head}`);

run("go", ["mod", "download"], { cwd: srcDir });

console.log("\nBuilding darwin/arm64...");
// -trimpath strips the local build directory from the binary, so two builds
// from the same commit + Go version hash identically regardless of where they
// ran. Without it the pinned sha256 could never be regenerated.
run("go", ["build", "-trimpath", "-ldflags", "-s -w", "-o", outFile, "tray.go"], {
  cwd: srcDir,
  env: { ...process.env, CGO_ENABLED: "1", GOOS: "darwin", GOARCH: "arm64" }
});

// ── Verify ────────────────────────────────────────────────────────────────
const buf = Buffer.alloc(8);
const fd = fs.openSync(outFile, "r");
fs.readSync(fd, buf, 0, 8, 0);
fs.closeSync(fd);
if (buf.readUInt32LE(0) !== 0xfeedfacf || buf.readUInt32LE(4) !== 0x0100000c) {
  fail("output is not a thin arm64 Mach-O");
}

// Apple Silicon refuses to execute an unsigned binary. Go's linker applies an
// ad-hoc signature automatically; confirm it survived.
const sig = spawnSync("codesign", ["--verify", outFile], { encoding: "utf8" });
if (sig.status !== 0) fail(`ad-hoc signature invalid: ${(sig.stderr || "").trim()}`);

const sha256 = crypto.createHash("sha256").update(fs.readFileSync(outFile)).digest("hex");
const sizeMb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);

console.log(`\n✅ ${outFile}`);
console.log(`   arch:     arm64 (ad-hoc signed, verified)`);
console.log(`   size:     ${sizeMb} MB`);
console.log(`   sha256:   ${sha256}`);

// Whitespace-tolerant: a formatter could wrap the assignment across lines, and
// a null match must fail loudly rather than silently read as "no pin".
const pinMatch = fs.readFileSync(trayRuntimePath, "utf8").match(/ARM64_TRAY_SHA256\s*=\s*"([0-9a-f]{64})"/);
if (!pinMatch) fail(`could not find ARM64_TRAY_SHA256 in ${trayRuntimePath}`);
const pinned = pinMatch[1];
if (pinned === sha256) {
  console.log(`\n   Matches ARM64_TRAY_SHA256 in hooks/trayRuntime.js — no code change needed.`);
} else {
  console.log(`\n⚠️  Differs from ARM64_TRAY_SHA256 in hooks/trayRuntime.js (${pinned}).`);
  console.log(`   Re-upload the release asset, then update that constant to the sha256 above.`);
}

console.log(`\nNext: upload to the pinned release tag, keeping the asset name stable:`);
console.log(`   gh release upload tray-binaries "${outFile}" --clobber`);
