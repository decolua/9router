import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = path.join(root, ".next", "standalone");
const standaloneNext = path.join(standaloneRoot, ".next");

function ensureLink(target, linkPath) {
  fs.rmSync(linkPath, { force: true, recursive: true });

  const relativeTarget = path.relative(path.dirname(linkPath), target);
  try {
    fs.symlinkSync(relativeTarget, linkPath, "junction");
  } catch {
    fs.cpSync(target, linkPath, { recursive: true });
  }
}

if (!fs.existsSync(path.join(standaloneRoot, "server.js"))) {
  console.log("[standalone-assets] No standalone server found; skipping.");
  process.exit(0);
}

fs.mkdirSync(standaloneNext, { recursive: true });
ensureLink(path.join(root, ".next", "static"), path.join(standaloneNext, "static"));
ensureLink(path.join(root, "public"), path.join(standaloneRoot, "public"));

console.log("[standalone-assets] Linked public and .next/static into .next/standalone.");
