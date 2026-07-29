import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "src/lib/db");
const files = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js")) files.push(p);
  }
}
walk(root);

function importLine(file) {
  if (file.includes(`${path.sep}helpers${path.sep}`)) return `import { qAll, qGet, qRun, qExec, qTransaction } from "./query.js";\n`;
  if (file.includes(`${path.sep}migrations${path.sep}`)) return `import { qAll, qGet, qRun, qExec } from "../query.js";\n`;
  if (file.includes(`${path.sep}repos${path.sep}`)) return `import { qAll, qGet, qRun, qExec } from "../query.js";\n`;
  if (file.endsWith(`${path.sep}index.js`)) return `import { qAll, qGet, qRun, qExec, qTransaction } from "./query.js";\n`;
  if (file.endsWith(`${path.sep}migrate.js`)) return `import { qAll, qGet, qRun, qExec, qTransaction } from "./query.js";\n`;
  return null;
}

for (const file of files) {
  if (file.endsWith(`${path.sep}query.js`) || file.endsWith(`${path.sep}dialect.js`)) continue;
  let s = fs.readFileSync(file, "utf8");
  if (!/\bdb\.(all|get|run|exec)\(/.test(s) && !/\badapter\.(all|get|run|exec)\(/.test(s)) continue;

  const imp = importLine(file);
  if (imp && !s.includes("from \"./query.js\"") && !s.includes('from "../query.js"')) {
    s = imp + s;
  }

  const orig = s;
  s = s.replace(/(?<!await )db\.all\(/g, "await qAll(db, ");
  s = s.replace(/(?<!await )db\.get\(/g, "await qGet(db, ");
  s = s.replace(/(?<!await )db\.run\(/g, "await qRun(db, ");
  s = s.replace(/(?<!await )db\.exec\(/g, "await qExec(db, ");
  s = s.replace(/(?<!await )adapter\.all\(/g, "await qAll(adapter, ");
  s = s.replace(/(?<!await )adapter\.get\(/g, "await qGet(adapter, ");
  s = s.replace(/(?<!await )adapter\.run\(/g, "await qRun(adapter, ");
  s = s.replace(/(?<!await )adapter\.exec\(/g, "await qExec(adapter, ");

  if (s !== orig) {
    fs.writeFileSync(file, s);
    console.log("updated", path.relative(process.cwd(), file));
  }
}
