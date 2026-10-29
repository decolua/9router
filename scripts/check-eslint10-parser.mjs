#!/usr/bin/env node
// Re-check probe for the eslint ^10 deferral (board row HYG-9ROUTER-14).
//
// USAGE
//   node scripts/check-eslint10-parser.mjs     # exit 0 = blocker cleared
//
// WHAT IT CHECKS
//   `eslint-config-next` hands ESLint the parser at
//   `next/dist/compiled/babel/eslint-parser`. ESLint 10's `source-code.js`
//   (`addDeclaredGlobals`) calls `scopeManager.addGlobals()`, so the upgrade
//   stays blocked until the scope manager that parser returns exposes it. This
//   probe loads that exact object and asserts
//   `typeof result.scopeManager.addGlobals === "function"`.
//
// WHY NOT A GREP
//   `next/dist/compiled/babel/eslint-parser.js` is a 52-byte shim
//   (`module.exports = require('./bundle').eslintParser()`), so
//   `grep -c addGlobals` on it is 0 BY CONSTRUCTION and can never flip even
//   after upstream fixes the parser. The real parser is
//   `next/dist/compiled/babel/bundle.js` (1,364,777 bytes).
//
// WHY NOT ASSERT A LITERAL `undefined`
//   The pass condition is `typeof addGlobals === "function"`, never
//   `typeof addGlobals === "undefined"`: a hardcoded blocked-state assertion
//   would keep "passing" after upstream flips it and would need hand
//   maintenance. This probe flips on its own.
//
// Exit codes: 0 = addGlobals is a function (attempt eslint ^10 next),
//             1 = blocked, or the probe could not establish the fact at all
//                 (missing `next`, parser threw, no scopeManager).
// Dependency-free on purpose: node builtins + the already-installed `next`.
// Evidence and the second, independent blocker (peer ranges):
//   docs/dogfood/2026-09-19-eslint10-deferral.md
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const parserModule = "next/dist/compiled/babel/eslint-parser";
// Plain JavaScript input on purpose: inline JSX here does not reach the JSX
// parser under these options and can surface as a module-level error out of
// `babel-packages` instead of the real result (see the deferral doc).
const source = "const x = 1;";
const parseOptions = { requireConfigFile: false, ecmaVersion: 2024, sourceType: "module" };

// Anchored at the repo root so the probe behaves identically from any cwd.
const require = createRequire(join(repoRoot, "package.json"));

function installedNextVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "node_modules", "next", "package.json"), "utf8")
    );
    return pkg.version;
  } catch {
    return "unknown";
  }
}

function blocked({ reason, addGlobals, detail }) {
  console.error("✗ eslint ^10 parser probe: BLOCKED");
  console.error(`  reason:     ${reason}`);
  if (addGlobals !== undefined) console.error(`  addGlobals: ${addGlobals}`);
  // Multi-line details (e.g. a "Cannot find module" require stack) stay aligned.
  if (detail) console.error(`  detail:     ${detail.split("\n").join("\n              ")}`);
  console.error(`  parser:     ${parserModule} (next ${installedNextVersion()})`);
  console.error("");
  console.error("  The eslint ^10 upgrade stays deferred — do not add it to package.json.");
  console.error("  With eslint 10 the gate exits 2: TypeError: scopeManager.addGlobals is not a function");
  console.error("  Re-check after the next `next` / DEPS bump; full evidence and the");
  console.error("  second blocker (peer ranges) live in");
  console.error("    docs/dogfood/2026-09-19-eslint10-deferral.md");
  return 1;
}

function main() {
  let parser;
  try {
    parser = require(parserModule);
  } catch (err) {
    return blocked({
      reason: `cannot load ${parserModule}`,
      detail: `${err.message} — run \`npm install\` from the repo root.`,
    });
  }

  if (typeof parser?.parseForESLint !== "function") {
    return blocked({
      reason:
        `${parserModule} does not export parseForESLint ` +
        `(typeof ${typeof parser?.parseForESLint})`,
    });
  }

  let result;
  try {
    result = parser.parseForESLint(source, parseOptions);
  } catch (err) {
    return blocked({ reason: "parseForESLint threw", detail: err.message });
  }

  const scopeManager = result?.scopeManager;
  if (!scopeManager) {
    return blocked({
      reason: "parseForESLint returned no scopeManager — ESLint 10 cannot use this parser",
    });
  }

  const addGlobals = typeof scopeManager.addGlobals;
  if (addGlobals !== "function") {
    return blocked({
      reason: "scopeManager.addGlobals is not a function",
      addGlobals,
    });
  }

  console.log(
    `✓ eslint ^10 parser probe: scopeManager.addGlobals is a function (next ${installedNextVersion()})`
  );
  console.log("  The vendored-parser blocker is cleared. Next steps:");
  console.log("    npm install --save-dev eslint@^10");
  console.log("    npm run lint:gate   # must exit 0 with scripts/lint-baseline.json unchanged");
  console.log("  Then re-check the second blocker — the peer ranges of eslint-plugin-react,");
  console.log("  eslint-plugin-jsx-a11y and eslint-plugin-import nested under eslint-config-next");
  console.log("    docs/dogfood/2026-09-19-eslint10-deferral.md");
  return 0;
}

process.exitCode = main();
