const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

// ── Build config ─────────────────────────────────────────
const BUILD_CONFIG = {
  bundle: true,
  minify: true,
  cleanPlainFiles: true,
};
// ─────────────────────────────────────────────────────────

const cliDir = path.resolve(__dirname, "..");
const appDir = path.resolve(cliDir, "..");
const cliMitmDir = path.join(cliDir, "app", "src", "mitm");
// Bundle everything — no externals. This keeps MITM runtime self-contained so
// it can be copied to DATA_DIR/runtime/ and spawned from there (escapes
// node_modules file locks that block `npm i -g 9router@latest` on Windows).
const EXTERNALS = [];
const ENTRIES = ["server.js"];

async function buildEntry(entry) {
  const mitmSrc = path.join(appDir, "src", "mitm");
  const output = path.join(cliMitmDir, entry);

  const buildPlugin = {
    name: "build-plugin",
    setup(build) {
      // Stub .git file scanned by esbuild
      build.onResolve({ filter: /\.git/ }, args => ({ path: args.path, namespace: "git-stub" }));
      build.onLoad({ filter: /.*/, namespace: "git-stub" }, () => ({ contents: "module.exports={}", loader: "js" }));
    },
  };

  const steps = [];

  if (BUILD_CONFIG.bundle) {
    await esbuild.build({
      entryPoints: [path.join(mitmSrc, entry)],
      bundle: true,
      minify: BUILD_CONFIG.minify,
      platform: "node",
      target: "node18",
      external: EXTERNALS,
      plugins: [buildPlugin],
      outfile: output,
    });
    steps.push("bundled");
    if (BUILD_CONFIG.minify) steps.push("minified");
  }

  console.log(`✅ ${steps.join(" + ")} → ${output}`);
}

async function run() {
  const flags = Object.entries(BUILD_CONFIG).filter(([, v]) => v).map(([k]) => k).join(", ");
  console.log(`⚙️  Config: ${flags}`);

  for (const entry of ENTRIES) await buildEntry(entry);

  if (BUILD_CONFIG.cleanPlainFiles) {
    const keep = new Set(ENTRIES);
    for (const name of fs.readdirSync(cliMitmDir)) {
      if (!keep.has(name)) fs.rmSync(path.join(cliMitmDir, name), { recursive: true, force: true });
    }
    console.log("✅ Removed plain MITM files from CLI bundle");
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
