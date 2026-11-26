/**
 * Regression test for #5149 (and the dashboard-probe leg of #5218)
 *
 * The OpenCode free lane (`oc/*`) is `noAuth: true` — there is no credential to
 * validate. Its dashboard "Test" button nevertheless fired a live request at
 * `/zen/v1/models` with the deprecated v1 request shape (`Bearer public`,
 * `User-Agent: opencode/1.18.x`).
 *
 * Upstream treats that probe as abuse: it answers 403 FreeTierError or locks the
 * caller's IP out with 429 FreeUsageLimitError, after which *real* requests from
 * the same exit keep failing. So the probe did not just fail to verify anything,
 * it actively broke the connection it was supposed to be checking.
 *
 * The intended behaviour is: no network call for the free lane, always valid.
 * `opencode-go` keeps its own probe (it has a real API key to check).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";

const SRC_PATH = path.resolve("../src/app/api/providers/[id]/test/testUtils.js");
const src = fs.readFileSync(SRC_PATH, "utf-8");

describe("OpenCode free-lane dashboard probe (#5149)", () => {
  it("does not reach the network for the free lane", () => {
    // The whole `case "opencode":` arm must not call the fetch helper at all.
    const arm = src.slice(src.indexOf('case "opencode": {'));
    const end = arm.indexOf('case "opencode-go"');
    expect(end).toBeGreaterThan(0);
    const block = arm.slice(0, end);

    expect(block).not.toMatch(/fetchWithConnectionProxy/);
    expect(block).not.toMatch(/https:\/\//);
    expect(block).toMatch(/valid:\s*true/);
  });

  it("no longer sends the deprecated v1 User-Agent from the free-lane probe", () => {
    const arm = src.slice(src.indexOf('case "opencode": {'));
    const block = arm.slice(0, arm.indexOf('case "opencode-go"'));
    expect(block).not.toMatch(/opencode\/1\.18/);
  });

  it("keeps the opencode-go probe intact (it has a real API key to check)", () => {
    const arm = src.slice(src.indexOf('case "opencode-go": {'));
    const block = arm.slice(0, arm.indexOf('case "perplexity-web"') === -1 ? 800 : 800);
    expect(block).toMatch(/fetchWithConnectionProxy/);
    expect(block).toMatch(/inference\/go/);
  });
});

describe("OpenCode free-lane registry contract", () => {
  it("free lane is declared noAuth, so no credential validation is possible", () => {
    const registry = fs.readFileSync(
      path.resolve("../open-sse/providers/registry/opencode.js"),
      "utf-8"
    );
    expect(registry).toMatch(/^\s*noAuth:\s*true,/m);
  });
});
