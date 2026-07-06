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
	"@img", // Sharp image processing (not needed with unoptimized images)
	"sharp", // Sharp core lib (not needed with unoptimized images)
	"detect-libc", // Sharp dependency
	".env", // Environment files
	".env.local",
	".env.*.local",
	"*.log", // Log files
	"tmp", // Temp files
	".DS_Store", // macOS files
];

function shouldExclude(name) {
	return EXCLUDE_PATTERNS.some((pattern) => {
		if (pattern.includes("*")) {
			const regex = new RegExp(
				"^" +
					pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
					"$",
			);
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

console.log("📦 Building 9Router CLI package with vinext...\n");

// === Aggressive clean for reliable standalone builds ===
// Clean dist (vinext output) + cli/app for a pristine build.
console.log("🧹 Cleaning previous build artifacts...");
const dirsToClean = [
	buildHomeDir,
	cliAppDir,
	path.join(appDir, "dist"), // vinext standalone output
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
fs.mkdirSync(path.join(buildHomeDir, "AppData", "Roaming"), {
	recursive: true,
});
fs.mkdirSync(path.join(buildHomeDir, "AppData", "Local"), { recursive: true });

// Step 0: Sync version from app/cli/package.json to app/package.json
console.log("0️⃣  Syncing version to app/package.json...");
const cliPkg = JSON.parse(
	fs.readFileSync(path.join(cliDir, "package.json"), "utf8"),
);
const appPkgPath = path.join(appDir, "package.json");
const appPkg = JSON.parse(fs.readFileSync(appPkgPath, "utf8"));
if (appPkg.version !== cliPkg.version) {
	appPkg.version = cliPkg.version;
	fs.writeFileSync(appPkgPath, JSON.stringify(appPkg, null, 2) + "\n");
	console.log(`✅ Version synced: ${cliPkg.version}\n`);
} else {
	console.log(`✅ Version already synced: ${cliPkg.version}\n`);
}

// Step 1: Build app with vinext (Vite) → emits dist/standalone/{server.js, dist/, node_modules/, public/}.
console.log("1️⃣  Building vinext app...");
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
		},
	});
	console.log("✅ vinext build completed\n");
} catch (error) {
	console.error("❌ vinext build failed");
	process.exit(1);
}

// Step 2: Copy vinext standalone build to cli/app.
// vinext emits a flat dist/standalone/{server.js, dist/, node_modules/, public/}.
console.log("2️⃣  Copying vinext standalone build to cli/app...");

const standaloneRoot = path.join(appDir, "dist", "standalone");

if (!fs.existsSync(path.join(standaloneRoot, "server.js"))) {
	console.error(
		"\n❌ vinext standalone build not found (dist/standalone/server.js missing).",
	);
	console.error("Looked under: " + standaloneRoot);
	console.error("\n📁 Contents of dist/standalone:");
	try {
		console.error(
			"  " + JSON.stringify(fs.readdirSync(standaloneRoot), null, 2),
		);
	} catch (e) {
		console.error("  (could not read dir: " + e.message + ")");
	}
	console.error(
		"\n💡 Fix: rm -rf dist cli/app && bun run build && npm --prefix cli run build",
	);
	process.exit(1);
}

console.log(
	`   → Found vinext standalone root: ${path.relative(appDir, standaloneRoot)}`,
);
copyRecursive(standaloneRoot, cliAppDir);
console.log("✅ Copied standalone build\n");

// Step 3a: Copy the vinext entry + trusted-IP middleware (replaces custom-server.js).
// server.vinext.js prepends a "request" listener that injects x-9r-real-ip;
// src/lib/clientIp.js holds the shared sanitizer.
const vinextEntrySrc = path.join(appDir, "server.vinext.js");
const clientIpSrc = path.join(appDir, "src", "lib", "clientIp.js");
if (fs.existsSync(vinextEntrySrc)) {
	fs.copyFileSync(vinextEntrySrc, path.join(cliAppDir, "server.vinext.js"));
	// clientIp.js is imported via the relative path ./src/lib/clientIp.js
	if (fs.existsSync(clientIpSrc)) {
		const dest = path.join(cliAppDir, "src", "lib", "clientIp.js");
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(clientIpSrc, dest);
		console.log("✅ Copied server.vinext.js + src/lib/clientIp.js\n");
	} else {
		console.warn(
			"⚠️  src/lib/clientIp.js not found — real-IP injection will fail at runtime\n",
		);
	}
} else {
	console.warn(
		"⚠️  server.vinext.js not found — CLI will fall back to the plain vinext server.js (no real-IP injection)\n",
	);
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
		console.warn(
			`⚠️  ${pkg} not found locally — bundle will rely on node:sqlite or runtime install`,
		);
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

// Step 4: (no-op) Static assets live inside dist/standalone/dist/ — already copied in Step 2.

// Step 5: Copy public folder if exists (vinext standalone already includes it,
// but copy explicitly as a safety net for the bundled layout).
console.log("5️⃣  Copying public folder...");
const publicSrc = path.join(appDir, "public");
const publicDest = path.join(cliAppDir, "public");
if (fs.existsSync(publicSrc)) {
	copyRecursive(publicSrc, publicDest);
	console.log("✅ Copied public folder\n");
} else {
	console.log("⏭️  No public folder found\n");
}

// Step 6: (no-op) vendor-chunks were a Next.js-specific path; vinext emits all
// server bundles under dist/standalone/dist/ — already copied in Step 2.

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
