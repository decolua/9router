// Smoke test for src/instrumentation.js
// Verifies the register() function respects NEXT_RUNTIME guard.
//
//   node --test tests/node/instrumentation.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const instrumentationPath = join(__dirname, "../../src/instrumentation.js");

test("instrumentation.js exports register function", async () => {
  // We can't fully import because it uses @/ aliases resolved by Next bundler.
  // Instead verify the file exists and exports register.
  const src = readFileSync(instrumentationPath, "utf8");
  assert.ok(src.includes("export async function register()"), "must export register()");
  assert.ok(src.includes('process.env.NEXT_RUNTIME !== "nodejs"'), "must guard non-nodejs runtime");
  assert.ok(src.includes("initializeApp"), "must call initializeApp");
  assert.ok(src.includes("__9routerBootstrapInvoked"), "must have singleton guard");
  assert.ok(src.includes('bootstrap'), "must have observability logs");
});

test("instrumentation.js skips non-nodejs runtime", async () => {
  // Simulate edge runtime — register should return immediately without importing
  const originalRuntime = process.env.NEXT_RUNTIME;
  process.env.NEXT_RUNTIME = "edge";
  try {
    // Dynamic import the file — it will hit the guard and return early
    // before trying to resolve @/ aliases (which would fail in node:test)
    const mod = await import(instrumentationPath);
    // Should not throw
    await mod.register();
  } finally {
    if (originalRuntime === undefined) {
      delete process.env.NEXT_RUNTIME;
    } else {
      process.env.NEXT_RUNTIME = originalRuntime;
    }
  }
});
