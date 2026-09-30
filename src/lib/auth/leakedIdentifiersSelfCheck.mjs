// Leaked-identifier scan, written after a real outage.
//
// What happened: createApiKey read `ctx.session?.apiKey` in a repo module that
// has no session. Every key creation threw a ReferenceError, the route caught it
// and answered a bare 500, and the dashboard showed nothing useful. esbuild
// passed the whole time, because an undeclared global is a perfectly valid
// program to a bundler; it only throws when the line actually runs.
//
// So this scans the source for identifiers that are never implicit in this
// codebase and fail if a file uses one without declaring it. The scan is
// deliberately narrow: it only looks for names that should never leak, so it
// cannot cry wolf on ordinary locals like `body` or `params`.
//
// Run: node src/lib/auth/leakedIdentifiersSelfCheck.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// here is <repo>/src/lib/auth, so the repo root is three levels up.
const repo = path.resolve(here, "../../..");

// Names that only exist inside a route handler or an auth helper. A module in
// src/lib has no business using one unless it declares it.
const NEVER_IMPLICIT = ["ctx"];

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === ".next") continue;
    const full = path.join(dir, entry);
    let info;
    try { info = statSync(full); } catch { continue; }
    if (info.isDirectory()) collectFiles(full, out);
    else if (entry.endsWith(".js") || entry.endsWith(".mjs")) out.push(full);
  }
  return out;
}

/** True when the file uses `name.` and never declares `name`. */
export function hasUndeclaredRef(source, name) {
  const usesIt = new RegExp(`\\b${name}\\s*\\?*\\.`).test(source);
  if (!usesIt) return false;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declares = [
    // const ctx = ... / let ctx = ... / var ctx = ...
    new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\b`),
    // function f(ctx) { ... }
    new RegExp(`function[^\\n{]*\\(${escaped}\\b`),
    // arrow (ctx) => ...
    new RegExp(`\\(${escaped}\\b[^)]*\\)\\s*=>`),
    // catch (ctx) { }
    new RegExp(`catch\\s*\\(\\s*${escaped}\\b`),
    // import { ctx } from "..." / import ctx from "..."
    new RegExp(`import[^\\n]*\\b${escaped}\\b`),
    // Destructuring, in a declaration or a parameter list: const { ctx } = x and
    // function go({ ctx }). The name must be a bare binding, so it has to be
    // followed by a comma or a closing brace. Without that, any object literal
    // with the word in it reads as a declaration, and the scan silently stopped
    // catching the very line it was written for.
    new RegExp(`\\{[^}]*(?<![:\\w])${escaped}\\s*[,}]`),
    // plain reassignment inside a scope
    new RegExp(`^\\s*${escaped}\\s*=`, "m"),
  ];
  return !declares.some((re) => re.test(source));
}

const results = [];
function run(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
  }
}
const assert = {
  ok(v, msg) { if (!v) throw new Error(msg || "expected true"); },
  no(v, msg) { if (v) throw new Error(msg || "expected false"); },
  equal(a, b, msg) { if (a !== b) throw new Error(`${msg || ""} expected ${b}, got ${a}`); },
};

// The detector itself, on strings, so a scan that passes cannot be passing
// because the rule stopped matching anything.
run("the detector spots an undeclared use", () => {
  assert.ok(hasUndeclaredRef('createdBy: options.createdBy || ctx.session?.apiKey || "",', "ctx"), "the real line is caught");
});

run("the detector accepts every way a name can be declared", () => {
  assert.no(hasUndeclaredRef("const ctx = await getSessionContext();", "ctx"), "const");
  assert.no(hasUndeclaredRef("let ctx;", "ctx"), "let");
  assert.no(hasUndeclaredRef("async function post(request) { return ctx; }", "ctx"), "not a param, no use");
  assert.no(hasUndeclaredRef("export async function POST(request) {\n  const ctx = await getSessionContext();\n  return ctx.session;\n}", "ctx"), "const inside a function");
  assert.no(hasUndeclaredRef("export function go({ ctx }) { return ctx.session; }", "ctx"), "destructured param");
  assert.no(hasUndeclaredRef("try { a(); } catch (ctx) { log(ctx); }", "ctx"), "catch param");
});

run("an object literal containing the name is not a declaration", () => {
  // The shape of the line that caused the outage, kept as a case so the rule
  // cannot quietly widen back into matching it.
  const shape = [
    "export async function createApiKey(options = {}) {",
    "  const apiKey = {",
    "    id: uuidv4(),",
    '    name: options.name,',
    '    createdBy: options.createdBy || ctx.session?.apiKey || "",',
    "  };",
    "  return apiKey;",
    "}",
  ].join("\n");
  assert.ok(hasUndeclaredRef(shape, "ctx"), "an undeclared use inside an object literal is caught");
});

run("the detector ignores a file that never uses the name", () => {
  assert.no(hasUndeclaredRef("export const total = 1 + 2;", "ctx"), "no use at all");
});

run("no module in src or open-sse uses an undeclared session context", () => {
  const files = [
    ...collectFiles(path.join(repo, "src")),
    ...collectFiles(path.join(repo, "open-sse")),
  ];
  const offenders = [];
  for (const file of files) {
    let source = "";
    try { source = readFileSync(file, "utf8"); } catch { continue; }
    for (const name of NEVER_IMPLICIT) {
      if (hasUndeclaredRef(source, name)) {
        offenders.push(`${path.relative(repo, file)} uses ${name}. without declaring it`);
      }
    }
  }
  assert.equal(offenders.length, 0, `scanned ${files.length} files, offenders: ${offenders.join("; ")}`);
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.err ? ` — ${r.err}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
