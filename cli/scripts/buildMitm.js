const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

// ── Build config ─────────────────────────────────────────
const BUILD_CONFIG = {
  bundle: true,
  minify: true,
  obfuscate: false,
  cleanPlainFiles: true,
};
// ─────────────────────────────────────────────────────────

const binDir = path.resolve(__dirname, "..");
const appDir = path.resolve(binDir, "..", "app");
const binMitmDir = path.join(binDir, "app", "src", "mitm");
// Bundle everything — no externals. This keeps MITM runtime self-contained so
// it can be copied to DATA_DIR/runtime/ and spawned from there (escapes
// node_modules file locks that block `npm i -g 9router@latest` on Windows).
const EXTERNALS = [];
const ENTRIES = ["server.js"];

async function buildEntry(entry) {
  const mitmSrc = path.join(appDir, "src", "mitm");
  const output = path.join(binMitmDir, entry);

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
    const useTemp = BUILD_CONFIG.obfuscate;
    const outfile = useTemp ? output.replace(".js", ".bundled.js") : output;

    await esbuild.build({
      entryPoints: [path.join(mitmSrc, entry)],
      bundle: true,
      minify: BUILD_CONFIG.minify,
      platform: "node",
      target: "node18",
      external: EXTERNALS,
      plugins: [buildPlugin],
      outfile,
    });
    steps.push("bundled");
    if (BUILD_CONFIG.minify) steps.push("minified");

    if (BUILD_CONFIG.obfuscate) {
      const { execSync } = require("child_process");
      execSync(
        `npx javascript-obfuscator "${outfile}" --output "${output}" --compact true --string-array true --string-array-encoding base64`,
        { stdio: "inherit", cwd: appDir }
      );
      fs.unlinkSync(outfile);
      steps.push("obfuscated");
    }
  }

  console.log(`✅ ${steps.join(" + ")} → ${output}`);
}

async function run() {
  const flags = Object.entries(BUILD_CONFIG).filter(([, v]) => v).map(([k]) => k).join(", ");
  console.log(`⚙️  Config: ${flags}`);

  for (const entry of ENTRIES) await buildEntry(entry);

  if (BUILD_CONFIG.cleanPlainFiles) {
    const keep = new Set(ENTRIES);
    for (const name of fs.readdirSync(binMitmDir)) {
      if (!keep.has(name)) fs.rmSync(path.join(binMitmDir, name), { recursive: true, force: true });
    }
    console.log("✅ Removed plain MITM files from bin");
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
