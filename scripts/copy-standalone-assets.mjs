import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export function copyStandaloneAssets({ projectRoot = process.cwd(), distDir = process.env.NEXT_DIST_DIR || ".next" } = {}) {
  if (process.env.NEXT_TRACING_ROOT_MODE === "workspace") {
    console.log("[standalone-assets] Skipping workspace-traced CLI build; CLI packaging handles assets");
    return;
  }

  const buildDir = resolve(projectRoot, distDir);
  const standaloneDir = resolve(buildDir, "standalone");

  if (!existsSync(standaloneDir)) {
    console.warn(`[standalone-assets] WARNING: No standalone build found at ${standaloneDir}`);
    console.warn("[standalone-assets] Run `npm run build` first to generate the standalone output.");
    return;
  }

  let copied = 0;
  let warnings = [];

  const staticSource = resolve(buildDir, "static");
  const staticDestination = resolve(standaloneDir, distDir, "static");
  if (existsSync(staticSource)) {
    cpSync(staticSource, staticDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied static assets to ${staticDestination}`);
    copied++;
  } else {
    warnings.push(`static dir not found: ${staticSource}`);
  }

  const publicSource = resolve(projectRoot, "public");
  const publicDestination = resolve(standaloneDir, "public");
  if (existsSync(publicSource)) {
    cpSync(publicSource, publicDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied public assets to ${publicDestination}`);
    copied++;
  } else {
    warnings.push(`public dir not found: ${publicSource}`);
  }

  // Fail loudly if assets were missing — silence hides broken standalone builds (#3006)
  if (warnings.length > 0) {
    console.warn(`[standalone-assets] WARNING: ${warnings.length} asset dir(s) missing:`);
    for (const w of warnings) console.warn(`  - ${w}`);
    console.warn("[standalone-assets] The standalone build may serve without CSS/JS/images.");
    console.warn("[standalone-assets] Ensure `next build` completed successfully before running this script.");
  }

  console.log(`[standalone-assets] Done: ${copied}/2 asset dirs copied.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(dirname(fileURLToPath(import.meta.url)), "copy-standalone-assets.mjs")) {
  copyStandaloneAssets();
}
