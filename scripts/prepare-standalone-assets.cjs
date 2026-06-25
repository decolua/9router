const fs = require("fs");
const path = require("path");

const root = process.cwd();
const distDir = path.resolve(root, process.env.NEXT_DIST_DIR || ".next");
const standaloneDir = path.join(distDir, "standalone");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

if (!fs.existsSync(standaloneDir)) {
  process.exit(0);
}

copyDir(path.join(root, "public"), path.join(standaloneDir, "public"));
copyDir(path.join(distDir, "static"), path.join(standaloneDir, path.basename(distDir), "static"));
