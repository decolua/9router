"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { copyRuntimePackages } = require("./copy-runtime-packages.cjs");

const appDir = path.resolve(__dirname, "..");
const distDir = path.join(appDir, process.env.NEXT_DIST_DIR || ".next");
const standaloneRoot = path.join(distDir, "standalone");
const packageName = path.basename(appDir);
const standaloneDir = fs.existsSync(path.join(standaloneRoot, "server.js"))
  ? standaloneRoot
  : path.join(standaloneRoot, packageName);

if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
  throw new Error(`Next standalone server was not found under ${standaloneRoot}`);
}

fs.copyFileSync(
  path.join(appDir, "custom-server.js"),
  path.join(standaloneDir, "custom-server.js")
);
fs.cpSync(path.join(appDir, "server"), path.join(standaloneDir, "server"), {
  recursive: true,
  dereference: true,
});

copyRuntimePackages(
  ["ws", "https-proxy-agent", "socks-proxy-agent"],
  path.join(standaloneDir, "node_modules"),
  {
    searchPaths: [appDir],
    storeDirs: [path.join(appDir, "node_modules", ".pnpm")],
  }
);

console.log(`Prepared Codex Native standalone gateway in ${standaloneDir}`);
