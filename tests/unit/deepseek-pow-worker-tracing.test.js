import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const WORKER = "open-sse/lib/deepseek-pow-worker.mjs";

// The worker is spawned by a cwd-relative path, so Next's file tracing copies
// it into the standalone/CLI build as a bare asset without following its own
// imports. Anything it imports must be listed in outputFileTracingIncludes, or
// the packed build fails every deepseek-web call with "Cannot find module".
describe("deepseek-web PoW worker packaging", () => {
  it("lists every relative import of the worker in outputFileTracingIncludes", async () => {
    const source = fs.readFileSync(path.join(ROOT, WORKER), "utf8");
    const imports = [...source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)].map((m) =>
      path.posix.join(path.posix.dirname(WORKER), m[1])
    );
    expect(imports.length).toBeGreaterThan(0);

    const { default: nextConfig } = await import(path.join(ROOT, "next.config.mjs"));
    const included = Object.values(nextConfig.outputFileTracingIncludes || {})
      .flat()
      .map((entry) => entry.replace(/^\.\//, ""));
    for (const file of imports) expect(included).toContain(file);
  });
});
