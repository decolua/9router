// Report Chinese characters that remain in **code** (string literals), ignoring
// comments. Comments are deliberately Chinese (maintainer-facing) and never
// rendered; string literals DO reach the dashboard/logs and must be English
// because the runtime i18n only translates FROM English source text.
//
// Deliberately a small hand-rolled scanner rather than a regex: a regex cannot
// reliably tell a `//` inside a string from a real comment, and getting that
// wrong produces confident, wrong results.
import { readFileSync } from "node:fs";

const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

function scan(file) {
  const src = readFileSync(file, "utf8");
  const hits = [];
  let i = 0;
  let line = 1;
  let state = "code"; // code | line-comment | block-comment | sq | dq | tpl

  while (i < src.length) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);

    if (c === "\n") line++;

    if (state === "code") {
      if (c2 === "//") { state = "line-comment"; i += 2; continue; }
      if (c2 === "/*") { state = "block-comment"; i += 2; continue; }
      if (c === '"') { state = "dq"; i++; continue; }
      if (c === "'") { state = "sq"; i++; continue; }
      if (c === "`") { state = "tpl"; i++; continue; }
      i++;
      continue;
    }
    if (state === "line-comment") {
      if (c === "\n") state = "code";
      i++;
      continue;
    }
    if (state === "block-comment") {
      if (c2 === "*/") { state = "code"; i += 2; continue; }
      i++;
      continue;
    }
    // inside a string literal
    if (c === "\\") { i += 2; continue; }
    if ((state === "dq" && c === '"') || (state === "sq" && c === "'") || (state === "tpl" && c === "`")) {
      state = "code";
      i++;
      continue;
    }
    if (CJK.test(c)) {
      // capture the surrounding literal text for review
      let end = i;
      while (end < src.length && !/["'`\n]/.test(src[end])) end++;
      // Find the start of the line so we can tell an operator-facing log line from a
      // user-facing string. `logLine()` writes to process.stdout only (docker logs),
      // so Chinese there is deliberate: the operator reads those logs. Anything that
      // can reach the HTTP response, the state file or the dashboard must be English,
      // because the runtime i18n only translates FROM English source text.
      const lineStart = src.lastIndexOf("\n", i) + 1;
      const lineText = src.slice(lineStart, i);
      const operatorFacing = /logLine\(\s*`?$/.test(lineText) || /logLine\(/.test(lineText);
      hits.push({ line, text: src.slice(i, end).slice(0, 90), operatorFacing });
      i = end;
      continue;
    }
    i++;
  }
  return hits;
}

let bad = 0;
for (const file of process.argv.slice(2)) {
  const hits = scan(file);
  const name = file.split(/[\\/]/).pop();
  const userFacing = hits.filter((h) => !h.operatorFacing);
  const logOnly = hits.filter((h) => h.operatorFacing);

  if (userFacing.length === 0) {
    console.log(`OK    ${name}${logOnly.length ? `  (${logOnly.length} Chinese log line(s) — stdout only, fine)` : ""}`);
  } else {
    bad += userFacing.length;
    console.log(`CJK   ${name}  <-- USER-FACING, must be English`);
    for (const h of userFacing) console.log(`        line ${h.line}: ${h.text}`);
  }
}
console.log(
  bad === 0
    ? "\nAll user-facing strings are English (Chinese log lines are intentional)."
    : `\n${bad} user-facing string(s) are still Chinese.`
);
process.exit(bad === 0 ? 0 : 1);
