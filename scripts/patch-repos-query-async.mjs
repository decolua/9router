import fs from "node:fs";
import path from "node:path";

const repos = path.join(process.cwd(), "src/lib/db/repos");
const files = fs.readdirSync(repos).filter((f) => f.endsWith(".js")).map((f) => path.join(repos, f));

const importLine = `import { qAll, qGet, qRun, qExec } from "../query.js";\n`;

for (const file of files) {
  let s = fs.readFileSync(file, "utf8");
  if (s.includes('from "../query.js"')) continue;

  s = importLine + s;
  const lines = s.split("\n");
  let depth = 0;
  const out = [];

  for (const line of lines) {
    if (/db\.transaction\s*\(\s*\(\)\s*=>\s*\{/.test(line)) depth++;
    const inTx = depth > 0;
    let next = line;
    if (!inTx) {
      next = next
        .replace(/\bdb\.all\(/g, "await qAll(db, ")
        .replace(/\bdb\.get\(/g, "await qGet(db, ")
        .replace(/\bdb\.run\(/g, "await qRun(db, ")
        .replace(/\bdb\.exec\(/g, "await qExec(db, ");
    }
    if (inTx && /^\s*\}\);?\s*$/.test(line)) depth = Math.max(0, depth - 1);
    out.push(next);
  }

  fs.writeFileSync(file, out.join("\n"));
  console.log("patched", path.basename(file));
}
